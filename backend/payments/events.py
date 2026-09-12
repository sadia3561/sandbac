"""Internal payment event bus — piggy-backs on the existing realtime hub + notifications."""
from __future__ import annotations
import logging
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorDatabase
from datetime import datetime, timezone
import uuid

log = logging.getLogger("sandbac.payments.events")


PAYMENT_EVENT_TEMPLATES = {
    "PAYMENT_INITIATED": {
        "title": "Payment started",
        "body": "Your payment for booking {booking_ref} has started.",
    },
    "PAYMENT_CAPTURED": {
        "title": "Payment successful",
        "body": "Your payment of ₹{amount_rupees} for booking {booking_ref} was successful.",
    },
    "PAYMENT_FAILED": {
        "title": "Payment failed",
        "body": "Payment for booking {booking_ref} failed. You can try again.",
    },
    "PAYMENT_VERIFICATION_FAILED": {
        "title": "Payment verification failed",
        "body": "We couldn't verify your payment for booking {booking_ref}.",
    },
    "REFUND_INITIATED": {
        "title": "Refund initiated",
        "body": "A refund of ₹{amount_rupees} is being processed for booking {booking_ref}.",
    },
    "REFUND_COMPLETED": {
        "title": "Refund complete",
        "body": "₹{amount_rupees} has been refunded for booking {booking_ref}.",
    },
    "EARNING_CREATED": {
        "title": "New earning",
        "body": "You've earned ₹{amount_rupees} from a completed service.",
    },
    "EARNING_AVAILABLE": {
        "title": "Earning available",
        "body": "₹{amount_rupees} is now available in your SANDBAC wallet.",
    },
    "EARNING_REVERSED": {
        "title": "Earning adjusted",
        "body": "An adjustment of ₹{amount_rupees} was applied to a past service.",
    },
    "PAYOUT_REQUESTED": {
        "title": "Payout requested",
        "body": "Your payout of ₹{amount_rupees} has been requested.",
    },
    "PAYOUT_COMPLETED": {
        "title": "Payout completed",
        "body": "₹{amount_rupees} has been transferred to your account.",
    },
    "PAYOUT_FAILED": {
        "title": "Payout failed",
        "body": "Your payout of ₹{amount_rupees} failed. Please contact support.",
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PaymentEventBus:
    """Fire-and-forget event emitter. Writes an in-app notification and emits via WS."""

    def __init__(self, db: AsyncIOMotorDatabase, hub=None):
        self.db = db
        self.hub = hub

    async def emit(
        self,
        *,
        user_id: str,
        event_type: str,
        data: dict,
        booking_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Optional[dict]:
        try:
            tpl = PAYMENT_EVENT_TEMPLATES.get(event_type, {"title": event_type, "body": ""})
            data = dict(data)
            if "amount_paise" in data and "amount_rupees" not in data:
                data["amount_rupees"] = f"{int(data['amount_paise']) / 100:.2f}"
            try:
                title = tpl["title"].format(**data)
                body = tpl["body"].format(**data)
            except Exception:
                title, body = tpl["title"], tpl["body"]
            if idempotency_key:
                existing = await self.db.notifications.find_one({
                    "event_id": idempotency_key, "user_id": user_id
                })
                if existing:
                    return None
            doc = {
                "id": str(uuid.uuid4()), "user_id": user_id,
                "type": event_type, "title": title, "message": body,
                "booking_id": booking_id, "read": False,
                "event_id": idempotency_key,
                "metadata": {k: v for k, v in data.items() if k not in ("card", "cvv", "otp", "token")},
                "created_at": _now(),
            }
            await self.db.notifications.insert_one(doc)
            if self.hub is not None:
                payload = {"notification": {k: v for k, v in doc.items() if k != "_id"},
                           "ts": doc["created_at"].isoformat()}
                try: await self.hub.emit(user_id, event_type, payload)
                except Exception: pass
                try: await self.hub.emit(user_id, "notification.created.v1", payload)
                except Exception: pass
            doc.pop("_id", None)
            return doc
        except Exception as e:
            log.warning("payment event emit failed: %s", e)
            return None
