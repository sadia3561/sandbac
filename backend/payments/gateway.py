"""Payment gateway abstraction.

Defines the interface that every concrete gateway (mock, razorpay, stripe, …)
must implement. SANDBAC business code depends ONLY on this interface, so the
gateway can be swapped by changing PAYMENT_GATEWAY_PROVIDER env var.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from . import constants as C


# ---------------------------------------------------------------------------
# Result value objects (never raise across the gateway boundary)
# ---------------------------------------------------------------------------
@dataclass
class GatewayOrder:
    order_id: str
    amount_paise: int
    currency: str
    provider: str
    extra: dict


@dataclass
class GatewayVerifyResult:
    ok: bool
    gateway_payment_id: Optional[str] = None
    gateway_signature: Optional[str] = None
    amount_paise: Optional[int] = None
    currency: Optional[str] = None
    captured: bool = False
    failure_reason: Optional[str] = None


@dataclass
class GatewayRefundResult:
    ok: bool
    gateway_refund_id: Optional[str] = None
    amount_paise: Optional[int] = None
    failure_reason: Optional[str] = None


@dataclass
class GatewayWebhookEvent:
    ok: bool
    event_id: str
    event_type: str
    gateway_order_id: Optional[str]
    gateway_payment_id: Optional[str]
    amount_paise: Optional[int]
    currency: Optional[str]
    raw: dict


# ---------------------------------------------------------------------------
# Provider interface
# ---------------------------------------------------------------------------
class PaymentGatewayProvider(ABC):
    """Every gateway implementation must satisfy this contract."""

    name: str = "abstract"

    # Publishable configuration ONLY (never send secret keys to frontend)
    @abstractmethod
    def client_config(self) -> dict: ...

    @abstractmethod
    async def create_order(
        self, *, amount_paise: int, currency: str, receipt: str, notes: Optional[dict] = None
    ) -> GatewayOrder: ...

    @abstractmethod
    async def verify_payment(
        self, *, gateway_order_id: str, gateway_payment_id: str, gateway_signature: str,
        expected_amount_paise: int, expected_currency: str,
    ) -> GatewayVerifyResult: ...

    @abstractmethod
    async def capture_payment(
        self, *, gateway_payment_id: str, amount_paise: int, currency: str,
    ) -> GatewayVerifyResult: ...

    @abstractmethod
    async def refund_payment(
        self, *, gateway_payment_id: str, amount_paise: int, notes: Optional[dict] = None,
    ) -> GatewayRefundResult: ...

    @abstractmethod
    def verify_webhook(self, *, raw_body: bytes, signature_header: str) -> Optional[GatewayWebhookEvent]:
        """Return parsed event ONLY if signature verifies. Never raise."""

    @abstractmethod
    async def get_payment_status(self, *, gateway_payment_id: str) -> GatewayVerifyResult: ...


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------
_provider_cache: Optional[PaymentGatewayProvider] = None


def get_gateway() -> PaymentGatewayProvider:
    """Return the singleton gateway configured via PAYMENT_GATEWAY_PROVIDER env var."""
    global _provider_cache
    if _provider_cache is not None:
        return _provider_cache
    name = (C.GATEWAY_PROVIDER or "mock").lower()
    if name == "mock":
        from .providers.mock_gateway import MockGateway
        _provider_cache = MockGateway()
    # Placeholder for future providers — must be added deliberately with playbook
    # elif name == "razorpay":
    #     from .providers.razorpay_gateway import RazorpayGateway
    #     _provider_cache = RazorpayGateway()
    else:
        # Fallback safe default rather than crashing the app
        from .providers.mock_gateway import MockGateway
        _provider_cache = MockGateway()
    return _provider_cache


def reset_gateway_cache() -> None:
    """For tests only."""
    global _provider_cache
    _provider_cache = None
