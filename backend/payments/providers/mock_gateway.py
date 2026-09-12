"""Mock payment gateway — Razorpay-shaped, HMAC-signed, fully deterministic.

Real gateways (Razorpay/Stripe/etc.) plug in behind the same PaymentGatewayProvider
interface. The mock exists so end-to-end payment flows (checkout → verify →
webhook → refund) work in development without any external credentials.
"""
from __future__ import annotations
import hmac
import hashlib
import json
import secrets
from typing import Optional
from datetime import datetime, timezone
from .. import constants as C
from ..gateway import (
    PaymentGatewayProvider,
    GatewayOrder,
    GatewayVerifyResult,
    GatewayRefundResult,
    GatewayWebhookEvent,
)


def _hmac_sha256(secret: str, message: str) -> str:
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


class MockGateway(PaymentGatewayProvider):
    """Razorpay-shaped mock. Signature = HMAC_SHA256(secret, f"{order_id}|{payment_id}")."""

    name = "mock"

    def __init__(self, key_id: Optional[str] = None, key_secret: Optional[str] = None,
                 webhook_secret: Optional[str] = None, environment: Optional[str] = None):
        self.key_id = key_id or C.GATEWAY_KEY_ID or "mock_key_id"
        self.key_secret = key_secret or C.GATEWAY_KEY_SECRET or "mock_key_secret"
        self.webhook_secret = webhook_secret or C.GATEWAY_WEBHOOK_SECRET or "mock_webhook_secret"
        self.environment = environment or C.GATEWAY_ENVIRONMENT or "test"

    # ----- Client config (safe to expose) -------------------------------------
    def client_config(self) -> dict:
        return {
            "gateway": self.name,
            "environment": self.environment,
            "key_id": self.key_id,
        }

    # ----- Order --------------------------------------------------------------
    async def create_order(
        self, *, amount_paise: int, currency: str, receipt: str, notes: Optional[dict] = None
    ) -> GatewayOrder:
        if amount_paise <= 0:
            raise ValueError("amount must be positive")
        oid = f"order_mock_{secrets.token_urlsafe(12)}"
        return GatewayOrder(
            order_id=oid,
            amount_paise=int(amount_paise),
            currency=currency,
            provider=self.name,
            extra={
                "receipt": receipt,
                "notes": notes or {},
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    # ----- Verify (payment callback signature check) --------------------------
    async def verify_payment(
        self, *, gateway_order_id: str, gateway_payment_id: str, gateway_signature: str,
        expected_amount_paise: int, expected_currency: str,
    ) -> GatewayVerifyResult:
        expected_sig = _hmac_sha256(self.key_secret, f"{gateway_order_id}|{gateway_payment_id}")
        if not hmac.compare_digest(expected_sig, gateway_signature or ""):
            return GatewayVerifyResult(ok=False, failure_reason="signature_mismatch")
        # In a real gateway we'd fetch amount/currency from provider API. Mock trusts sig.
        return GatewayVerifyResult(
            ok=True,
            gateway_payment_id=gateway_payment_id,
            gateway_signature=gateway_signature,
            amount_paise=expected_amount_paise,
            currency=expected_currency,
            captured=True,
        )

    async def capture_payment(
        self, *, gateway_payment_id: str, amount_paise: int, currency: str,
    ) -> GatewayVerifyResult:
        # Mock: capture always succeeds
        return GatewayVerifyResult(
            ok=True, gateway_payment_id=gateway_payment_id,
            amount_paise=amount_paise, currency=currency, captured=True,
        )

    # ----- Refund -------------------------------------------------------------
    async def refund_payment(
        self, *, gateway_payment_id: str, amount_paise: int, notes: Optional[dict] = None,
    ) -> GatewayRefundResult:
        if amount_paise <= 0:
            return GatewayRefundResult(ok=False, failure_reason="invalid_amount")
        rid = f"rfnd_mock_{secrets.token_urlsafe(10)}"
        return GatewayRefundResult(ok=True, gateway_refund_id=rid, amount_paise=amount_paise)

    # ----- Webhook ------------------------------------------------------------
    def verify_webhook(self, *, raw_body: bytes, signature_header: str) -> Optional[GatewayWebhookEvent]:
        expected_sig = _hmac_sha256(self.webhook_secret, raw_body.decode("utf-8"))
        if not hmac.compare_digest(expected_sig, (signature_header or "")):
            return None
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except Exception:
            return None
        # Razorpay-shaped: {"event": "payment.captured", "id": "...", "payload":{"payment":{"entity":{...}}}}
        event_id = str(payload.get("id") or payload.get("event_id") or "")
        event_type = str(payload.get("event", ""))
        entity = ((payload.get("payload") or {}).get("payment") or {}).get("entity") or {}
        return GatewayWebhookEvent(
            ok=True,
            event_id=event_id,
            event_type=event_type,
            gateway_order_id=entity.get("order_id"),
            gateway_payment_id=entity.get("id"),
            amount_paise=entity.get("amount"),
            currency=entity.get("currency"),
            raw=payload,
        )

    # ----- Status probe -------------------------------------------------------
    async def get_payment_status(self, *, gateway_payment_id: str) -> GatewayVerifyResult:
        return GatewayVerifyResult(ok=True, gateway_payment_id=gateway_payment_id, captured=True)

    # ----- Testing helpers (not part of the interface) ------------------------
    def compute_signature(self, gateway_order_id: str, gateway_payment_id: str) -> str:
        return _hmac_sha256(self.key_secret, f"{gateway_order_id}|{gateway_payment_id}")

    def compute_webhook_signature(self, raw_body: bytes) -> str:
        return _hmac_sha256(self.webhook_secret, raw_body.decode("utf-8"))
