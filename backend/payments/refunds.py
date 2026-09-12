"""RefundService — creates and executes refunds via gateway, updates payment state,
and delegates provider earning reversal to EarningsService.

Booking cancellation policy remains inside the Booking Engine. This module only
executes the financial consequence.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
import uuid
from motor.motor_asyncio import AsyncIOMotorDatabase
from .types import RefundState, PaymentState
from .gateway import PaymentGatewayProvider
from .earnings import EarningsService


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RefundService:
    def __init__(self, db: AsyncIOMotorDatabase, gateway: PaymentGatewayProvider,
                 earnings: EarningsService, events=None):
        self.db = db
        self.gateway = gateway
        self.earnings = earnings
        self.events = events

    async def _max_refundable(self, payment: dict) -> int:
        already = int(payment.get("refunded_paise") or 0)
        return max(0, int(payment.get("amount_paise") or 0) - already)

    # -----------------------------------------------------------------------
    async def create(
        self,
        *,
        payment_id: str,
        requested_amount_paise: Optional[int],
        reason: Optional[str],
        requested_by_user_id: str,
        source: str = "customer",  # "customer" | "admin" | "system"
    ) -> dict:
        payment = await self.db.payments.find_one({"id": payment_id}, {"_id": 0})
        if not payment:
            raise ValueError("payment_not_found")
        if payment.get("state") not in (PaymentState.CAPTURED.value,
                                         PaymentState.PARTIALLY_REFUNDED.value,
                                         PaymentState.REFUND_PENDING.value):
            raise ValueError("payment_not_refundable")

        max_refund = await self._max_refundable(payment)
        if max_refund <= 0:
            raise ValueError("nothing_to_refund")
        amt = int(requested_amount_paise or max_refund)
        if amt <= 0 or amt > max_refund:
            raise ValueError("invalid_amount")

        # Concurrency: mark payment as REFUND_PENDING atomically only if valid state
        upd = await self.db.payments.find_one_and_update(
            {"id": payment_id, "state": {"$in": [
                PaymentState.CAPTURED.value, PaymentState.PARTIALLY_REFUNDED.value
            ]}},
            {"$set": {"state": PaymentState.REFUND_PENDING.value, "updated_at": _now()}},
        )
        if not upd:
            # Another refund is already pending — still allow creating a record but don't re-lock
            pass

        now = _now()
        refund_doc = {
            "id": str(uuid.uuid4()),
            "payment_id": payment_id,
            "booking_id": payment["booking_id"],
            "requested_amount_paise": amt,
            "approved_amount_paise": amt,
            "gateway_refund_id": None,
            "state": RefundState.PROCESSING.value,
            "reason": reason,
            "requested_by": requested_by_user_id,
            "source": source,
            "created_at": now,
            "completed_at": None,
        }
        await self.db.refunds.insert_one(refund_doc)

        # Execute at gateway
        result = await self.gateway.refund_payment(
            gateway_payment_id=payment.get("gateway_payment_id") or "",
            amount_paise=amt,
            notes={"booking_id": payment["booking_id"], "refund_id": refund_doc["id"]},
        )
        if not result.ok:
            await self.db.refunds.update_one(
                {"id": refund_doc["id"]},
                {"$set": {"state": RefundState.FAILED.value,
                          "failure_reason": result.failure_reason, "completed_at": _now()}},
            )
            # Revert payment state
            await self.db.payments.update_one(
                {"id": payment_id, "state": PaymentState.REFUND_PENDING.value},
                {"$set": {"state": PaymentState.CAPTURED.value, "updated_at": _now()}},
            )
            refund_doc["state"] = RefundState.FAILED.value
            refund_doc["failure_reason"] = result.failure_reason
            return refund_doc

        # Success
        new_refunded_total = int(payment.get("refunded_paise") or 0) + amt
        is_full = new_refunded_total >= int(payment["amount_paise"])
        new_state = PaymentState.REFUNDED.value if is_full else PaymentState.PARTIALLY_REFUNDED.value

        await self.db.refunds.update_one(
            {"id": refund_doc["id"]},
            {"$set": {"state": RefundState.COMPLETED.value,
                      "gateway_refund_id": result.gateway_refund_id,
                      "completed_at": _now()}},
        )
        await self.db.payments.update_one(
            {"id": payment_id},
            {"$set": {"state": new_state, "updated_at": _now()},
             "$inc": {"refunded_paise": amt}},
        )

        # Reflect on booking.payment_status for legacy UI
        legacy = "PARTIALLY_REFUNDED" if not is_full else "REFUNDED"
        await self.db.bookings.update_one(
            {"id": payment["booking_id"]},
            {"$set": {"payment_status": legacy, "updated_at": _now()}},
        )

        # Provider earning reversal
        await self.earnings.apply_refund_adjustment(
            booking_id=payment["booking_id"],
            refund_amount_paise=amt,
            reason=reason or "refund",
        )

        # Notifications (customer)
        if self.events:
            cust = await self.db.customers.find_one({"id": payment["customer_id"]}, {"user_id": 1})
            if cust:
                await self.events.emit(
                    user_id=cust["user_id"],
                    event_type="REFUND_COMPLETED",
                    data={"amount_paise": amt, "booking_ref": payment["booking_id"][:8]},
                    booking_id=payment["booking_id"],
                    idempotency_key=f"refund_completed:{refund_doc['id']}",
                )

        refund_doc["state"] = RefundState.COMPLETED.value
        refund_doc["gateway_refund_id"] = result.gateway_refund_id
        refund_doc["completed_at"] = _now()
        return refund_doc

    async def list_for_booking(self, booking_id: str) -> list[dict]:
        return await self.db.refunds.find({"booking_id": booking_id}, {"_id": 0}) \
            .sort("created_at", -1).to_list(50)

    async def list_all(self, *, skip: int = 0, limit: int = 50,
                       state: Optional[str] = None) -> list[dict]:
        q: dict = {}
        if state:
            q["state"] = state
        return await self.db.refunds.find(q, {"_id": 0}) \
            .sort("created_at", -1).skip(skip).limit(min(limit, 200)).to_list(limit)
