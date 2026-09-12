"""Payment module constants — all money in the smallest currency unit (paise for INR)."""
import os

# Currency
DEFAULT_CURRENCY: str = os.environ.get("PAYMENT_CURRENCY", "INR")
SUPPORTED_CURRENCIES: tuple[str, ...] = ("INR",)
CURRENCY_MINOR_UNIT: dict[str, int] = {"INR": 100}  # paise per rupee

# Commission
DEFAULT_COMMISSION_PERCENT: int = int(os.environ.get("PLATFORM_COMMISSION_PERCENT", "15"))

# Earnings hold — provider earnings become AVAILABLE after this many days post-completion
EARNINGS_HOLD_DAYS: int = int(os.environ.get("EARNINGS_HOLD_DAYS", "1"))

# Gateway env
GATEWAY_PROVIDER: str = os.environ.get("PAYMENT_GATEWAY_PROVIDER", "mock")
GATEWAY_ENVIRONMENT: str = os.environ.get("PAYMENT_GATEWAY_ENVIRONMENT", "test")
GATEWAY_KEY_ID: str = os.environ.get("PAYMENT_GATEWAY_KEY_ID", "")
GATEWAY_KEY_SECRET: str = os.environ.get("PAYMENT_GATEWAY_KEY_SECRET", "")
GATEWAY_WEBHOOK_SECRET: str = os.environ.get("PAYMENT_GATEWAY_WEBHOOK_SECRET", "")

# Retry attempt cap per booking
MAX_PAYMENT_ATTEMPTS: int = 5

# Rate limits (attempts per window per booking)
PAYMENT_RATE_LIMIT_WINDOW_SEC: int = 60
PAYMENT_RATE_LIMIT_MAX: int = 6

# Refund window (post-booking-complete) — booking cancellation rules still authoritative
REFUND_MAX_WINDOW_DAYS: int = 30
