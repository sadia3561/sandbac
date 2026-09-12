"""PaymentService — coordinates the payment lifecycle for a booking.

- Creates a Payment (state=INITIATED) and a PaymentAttempt.
- Verifies gateway callback and moves state → CAPTURED (or FAILED).
- Preserves history on retries.
- Booking payment_status field is a compatibility mirror; the authoritative state
  lives on `payments.state`.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Any
import uuid
import asyncio
import logging
from motor.motor_asyncio import AsyncIOMotorDatabase
from .types import (
    PaymentState, PaymentAttemptState, PAYMENT_TRANSITIONS, LEGACY_PAYMENT_STATUS,
    GatewayOrderPayload,
)
from .gateway import PaymentGatewayProvider
from . import constants as C

log = logging.getLogger("sandbac.payments.service")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PaymentService:
    def __init__(self, db: AsyncIOMotorDatabase, gateway: PaymentGatewayProvider, events=None):
        self.db = db
        self.gateway = gateway
        self.events = events
        self._lock = asyncio.Lock()

    # -----------------------------------------------------------------------
    async def _get_active_payment(self, booking_id: str) -> Optional[dict]:
        """Return the current in-flight payment (INITIATED or AUTHORIZED)."""
        return await self.db.payments.find_one(
            {"booking_id": booking_id,
             "state": {"$in": [PaymentState.INITIATED.value, PaymentState.AUTHORIZED.value]}},
            {"_id": 0},
        )

    async def _get_captured_payment(self, booking_id: str) -> Optional[dict]:
        return await self.db.payments.find_one(
            {"booking_id": booking_id,
             "state": {"$in": [PaymentState.CAPTURED.value,
                                PaymentState.PARTIALLY_REFUNDED.value,
                                PaymentState.REFUND_PENDING.value]}},
            {"_id": 0},
        )

    async def _transition(self, payment_id: str, from_state: str, to_state: str, extra: Optional[dict] = None) -> Optional[dict]:
        allowed = PAYMENT_TRANSITIONS.get(from_state, set())
        if to_state not in allowed:
            log.warning("invalid payment transition %s → %s (payment=%s)", from_state, to_state, payment_id)
            return None
        setter = {"state": to_state, "updated_at": _now()}
        if extra:
            setter.update(extra)
        return await self.db.payments.find_one_and_update(
            {"id": payment_id, "state": from_state},
            {"$set": setter},
            return_document=True,
        )

    async def _sync_booking_payment_status(self, booking_id: str, payment_state: str) -> None:
        legacy = LEGACY_PAYMENT_STATUS.get(payment_state)
        if legacy:
            await self.db.bookings.update_one(
                {"id": booking_id},
                {"$set": {"payment_status": legacy, "updated_at": _now()}},
            )

    # ---- Create order (retryable) -----------------------------------------
    async def create_order_for_booking(self, *, booking: dict, customer: dict) -> dict:
        booking_id = booking["id"]
        # Reject if already captured
        captured = await self._get_captured_payment(booking_id)
        if captured:
            raise ValueError("already_paid")

        # Reuse in-flight payment if amount matches; else supersede as FAILED to keep history
        expected_amount = int(booking.get("price_paise") or 0)
        if expected_amount <= 0:
            raise ValueError("invalid_amount")

        # Enforce attempt cap
        attempts_used = await self.db.payment_attempts.count_documents({"booking_id": booking_id})
        if attempts_used >= C.MAX_PAYMENT_ATTEMPTS:
            raise ValueError("too_many_attempts")

        async with self._lock:
            payment = await self._get_active_payment(booking_id)
            if payment and int(payment.get("amount_paise") or 0) == expected_amount:
                # Fresh attempt on same payment record
                pass
            else:
                # If mismatched or none, close any prior INITIATED as FAILED (history preserved)
                if payment:
                    await self.db.payments.update_one(
                        {"id": payment["id"], "state": PaymentState.INITIATED.value},
                        {"$set": {"state": PaymentState.FAILED.value,
                                  "failure_reason": "superseded_by_retry",
                                  "updated_at": _now()}},
                    )
                # Create new Payment record
                now = _now()
                payment = {
                    "id": str(uuid.uuid4()),
                    "booking_id": booking_id,
                    "customer_id": booking["customer_id"],
                    "customer_user_id": customer["id"],
                    "gateway": self.gateway.name,
                    "gateway_order_id": None,
                    "gateway_payment_id": None,
                    "amount_paise": expected_amount,
                    "currency": C.DEFAULT_CURRENCY,
                    "state": PaymentState.INITIATED.value,
                    "paid_at": None,
                    "failure_reason": None,
                    "attempts": 0,
                    "refunded_paise": 0,
                    "created_at": now,
                    "updated_at": now,
                }
                await self.db.payments.insert_one(payment)
                payment.pop("_id", None)

            # Create gateway order for this attempt
            gorder = await self.gateway.create_order(
                amount_paise=expected_amount,
                currency=C.DEFAULT_CURRENCY,
                receipt=f"bk_{booking_id[:8]}",
                notes={"booking_id": booking_id, "payment_id": payment["id"]},
            )

            # Persist attempt
            attempt_no = int(payment.get("attempts") or 0) + 1
            attempt = {
                "id": str(uuid.uuid4()),
                "payment_id": payment["id"],
                "booking_id": booking_id,
                "attempt_no": attempt_no,
                "gateway_order_id": gorder.order_id,
                "gateway_payment_id": None,
                "amount_paise": expected_amount,
                "state": PaymentAttemptState.INITIATED.value,
                "failure_reason": None,
                "created_at": _now(),
            }
            await self.db.payment_attempts.insert_one(attempt)

            await self.db.payments.update_one(
                {"id": payment["id"]},
                {"$set": {"gateway_order_id": gorder.order_id,
                          "attempts": attempt_no,
                          "updated_at": _now()}},
            )
            await self._sync_booking_payment_status(booking_id, PaymentState.INITIATED.value)

        client_cfg = self.gateway.client_config()
        payload = GatewayOrderPayload(
            gateway=client_cfg["gateway"],
            environment=client_cfg["environment"],
            key_id=client_cfg["key_id"],
            gateway_order_id=gorder.order_id,
            amount_paise=expected_amount,
            currency=C.DEFAULT_CURRENCY,
            booking_id=booking_id,
            payment_id=payment["id"],
            attempt_no=attempt_no,
            checkout_notes={"receipt": f"bk_{booking_id[:8]}"},
        )
        if self.events:
            await self.events.emit(
                user_id=customer["id"], event_type="PAYMENT_INITIATED",
                data={"amount_paise": expected_amount, "booking_ref": booking_id[:8]},
                booking_id=booking_id,
                idempotency_key=f"payment_initiated:{payment['id']}:{attempt_no}",
            )
        return {
            "payment_id": payment["id"],
            "booking_id": booking_id,
            "state": PaymentState.INITIATED.value,
            "amount_paise": expected_amount,
            "currency": C.DEFAULT_CURRENCY,
            "attempt_no": attempt_no,
            "gateway_payload": payload.model_dump(),
        }

    # ---- Verify + capture --------------------------------------------------
    async def verify_and_capture(
        self, *, payment_id: str, gateway_order_id: str,
        gateway_payment_id: str, gateway_signature: str, customer_user_id: str,
    ) -> dict:
        payment = await self.db.payments.find_one({"id": payment_id}, {"_id": 0})
        if not payment:
            raise ValueError("payment_not_found")
        if payment["customer_user_id"] != customer_user_id:
            raise ValueError("forbidden")
        if payment["state"] == PaymentState.CAPTURED.value:
            return payment  # idempotent
        if payment["state"] not in (PaymentState.INITIATED.value, PaymentState.AUTHORIZED.value):
            raise ValueError("invalid_state")
        if payment["gateway_order_id"] != gateway_order_id:
            raise ValueError("order_mismatch")

        booking = await self.db.bookings.find_one({"id": payment["booking_id"]}, {"_id": 0, "price_paise": 1})
        if not booking:
            raise ValueError("booking_missing")
        expected_amount = int(booking.get("price_paise") or 0)

        result = await self.gateway.verify_payment(
            gateway_order_id=gateway_order_id,
            gateway_payment_id=gateway_payment_id,
            gateway_signature=gateway_signature,
            expected_amount_paise=expected_amount,
            expected_currency=C.DEFAULT_CURRENCY,
        )
        if not result.ok:
            # Mark attempt failed (do NOT mark whole payment failed — allow retry via new order)
            await self.db.payment_attempts.update_one(
                {"payment_id": payment_id, "gateway_order_id": gateway_order_id,
                 "state": PaymentAttemptState.INITIATED.value},
                {"$set": {"state": PaymentAttemptState.FAILED.value,
                          "failure_reason": result.failure_reason,
                          "gateway_payment_id": gateway_payment_id}},
            )
            if self.events:
                await self.events.emit(
                    user_id=customer_user_id, event_type="PAYMENT_VERIFICATION_FAILED",
                    data={"amount_paise": expected_amount, "booking_ref": payment["booking_id"][:8]},
                    booking_id=payment["booking_id"],
                    idempotency_key=f"payment_verify_failed:{payment_id}:{gateway_payment_id}",
                )
            raise ValueError(f"signature_verification_failed:{result.failure_reason}")

        if int(result.amount_paise or 0) != expected_amount:
            raise ValueError("amount_mismatch")
        if (result.currency or C.DEFAULT_CURRENCY) != C.DEFAULT_CURRENCY:
            raise ValueError("currency_mismatch")

        # Atomic capture
        captured = await self._transition(
            payment_id, payment["state"], PaymentState.CAPTURED.value,
            extra={"gateway_payment_id": gateway_payment_id,
                   "paid_at": _now(),
                   "failure_reason": None},
        )
        if not captured:
            # Someone else captured — treat as success (idempotency)
            captured = await self.db.payments.find_one({"id": payment_id}, {"_id": 0})
            return captured

        # Attempt success
        await self.db.payment_attempts.update_one(
            {"payment_id": payment_id, "gateway_order_id": gateway_order_id,
             "state": PaymentAttemptState.INITIATED.value},
            {"$set": {"state": PaymentAttemptState.CAPTURED.value,
                      "gateway_payment_id": gateway_payment_id}},
        )
        await self._sync_booking_payment_status(payment["booking_id"], PaymentState.CAPTURED.value)
        if self.events:
            await self.events.emit(
                user_id=customer_user_id, event_type="PAYMENT_CAPTURED",
                data={"amount_paise": expected_amount, "booking_ref": payment["booking_id"][:8]},
                booking_id=payment["booking_id"],
                idempotency_key=f"payment_captured:{payment_id}",
            )
        captured.pop("_id", None)
        return captured

    # ---- Mark attempt failed (frontend reports failure) -------------------
    async def mark_attempt_failed(self, *, payment_id: str, gateway_order_id: str, reason: str) -> None:
        await self.db.payment_attempts.update_one(
            {"payment_id": payment_id, "gateway_order_id": gateway_order_id,
             "state": PaymentAttemptState.INITIATED.value},
            {"$set": {"state": PaymentAttemptState.FAILED.value,
                      "failure_reason": reason[:200]}},
        )

    # ---- Queries -----------------------------------------------------------
    async def get_for_customer(self, *, payment_id: str, customer_user_id: str) -> Optional[dict]:
        return await self.db.payments.find_one(
            {"id": payment_id, "customer_user_id": customer_user_id}, {"_id": 0},
        )

    async def list_for_customer(self, *, customer_user_id: str, skip: int = 0, limit: int = 30) -> list[dict]:
        return await self.db.payments.find({"customer_user_id": customer_user_id}, {"_id": 0}) \
            .sort("created_at", -1).skip(skip).limit(min(limit, 100)).to_list(limit)

    async def list_attempts(self, *, booking_id: str) -> list[dict]:
        return await self.db.payment_attempts.find({"booking_id": booking_id}, {"_id": 0}) \
            .sort("created_at", 1).to_list(200)

    async def admin_list(self, *, state: Optional[str] = None, skip: int = 0, limit: int = 50) -> list[dict]:
        q: dict = {}
        if state:
            q["state"] = state
        return await self.db.payments.find(q, {"_id": 0}) \
            .sort("created_at", -1).skip(skip).limit(min(limit, 200)).to_list(limit)

    async def admin_totals(self) -> dict:
        pipeline = [
            {"$group": {"_id": "$state", "count": {"$sum": 1}, "sum": {"$sum": "$amount_paise"}}}
        ]
        buckets = {b["_id"]: b async for b in self.db.payments.aggregate(pipeline)}
        def _g(s):
            return {"count": int((buckets.get(s) or {}).get("count", 0)),
                    "paise":  int((buckets.get(s) or {}).get("sum", 0))}
        total_pipe = [{"$group": {"_id": None, "count": {"$sum": 1}, "sum": {"$sum": "$amount_paise"}}}]
        total = await self.db.payments.aggregate(total_pipe).to_list(1)
        return {
            "total": {"count": int(total[0]["count"]) if total else 0,
                       "paise": int(total[0]["sum"]) if total else 0},
            "captured": _g("CAPTURED"),
            "failed":   _g("FAILED"),
            "initiated":_g("INITIATED"),
            "refunded": _g("REFUNDED"),
            "partially_refunded": _g("PARTIALLY_REFUNDED"),
        }
