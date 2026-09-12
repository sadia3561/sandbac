"""Payment domain types — enums + Pydantic schemas."""
from __future__ import annotations
from enum import Enum
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# STATE ENUMS  (kept independent of legacy Booking.payment_status enum)
# ---------------------------------------------------------------------------
class PaymentState(str, Enum):
    """Full payment state machine (Prompt 9 §4)."""
    PENDING = "PENDING"
    INITIATED = "INITIATED"
    AUTHORIZED = "AUTHORIZED"
    CAPTURED = "CAPTURED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    REFUND_PENDING = "REFUND_PENDING"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED"
    REFUNDED = "REFUNDED"


PAYMENT_TRANSITIONS: dict[str, set[str]] = {
    PaymentState.PENDING.value: {PaymentState.INITIATED.value, PaymentState.CANCELLED.value},
    PaymentState.INITIATED.value: {
        PaymentState.AUTHORIZED.value,
        PaymentState.CAPTURED.value,
        PaymentState.FAILED.value,
        PaymentState.CANCELLED.value,
    },
    PaymentState.AUTHORIZED.value: {
        PaymentState.CAPTURED.value,
        PaymentState.FAILED.value,
        PaymentState.CANCELLED.value,
    },
    PaymentState.CAPTURED.value: {
        PaymentState.REFUND_PENDING.value,
        PaymentState.PARTIALLY_REFUNDED.value,
        PaymentState.REFUNDED.value,
    },
    PaymentState.REFUND_PENDING.value: {
        PaymentState.PARTIALLY_REFUNDED.value,
        PaymentState.REFUNDED.value,
        PaymentState.CAPTURED.value,   # refund failed → revert
    },
    PaymentState.PARTIALLY_REFUNDED.value: {
        PaymentState.REFUND_PENDING.value,
        PaymentState.REFUNDED.value,
    },
    PaymentState.REFUNDED.value: set(),
    PaymentState.FAILED.value: set(),
    PaymentState.CANCELLED.value: set(),
}

# Legacy Booking.payment_status alignment (server.py PaymentStatus enum)
# so booking documents stay valid while the new state machine lives on `payments.state`
LEGACY_PAYMENT_STATUS = {
    PaymentState.PENDING.value: "PENDING",
    PaymentState.INITIATED.value: "PROCESSING",
    PaymentState.AUTHORIZED.value: "PROCESSING",
    PaymentState.CAPTURED.value: "SUCCESS",
    PaymentState.FAILED.value: "FAILED",
    PaymentState.CANCELLED.value: "FAILED",
    PaymentState.REFUND_PENDING.value: "SUCCESS",
    PaymentState.PARTIALLY_REFUNDED.value: "PARTIALLY_REFUNDED",
    PaymentState.REFUNDED.value: "REFUNDED",
}


class RefundState(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class EarningState(str, Enum):
    PENDING = "PENDING"        # created but hold period not passed
    AVAILABLE = "AVAILABLE"    # can be paid out
    ON_HOLD = "ON_HOLD"        # admin freeze
    PAID = "PAID"              # settled via a payout
    REVERSED = "REVERSED"      # fully cancelled due to refund/chargeback


class PayoutState(str, Enum):
    REQUESTED = "REQUESTED"
    PROCESSING = "PROCESSING"
    PAID = "PAID"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class PaymentAttemptState(str, Enum):
    INITIATED = "INITIATED"
    CAPTURED = "CAPTURED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class CommissionScope(str, Enum):
    GLOBAL = "GLOBAL"
    CATEGORY = "CATEGORY"
    SERVICE = "SERVICE"
    PROVIDER = "PROVIDER"


# ---------------------------------------------------------------------------
# API SCHEMAS
# ---------------------------------------------------------------------------
class CreateOrderIn(BaseModel):
    booking_id: str


class GatewayOrderPayload(BaseModel):
    """Only client-safe fields (no secret keys)."""
    gateway: str
    environment: str
    key_id: str                    # publishable
    gateway_order_id: str
    amount_paise: int
    currency: str
    booking_id: str
    payment_id: str
    attempt_no: int
    checkout_notes: dict = Field(default_factory=dict)


class CreateOrderOut(BaseModel):
    payment_id: str
    booking_id: str
    state: PaymentState
    amount_paise: int
    currency: str
    attempt_no: int
    gateway_payload: GatewayOrderPayload


class VerifyPaymentIn(BaseModel):
    payment_id: str
    gateway_order_id: str
    gateway_payment_id: str
    gateway_signature: str


class PaymentOut(BaseModel):
    id: str
    booking_id: str
    customer_id: str
    gateway: str
    gateway_order_id: Optional[str] = None
    gateway_payment_id: Optional[str] = None
    amount_paise: int
    currency: str
    state: PaymentState
    paid_at: Optional[datetime] = None
    failure_reason: Optional[str] = None
    attempts: int = 0
    refunded_paise: int = 0
    created_at: datetime
    updated_at: datetime


class PaymentAttemptOut(BaseModel):
    id: str
    payment_id: str
    booking_id: str
    attempt_no: int
    gateway_order_id: Optional[str] = None
    gateway_payment_id: Optional[str] = None
    amount_paise: int
    state: PaymentAttemptState
    failure_reason: Optional[str] = None
    created_at: datetime


class RefundRequestIn(BaseModel):
    payment_id: Optional[str] = None   # URL param authoritative
    amount_paise: Optional[int] = Field(default=None, ge=1)  # None = full refund
    reason: Optional[str] = None


class RefundOut(BaseModel):
    id: str
    payment_id: str
    booking_id: str
    requested_amount_paise: int
    approved_amount_paise: int
    gateway_refund_id: Optional[str] = None
    state: RefundState
    reason: Optional[str] = None
    requested_by: str
    created_at: datetime
    completed_at: Optional[datetime] = None


class EarningOut(BaseModel):
    id: str
    booking_id: str
    provider_id: str
    gross_amount_paise: int
    commission_percent: float
    commission_amount_paise: int
    adjustment_paise: int = 0
    final_amount_paise: int
    state: EarningState
    becomes_available_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class PayoutOut(BaseModel):
    id: str
    provider_id: str
    amount_paise: int
    currency: str
    state: PayoutState
    gateway_payout_id: Optional[str] = None
    failure_reason: Optional[str] = None
    earning_ids: list[str] = []
    requested_at: datetime
    processed_at: Optional[datetime] = None


class CommissionConfigIn(BaseModel):
    scope: CommissionScope
    scope_id: Optional[str] = None    # required unless scope == GLOBAL
    percent: Optional[float] = Field(default=None, ge=0, le=100)
    fixed_paise: Optional[int] = Field(default=None, ge=0)
    is_active: bool = True


class CommissionConfigOut(CommissionConfigIn):
    id: str
    created_at: datetime
    updated_at: datetime


class BankDetailsIn(BaseModel):
    account_holder: str = Field(min_length=1, max_length=100)
    account_number: str = Field(min_length=6, max_length=30)
    ifsc: str = Field(min_length=6, max_length=15)
    bank_name: Optional[str] = None
    upi_id: Optional[str] = None


class BankDetailsOut(BaseModel):
    id: str
    provider_id: str
    account_holder: str
    account_number_masked: str    # e.g. "XXXX1234"
    ifsc: str
    bank_name: Optional[str] = None
    upi_id_masked: Optional[str] = None
    is_verified: bool = False
    created_at: datetime


class PayoutRequestIn(BaseModel):
    earning_ids: Optional[list[str]] = None   # None = all AVAILABLE earnings
