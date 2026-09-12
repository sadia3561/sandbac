"""
SANDBAC Payments Module — Prompt 9

Modular payment architecture:
  - types            → Pydantic schemas + payment/refund/earning/payout state enums
  - constants        → currency, commission defaults, hold periods
  - gateway          → PaymentGatewayProvider interface + factory
  - providers        → concrete gateway implementations (mock, razorpay-shaped)
  - commission       → CommissionService (configurable rates)
  - service          → PaymentService (orders, retry attempts, verify + capture)
  - webhook_service  → WebhookService (signature verify + idempotent event routing)
  - refunds          → RefundService (create/process refunds + earning reversal)
  - earnings         → EarningsService (immutable earnings ledger)
  - payouts          → PayoutService (provider payout foundation)
  - controller       → FastAPI router mounted under /api
  - events           → internal event emitter → notifications hub

Everything below the interface layer is provider-agnostic. Booking Engine calls
PaymentService/EarningsService via clean methods — no gateway-specific code
lives inside server.py.
"""
from .controller import build_router
from .service import PaymentService
from .earnings import EarningsService
from .refunds import RefundService
from .payouts import PayoutService
from .commission import CommissionService
from .webhook_service import WebhookService
from .events import PaymentEventBus

__all__ = [
    "build_router",
    "PaymentService",
    "EarningsService",
    "RefundService",
    "PayoutService",
    "CommissionService",
    "WebhookService",
    "PaymentEventBus",
]
