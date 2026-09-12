"""WebhookService — receives gateway webhook events, verifies signatures,
enforces idempotency, and routes to PaymentService/RefundService.
"""
from __future__ import annotations
from datetime import datetime, timezone
import logging
from motor.motor_asyncio import AsyncIOMotorDatabase
from .gateway import PaymentGatewayProvider
from .types import PaymentState, PAYMENT_TRANSITIONS, LEGACY_PAYMENT_STATUS
from .service import PaymentService

log = logging.getLogger("sandbac.payments.webhook")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class WebhookService:
    """Signature-verified, idempotent webhook event router."""

    def __init__(self, db: AsyncIOMotorDatabase, gateway: PaymentGatewayProvider,
                 payment_service: PaymentService, events=None):
        self.db = db
        self.gateway = gateway
        self.payment_service = payment_service
        self.events = events

    async def handle(self, *, raw_body: bytes, signature_header: str) -> dict:
        event = self.gateway.verify_webhook(raw_body=raw_body, signature_header=signature_header)
        if not event or not event.ok:
            return {"ok": False, "reason": "invalid_signature"}

        # Idempotency using webhook_events unique index on gateway_event_id
        try:
            await self.db.webhook_events.insert_one({
                "gateway": self.gateway.name,
                "gateway_event_id": event.event_id or f"anon_{_now().isoformat()}",
                "event_type": event.event_type,
                "payload": event.raw,
                "processed": False,
                "created_at": _now(),
            })
        except Exception:
            # Duplicate → already handled
            return {"ok": True, "duplicate": True}

        result: dict = {"ok": True, "event_type": event.event_type}
        try:
            if event.event_type in ("payment.captured", "payment.authorized"):
                await self._route_capture(event)
            elif event.event_type == "payment.failed":
                await self._route_failure(event)
            elif event.event_type == "refund.processed":
                await self._route_refund(event)
            else:
                log.info("Unhandled webhook event: %s", event.event_type)
        except Exception as e:
            log.exception("webhook handler failed: %s", e)
            await self.db.webhook_events.update_one(
                {"gateway_event_id": event.event_id},
                {"$set": {"processed": False, "error": str(e)[:400], "processed_at": _now()}},
            )
            return {"ok": False, "reason": "handler_error"}

        await self.db.webhook_events.update_one(
            {"gateway_event_id": event.event_id},
            {"$set": {"processed": True, "processed_at": _now()}},
        )
        return result

    # -- event routers -----------------------------------------------------
    async def _route_capture(self, event) -> None:
        if not event.gateway_order_id:
            return
        payment = await self.db.payments.find_one(
            {"gateway_order_id": event.gateway_order_id}, {"_id": 0},
        )
        if not payment:
            return
        if payment["state"] == PaymentState.CAPTURED.value:
            return  # already captured
        # Amount sanity check
        if event.amount_paise is not None and int(event.amount_paise) != int(payment["amount_paise"]):
            log.warning("webhook amount mismatch payment=%s expected=%s got=%s",
                        payment["id"], payment["amount_paise"], event.amount_paise)
            return
        # Atomic transition
        allowed_from = [PaymentState.INITIATED.value, PaymentState.AUTHORIZED.value]
        r = await self.db.payments.find_one_and_update(
            {"id": payment["id"], "state": {"$in": allowed_from}},
            {"$set": {"state": PaymentState.CAPTURED.value,
                      "gateway_payment_id": event.gateway_payment_id,
                      "paid_at": _now(), "updated_at": _now(),
                      "failure_reason": None}},
        )
        if not r:
            return
        await self.db.bookings.update_one(
            {"id": payment["booking_id"]},
            {"$set": {"payment_status": LEGACY_PAYMENT_STATUS[PaymentState.CAPTURED.value],
                      "updated_at": _now()}},
        )
        if self.events:
            cust = await self.db.customers.find_one({"id": payment["customer_id"]}, {"user_id": 1})
            if cust:
                await self.events.emit(
                    user_id=cust["user_id"], event_type="PAYMENT_CAPTURED",
                    data={"amount_paise": int(payment["amount_paise"]),
                          "booking_ref": payment["booking_id"][:8]},
                    booking_id=payment["booking_id"],
                    idempotency_key=f"payment_captured:{payment['id']}",
                )

    async def _route_failure(self, event) -> None:
        if not event.gateway_order_id:
            return
        payment = await self.db.payments.find_one({"gateway_order_id": event.gateway_order_id}, {"_id": 0})
        if not payment:
            return
        # Only fail if currently in-flight
        await self.db.payments.update_one(
            {"id": payment["id"],
             "state": {"$in": [PaymentState.INITIATED.value, PaymentState.AUTHORIZED.value]}},
            {"$set": {"state": PaymentState.FAILED.value,
                      "failure_reason": "gateway_reported_failure",
                      "gateway_payment_id": event.gateway_payment_id,
                      "updated_at": _now()}},
        )
        if self.events:
            cust = await self.db.customers.find_one({"id": payment["customer_id"]}, {"user_id": 1})
            if cust:
                await self.events.emit(
                    user_id=cust["user_id"], event_type="PAYMENT_FAILED",
                    data={"amount_paise": int(payment["amount_paise"]),
                          "booking_ref": payment["booking_id"][:8]},
                    booking_id=payment["booking_id"],
                    idempotency_key=f"payment_failed:{payment['id']}",
                )

    async def _route_refund(self, event) -> None:
        # Update refund record if this is a matching processed webhook
        if not event.gateway_payment_id:
            return
        # Find refund by gateway_refund_id — mock puts refund id in payment_id slot for demo
        # In real Razorpay we'd have a separate refund.id field on the event.
        rfnd_id = (event.raw.get("payload", {}).get("refund", {}).get("entity", {}) or {}).get("id")
        if not rfnd_id:
            return
        await self.db.refunds.update_one(
            {"gateway_refund_id": rfnd_id, "state": "PROCESSING"},
            {"$set": {"state": "COMPLETED", "completed_at": _now()}},
        )
