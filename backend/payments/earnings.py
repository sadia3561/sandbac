"""Provider EarningsService — immutable ledger of platform commission + provider earnings.

- Earning is created ONCE per (booking_id, provider_id) on SERVICE_COMPLETED.
- Refunds create an EarningAdjustment (reversal) rather than mutating the earning.
- Earning becomes AVAILABLE after the configured hold period.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Optional
import uuid
from motor.motor_asyncio import AsyncIOMotorDatabase
from . import constants as C
from .types import EarningState
from .commission import CommissionService


def _now() -> datetime:
    return datetime.now(timezone.utc)


class EarningsService:
    def __init__(self, db: AsyncIOMotorDatabase, commission: CommissionService, events=None):
        self.db = db
        self.commission = commission
        self.events = events

    # ---- Create on service completion (idempotent per booking) --------------
    async def create_for_booking(self, booking: dict) -> Optional[dict]:
        bid = booking["id"]
        provider_id = booking.get("provider_id")
        if not provider_id:
            return None
        # Idempotent guard: unique on (booking_id, provider_id)
        existing = await self.db.earnings.find_one({"booking_id": bid, "provider_id": provider_id}, {"_id": 0})
        if existing:
            return existing
        service_id = booking.get("service_id")
        # Resolve category via service
        category_id = None
        if service_id:
            svc = await self.db.services.find_one({"id": service_id}, {"_id": 0, "category_id": 1})
            if svc:
                category_id = svc.get("category_id")
        gross = int(booking.get("price_paise") or 0)
        pct, commission_paise, earning_paise = await self.commission.calculate(
            gross_paise=gross, provider_id=provider_id, service_id=service_id, category_id=category_id
        )
        now = _now()
        available_at = now + timedelta(days=C.EARNINGS_HOLD_DAYS)
        state = EarningState.AVAILABLE.value if C.EARNINGS_HOLD_DAYS <= 0 else EarningState.PENDING.value
        doc = {
            "id": str(uuid.uuid4()),
            "booking_id": bid,
            "provider_id": provider_id,
            "gross_amount_paise": gross,
            "commission_percent": pct,
            "commission_amount_paise": commission_paise,
            "adjustment_paise": 0,
            "final_amount_paise": earning_paise,
            "state": state,
            "becomes_available_at": available_at,
            "created_at": now,
            "updated_at": now,
        }
        try:
            await self.db.earnings.insert_one(doc)
        except Exception:
            # Race → re-read
            found = await self.db.earnings.find_one({"booking_id": bid, "provider_id": provider_id}, {"_id": 0})
            return found
        doc.pop("_id", None)
        if self.events:
            prov = await self.db.providers.find_one({"id": provider_id}, {"user_id": 1})
            if prov:
                await self.events.emit(
                    user_id=prov["user_id"], event_type="EARNING_CREATED",
                    data={"amount_paise": earning_paise, "booking_ref": bid[:8]},
                    booking_id=bid, idempotency_key=f"earning_created:{doc['id']}",
                )
        return doc

    # ---- Refund reversal (immutable — append adjustment) --------------------
    async def apply_refund_adjustment(self, *, booking_id: str, refund_amount_paise: int, reason: str) -> Optional[dict]:
        earning = await self.db.earnings.find_one({"booking_id": booking_id}, {"_id": 0})
        if not earning:
            return None
        # Reversal proportional to refund vs gross
        gross = int(earning.get("gross_amount_paise") or 0)
        if gross <= 0:
            return None
        ratio_num = int(refund_amount_paise)
        # Provider portion of the refund equals (final_amount_paise * refund/gross)
        provider_reversal = -(int(earning.get("final_amount_paise") or 0) * ratio_num) // gross
        adjustment_doc = {
            "id": str(uuid.uuid4()),
            "earning_id": earning["id"],
            "booking_id": booking_id,
            "amount_paise": provider_reversal,   # negative
            "reason": reason,
            "created_at": _now(),
        }
        await self.db.earning_adjustments.insert_one(adjustment_doc)

        # Update earning aggregate (adjustment sum + state)
        new_adjustment = int(earning.get("adjustment_paise", 0)) + provider_reversal
        new_final = int(earning.get("final_amount_paise", 0)) + provider_reversal
        new_state = earning.get("state")
        # Full reversal → REVERSED (and never eligible for payout)
        if new_final <= 0 and earning.get("state") not in (EarningState.PAID.value,):
            new_state = EarningState.REVERSED.value
            new_final = 0
        await self.db.earnings.update_one(
            {"id": earning["id"]},
            {"$set": {
                "adjustment_paise": new_adjustment,
                "final_amount_paise": max(new_final, 0),
                "state": new_state,
                "updated_at": _now(),
            }},
        )
        if self.events:
            prov = await self.db.providers.find_one({"id": earning["provider_id"]}, {"user_id": 1})
            if prov:
                await self.events.emit(
                    user_id=prov["user_id"], event_type="EARNING_REVERSED",
                    data={"amount_paise": abs(provider_reversal), "booking_ref": booking_id[:8]},
                    booking_id=booking_id,
                    idempotency_key=f"earning_reversed:{adjustment_doc['id']}",
                )
        return adjustment_doc

    # ---- Ledger queries -----------------------------------------------------
    async def promote_available(self) -> int:
        """Move PENDING earnings past hold period → AVAILABLE. Returns count."""
        r = await self.db.earnings.update_many(
            {"state": EarningState.PENDING.value, "becomes_available_at": {"$lte": _now()}},
            {"$set": {"state": EarningState.AVAILABLE.value, "updated_at": _now()}},
        )
        return int(r.modified_count)

    async def list_for_provider(self, *, provider_id: str, skip: int = 0, limit: int = 50) -> list[dict]:
        return await self.db.earnings.find({"provider_id": provider_id}, {"_id": 0}) \
            .sort("created_at", -1).skip(skip).limit(min(limit, 200)).to_list(limit)

    async def provider_summary(self, *, provider_id: str) -> dict:
        pipeline = [
            {"$match": {"provider_id": provider_id}},
            {"$group": {"_id": "$state", "total": {"$sum": "$final_amount_paise"}, "count": {"$sum": 1}}},
        ]
        buckets = {b["_id"]: b async for b in self.db.earnings.aggregate(pipeline)}
        get = lambda s: int((buckets.get(s) or {}).get("total", 0))
        return {
            "pending_paise": get("PENDING"),
            "available_paise": get("AVAILABLE"),
            "on_hold_paise": get("ON_HOLD"),
            "paid_paise": get("PAID"),
            "reversed_paise": get("REVERSED"),
            "total_earned_paise": get("AVAILABLE") + get("PAID") + get("PENDING"),
        }

    async def admin_totals(self) -> dict:
        pipeline = [
            {"$group": {
                "_id": None,
                "gross": {"$sum": "$gross_amount_paise"},
                "commission": {"$sum": "$commission_amount_paise"},
                "provider": {"$sum": "$final_amount_paise"},
                "count": {"$sum": 1},
            }}
        ]
        r = await self.db.earnings.aggregate(pipeline).to_list(1)
        if not r:
            return {"gross_paise": 0, "commission_paise": 0, "provider_paise": 0, "count": 0}
        return {
            "gross_paise": int(r[0]["gross"]),
            "commission_paise": int(r[0]["commission"]),
            "provider_paise": int(r[0]["provider"]),
            "count": int(r[0]["count"]),
        }

    async def mark_paid(self, *, earning_ids: list[str], payout_id: str) -> int:
        r = await self.db.earnings.update_many(
            {"id": {"$in": earning_ids}, "state": EarningState.AVAILABLE.value},
            {"$set": {"state": EarningState.PAID.value, "payout_id": payout_id, "updated_at": _now()}},
        )
        return int(r.modified_count)

    async def revert_paid_to_available(self, *, earning_ids: list[str]) -> int:
        r = await self.db.earnings.update_many(
            {"id": {"$in": earning_ids}, "state": EarningState.PAID.value},
            {"$set": {"state": EarningState.AVAILABLE.value, "updated_at": _now()},
             "$unset": {"payout_id": ""}},
        )
        return int(r.modified_count)
