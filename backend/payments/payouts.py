"""PayoutService — foundation for provider payouts.

- Provider requests a payout of AVAILABLE earnings.
- Admin approves / marks PAID / marks FAILED.
- Actual bank transfer is intentionally NOT implemented in this prompt.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
import uuid
from motor.motor_asyncio import AsyncIOMotorDatabase
from .types import PayoutState, EarningState
from .earnings import EarningsService


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _mask_account(num: str) -> str:
    if not num:
        return ""
    tail = num[-4:]
    return f"XXXX{tail}"


def _mask_upi(upi: Optional[str]) -> Optional[str]:
    if not upi or "@" not in upi:
        return upi
    left, right = upi.split("@", 1)
    if len(left) <= 2:
        return f"**@{right}"
    return f"{left[0]}{'*' * (len(left) - 2)}{left[-1]}@{right}"


class PayoutService:
    def __init__(self, db: AsyncIOMotorDatabase, earnings: EarningsService, events=None):
        self.db = db
        self.earnings = earnings
        self.events = events

    # ---- Bank details ------------------------------------------------------
    async def save_bank_details(self, *, provider_id: str, account_holder: str,
                                 account_number: str, ifsc: str, bank_name: Optional[str] = None,
                                 upi_id: Optional[str] = None) -> dict:
        now = _now()
        # NOTE: for production we would encrypt account_number and upi at rest with KMS.
        # This foundation only masks on read; storage remains in the private collection
        # and NEVER travels to the frontend.
        doc = {
            "id": str(uuid.uuid4()),
            "provider_id": provider_id,
            "account_holder": account_holder,
            "account_number": account_number,   # PRIVATE — do not expose
            "account_number_masked": _mask_account(account_number),
            "ifsc": ifsc.upper(),
            "bank_name": bank_name,
            "upi_id": upi_id,                    # PRIVATE — do not expose
            "upi_id_masked": _mask_upi(upi_id),
            "is_verified": False,
            "created_at": now,
            "updated_at": now,
        }
        await self.db.provider_bank_details.update_one(
            {"provider_id": provider_id},
            {"$set": doc}, upsert=True,
        )
        return {k: v for k, v in doc.items() if k not in ("account_number", "upi_id")}

    async def get_bank_details(self, *, provider_id: str) -> Optional[dict]:
        d = await self.db.provider_bank_details.find_one({"provider_id": provider_id}, {"_id": 0})
        if not d:
            return None
        return {k: v for k, v in d.items() if k not in ("account_number", "upi_id")}

    # ---- Request payout ----------------------------------------------------
    async def request_payout(self, *, provider_id: str, earning_ids: Optional[list[str]] = None) -> dict:
        # Lock available earnings
        q: dict = {"provider_id": provider_id, "state": EarningState.AVAILABLE.value}
        if earning_ids:
            q["id"] = {"$in": earning_ids}
        earnings = await self.db.earnings.find(q, {"_id": 0}).to_list(1000)
        if not earnings:
            raise ValueError("no_available_earnings")
        total = sum(int(e.get("final_amount_paise") or 0) for e in earnings)
        if total <= 0:
            raise ValueError("zero_amount")

        # Bank details required
        bank = await self.db.provider_bank_details.find_one({"provider_id": provider_id})
        if not bank:
            raise ValueError("bank_details_required")

        ids = [e["id"] for e in earnings]
        now = _now()
        payout = {
            "id": str(uuid.uuid4()),
            "provider_id": provider_id,
            "amount_paise": total,
            "currency": "INR",
            "state": PayoutState.REQUESTED.value,
            "gateway_payout_id": None,
            "failure_reason": None,
            "earning_ids": ids,
            "requested_at": now,
            "processed_at": None,
        }
        # Atomically move earnings PAID before creating payout? Standard is:
        #   AVAILABLE → (payout requested) mark them as "locked" via payout link;
        # We use payout_id link + state stays AVAILABLE until admin marks PAID.
        # To prevent double-request we lock via a payout_lock field.
        r = await self.db.earnings.update_many(
            {"id": {"$in": ids}, "state": EarningState.AVAILABLE.value, "payout_id": {"$exists": False}},
            {"$set": {"payout_id": payout["id"], "updated_at": now}},
        )
        if r.modified_count != len(ids):
            # Some earnings were already locked by another concurrent request — rollback
            await self.db.earnings.update_many(
                {"payout_id": payout["id"]},
                {"$unset": {"payout_id": ""}, "$set": {"updated_at": now}},
            )
            raise ValueError("earnings_conflict")

        await self.db.payouts.insert_one(payout)
        payout.pop("_id", None)

        if self.events:
            prov = await self.db.providers.find_one({"id": provider_id}, {"user_id": 1})
            if prov:
                await self.events.emit(
                    user_id=prov["user_id"], event_type="PAYOUT_REQUESTED",
                    data={"amount_paise": total},
                    idempotency_key=f"payout_requested:{payout['id']}",
                )
        return payout

    # ---- Admin actions -----------------------------------------------------
    async def mark_paid(self, *, payout_id: str, gateway_payout_id: Optional[str] = None) -> dict:
        payout = await self.db.payouts.find_one_and_update(
            {"id": payout_id, "state": {"$in": [PayoutState.REQUESTED.value, PayoutState.PROCESSING.value]}},
            {"$set": {"state": PayoutState.PAID.value,
                      "gateway_payout_id": gateway_payout_id,
                      "processed_at": _now()}},
            return_document=True,
        )
        if not payout:
            raise ValueError("payout_not_updatable")
        payout.pop("_id", None)
        await self.earnings.mark_paid(earning_ids=payout["earning_ids"], payout_id=payout_id)
        if self.events:
            prov = await self.db.providers.find_one({"id": payout["provider_id"]}, {"user_id": 1})
            if prov:
                await self.events.emit(
                    user_id=prov["user_id"], event_type="PAYOUT_COMPLETED",
                    data={"amount_paise": int(payout["amount_paise"])},
                    idempotency_key=f"payout_paid:{payout_id}",
                )
        return payout

    async def mark_failed(self, *, payout_id: str, reason: str) -> dict:
        payout = await self.db.payouts.find_one_and_update(
            {"id": payout_id, "state": {"$in": [PayoutState.REQUESTED.value, PayoutState.PROCESSING.value]}},
            {"$set": {"state": PayoutState.FAILED.value,
                      "failure_reason": reason, "processed_at": _now()}},
            return_document=True,
        )
        if not payout:
            raise ValueError("payout_not_updatable")
        payout.pop("_id", None)
        # Unlock earnings (revert AVAILABLE)
        await self.db.earnings.update_many(
            {"payout_id": payout_id},
            {"$unset": {"payout_id": ""}, "$set": {"updated_at": _now()}},
        )
        if self.events:
            prov = await self.db.providers.find_one({"id": payout["provider_id"]}, {"user_id": 1})
            if prov:
                await self.events.emit(
                    user_id=prov["user_id"], event_type="PAYOUT_FAILED",
                    data={"amount_paise": int(payout["amount_paise"])},
                    idempotency_key=f"payout_failed:{payout_id}",
                )
        return payout

    # ---- Queries -----------------------------------------------------------
    async def list_for_provider(self, *, provider_id: str, limit: int = 50) -> list[dict]:
        return await self.db.payouts.find({"provider_id": provider_id}, {"_id": 0}) \
            .sort("requested_at", -1).limit(min(limit, 200)).to_list(limit)

    async def list_admin(self, *, skip: int = 0, limit: int = 50, state: Optional[str] = None) -> list[dict]:
        q: dict = {}
        if state:
            q["state"] = state
        return await self.db.payouts.find(q, {"_id": 0}) \
            .sort("requested_at", -1).skip(skip).limit(min(limit, 200)).to_list(limit)
