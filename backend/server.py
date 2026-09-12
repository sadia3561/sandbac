"""
SANDBAC Backend - FastAPI + MongoDB
Services At Your Need Doorstep - Beauty And Celebration
Modular architecture: auth, users, locations, categories, services, packages,
providers/portfolio, designs, addresses, bookings, custom requests, notifications, reviews.
"""
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, status, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Literal, Any
from datetime import datetime, timedelta, timezone
from pathlib import Path
from enum import Enum
import os, uuid, logging, jwt, hashlib, secrets, json
from matching import MatchingEngine
from realtime import hub, render, NOTIFICATION_TEMPLATES

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_ACCESS_MIN = int(os.environ.get("JWT_ACCESS_MINUTES", 60))
JWT_REFRESH_DAYS = int(os.environ.get("JWT_REFRESH_DAYS", 30))
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@sandbac.in")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "ChangeMe@Admin1")

client = AsyncIOMotorClient(MONGO_URL, tz_aware=True)
db = client[DB_NAME]
matcher = MatchingEngine(db)

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)
DUMMY_HASH = pwd_ctx.hash("dummy-timing-hash-value")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("sandbac")

app = FastAPI(title="SANDBAC API", version="1.0.0")
api = APIRouter(prefix="/api")

# ============================================================================
# ENUMS
# ============================================================================
class Role(str, Enum):
    CUSTOMER = "CUSTOMER"
    PROVIDER = "PROVIDER"
    ADMIN = "ADMIN"

class ProviderType(str, Enum):
    FULL_TIME = "FULL_TIME"
    PART_TIME = "PART_TIME"

class Availability(str, Enum):
    OFFLINE = "OFFLINE"
    AVAILABLE = "AVAILABLE"
    BUSY = "BUSY"
    ON_SERVICE = "ON_SERVICE"

class BookingType(str, Enum):
    ASAP = "ASAP"
    SCHEDULED = "SCHEDULED"
    LATER = "LATER"

class BookingStatus(str, Enum):
    PENDING = "PENDING"
    SEARCHING_PROVIDER = "SEARCHING_PROVIDER"
    PROVIDER_REQUESTED = "PROVIDER_REQUESTED"
    PROVIDER_ACCEPTED = "PROVIDER_ACCEPTED"
    CONFIRMED = "CONFIRMED"
    PROVIDER_ON_THE_WAY = "PROVIDER_ON_THE_WAY"
    ARRIVED = "ARRIVED"
    SERVICE_STARTED = "SERVICE_STARTED"
    SERVICE_COMPLETED = "SERVICE_COMPLETED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"

class AssignmentStatus(str, Enum):
    OFFERED = "OFFERED"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"

class PaymentStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    REFUNDED = "REFUNDED"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED"

# ============================================================================
# UTILS
# ============================================================================
def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def new_id() -> str:
    return str(uuid.uuid4())

def token_hash(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()

def make_access_token(user_id: str, role: str) -> str:
    iat = now_utc()
    payload = {
        "sub": user_id, "role": role, "type": "access",
        "iat": iat, "exp": iat + timedelta(minutes=JWT_ACCESS_MIN),
        "jti": secrets.token_urlsafe(12),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def make_refresh_token() -> tuple[str, datetime]:
    raw = secrets.token_urlsafe(48)
    return raw, now_utc() + timedelta(days=JWT_REFRESH_DAYS)

# ============================================================================
# MODELS - AUTH / USER
# ============================================================================
class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    phone: Optional[str] = None
    password: str = Field(min_length=6, max_length=128)

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class RefreshIn(BaseModel):
    refresh_token: str

class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    phone: Optional[str] = None
    role: Role
    is_verified: bool = False
    is_active: bool = True

class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut

# ============================================================================
# AUTH DEPENDENCY
# ============================================================================
def unauth() -> HTTPException:
    return HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})

async def current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauth()
    token = authorization.split(" ", 1)[1]
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if claims.get("type") != "access":
            raise unauth()
        uid = claims["sub"]
    except Exception:
        raise unauth()
    user = await db.users.find_one({"id": uid, "is_active": True}, {"_id": 0, "password_hash": 0})
    if not user:
        raise unauth()
    return user

def require_role(*allowed: Role):
    async def dep(user=Depends(current_user)):
        if user["role"] not in [r.value for r in allowed]:
            raise HTTPException(403, "Insufficient role")
        return user
    return dep

def to_user_out(u: dict) -> UserOut:
    return UserOut(
        id=u["id"], name=u["name"], email=u["email"], phone=u.get("phone"),
        role=u["role"], is_verified=u.get("is_verified", False),
        is_active=u.get("is_active", True),
    )

# ============================================================================
# AUTH ROUTES
# ============================================================================
@api.post("/auth/register", response_model=TokenOut, status_code=201)
async def register(body: RegisterIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    uid = new_id()
    user_doc = {
        "id": uid, "name": body.name.strip(), "email": email, "phone": body.phone,
        "password_hash": pwd_ctx.hash(body.password), "role": Role.CUSTOMER.value,
        "is_active": True, "is_verified": False,
        "created_at": now_utc(), "updated_at": now_utc(),
    }
    await db.users.insert_one(user_doc)
    # Customer profile
    await db.customers.insert_one({
        "id": new_id(), "user_id": uid, "default_address_id": None,
        "preferences": {}, "created_at": now_utc(), "updated_at": now_utc(),
    })
    return await _issue_tokens(user_doc)

class ProviderRegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    phone: str = Field(min_length=6, max_length=20)
    password: str = Field(min_length=6, max_length=128)
    business_name: Optional[str] = None
    bio: Optional[str] = None
    provider_type: ProviderType = ProviderType.FULL_TIME
    experience_years: int = 0
    service_radius_km: int = 10
    city: Optional[str] = None
    state: Optional[str] = None

@api.post("/auth/register-provider", response_model=TokenOut, status_code=201)
async def register_provider(body: ProviderRegisterIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    uid = new_id()
    user_doc = {
        "id": uid, "name": body.name.strip(), "email": email, "phone": body.phone,
        "password_hash": pwd_ctx.hash(body.password), "role": Role.PROVIDER.value,
        "is_active": True, "is_verified": False,
        "created_at": now_utc(), "updated_at": now_utc(),
    }
    await db.users.insert_one(user_doc)
    pid = new_id()
    await db.providers.insert_one({
        "id": pid, "user_id": uid,
        "business_name": body.business_name or body.name.strip(),
        "bio": body.bio,
        "profile_image_url": None,
        "provider_type": body.provider_type.value,
        "experience_years": body.experience_years,
        "service_radius_km": body.service_radius_km,
        "base_city": body.city, "base_state": body.state,
        "base_latitude": None, "base_longitude": None,
        "rating": 0.0, "total_reviews": 0, "total_completed": 0,
        "kyc_status": "NOT_SUBMITTED", "kyc_rejection_reason": None,
        "created_at": now_utc(), "updated_at": now_utc(),
    })
    # default availability: OFFLINE
    await db.provider_availability.insert_one({
        "provider_id": pid, "state": Availability.OFFLINE.value,
        "latitude": None, "longitude": None,
        "updated_at": now_utc(),
    })
    # default working schedule: 9-18 all days, inactive
    for dow in range(7):
        await db.provider_schedules.insert_one({
            "id": new_id(), "provider_id": pid, "day_of_week": dow,
            "start_time": "09:00", "end_time": "18:00", "is_active": False,
            "created_at": now_utc(),
        })
    return await _issue_tokens(user_doc)

@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email.lower()})
    valid = pwd_ctx.verify(body.password, user["password_hash"]) if user else pwd_ctx.verify(body.password, DUMMY_HASH)
    if not user or not valid or not user.get("is_active"):
        raise HTTPException(401, "Incorrect email or password")
    return await _issue_tokens(user)

@api.post("/auth/refresh", response_model=TokenOut)
async def refresh(body: RefreshIn):
    digest = token_hash(body.refresh_token)
    old = await db.refresh_tokens.find_one_and_delete({"token_hash": digest, "expires_at": {"$gt": now_utc()}})
    if not old:
        raise HTTPException(401, "Invalid refresh token")
    user = await db.users.find_one({"id": old["user_id"], "is_active": True})
    if not user:
        raise HTTPException(401, "Invalid refresh token")
    return await _issue_tokens(user)

@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(current_user)):
    return to_user_out(user)

@api.post("/auth/logout")
async def logout(body: RefreshIn):
    await db.refresh_tokens.delete_one({"token_hash": token_hash(body.refresh_token)})
    return {"ok": True}

async def _issue_tokens(user: dict) -> TokenOut:
    access = make_access_token(user["id"], user["role"])
    raw, exp = make_refresh_token()
    await db.refresh_tokens.insert_one({
        "token_hash": token_hash(raw), "user_id": user["id"],
        "expires_at": exp, "created_at": now_utc(),
    })
    return TokenOut(
        access_token=access, refresh_token=raw, expires_in=JWT_ACCESS_MIN * 60,
        user=to_user_out(user),
    )

# ============================================================================
# LOCATION - CITIES
# ============================================================================
class CityOut(BaseModel):
    id: str
    name: str
    state: str
    country: str
    is_active: bool

@api.get("/locations/cities", response_model=List[CityOut])
async def list_cities():
    items = await db.cities.find({"is_active": True}, {"_id": 0}).sort("name", 1).to_list(500)
    return items

# ============================================================================
# CUSTOMER ADDRESSES
# ============================================================================
class AddressIn(BaseModel):
    label: str = Field(min_length=1, max_length=30)  # Home / Work / Other
    house: str = Field(min_length=1, max_length=200)
    street: str = Field(min_length=1, max_length=200)
    landmark: Optional[str] = None
    city: str
    state: str
    country: str = "India"
    pincode: str = Field(min_length=3, max_length=10)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_default: bool = False

class AddressOut(AddressIn):
    id: str
    customer_id: str

@api.get("/addresses", response_model=List[AddressOut])
async def list_addresses(user=Depends(current_user)):
    cust = await db.customers.find_one({"user_id": user["id"]})
    if not cust:
        return []
    items = await db.addresses.find({"customer_id": cust["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return items

@api.post("/addresses", response_model=AddressOut, status_code=201)
async def create_address(body: AddressIn, user=Depends(current_user)):
    cust = await db.customers.find_one({"user_id": user["id"]})
    if not cust:
        raise HTTPException(400, "Customer profile missing")
    doc = body.model_dump()
    doc.update({"id": new_id(), "customer_id": cust["id"], "created_at": now_utc(), "updated_at": now_utc()})
    if body.is_default:
        await db.addresses.update_many({"customer_id": cust["id"]}, {"$set": {"is_default": False}})
    await db.addresses.insert_one(doc)
    if body.is_default:
        await db.customers.update_one({"id": cust["id"]}, {"$set": {"default_address_id": doc["id"]}})
    return {k: v for k, v in doc.items() if k not in ("created_at", "updated_at")}

@api.delete("/addresses/{aid}")
async def delete_address(aid: str, user=Depends(current_user)):
    cust = await db.customers.find_one({"user_id": user["id"]})
    if not cust:
        raise HTTPException(404, "Not found")
    r = await db.addresses.delete_one({"id": aid, "customer_id": cust["id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

# ============================================================================
# CATEGORIES
# ============================================================================
class CategoryOut(BaseModel):
    id: str
    name: str
    slug: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    icon: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0

@api.get("/categories", response_model=List[CategoryOut])
async def list_categories():
    items = await db.categories.find({"is_active": True}, {"_id": 0}).sort("sort_order", 1).to_list(200)
    return items

# ============================================================================
# SERVICES
# ============================================================================
class ServiceOut(BaseModel):
    id: str
    category_id: str
    category_name: Optional[str] = None
    name: str
    slug: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    starting_price_paise: int  # store as smallest currency unit
    duration_minutes: Optional[int] = None
    is_active: bool = True

@api.get("/services", response_model=List[ServiceOut])
async def list_services(category_id: Optional[str] = None, q: Optional[str] = None):
    query: dict = {"is_active": True}
    if category_id:
        query["category_id"] = category_id
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    items = await db.services.find(query, {"_id": 0}).sort("name", 1).to_list(500)
    cats = {c["id"]: c["name"] async for c in db.categories.find({}, {"_id": 0, "id": 1, "name": 1})}
    for s in items:
        s["category_name"] = cats.get(s.get("category_id"))
    return items

@api.get("/services/popular", response_model=List[ServiceOut])
async def popular_services(limit: int = 8):
    items = await db.services.find({"is_active": True}, {"_id": 0}).sort("popularity", -1).to_list(limit)
    cats = {c["id"]: c["name"] async for c in db.categories.find({}, {"_id": 0, "id": 1, "name": 1})}
    for s in items:
        s["category_name"] = cats.get(s.get("category_id"))
    return items

@api.get("/services/{sid}", response_model=ServiceOut)
async def get_service(sid: str):
    s = await db.services.find_one({"id": sid, "is_active": True}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Service not found")
    cat = await db.categories.find_one({"id": s["category_id"]}, {"_id": 0, "name": 1})
    s["category_name"] = cat["name"] if cat else None
    return s

# ============================================================================
# SERVICE PACKAGES
# ============================================================================
class PackageOut(BaseModel):
    id: str
    service_id: str
    name: str
    description: Optional[str] = None
    base_price_paise: int
    duration_minutes: Optional[int] = None
    included_items: List[str] = []
    is_active: bool = True

@api.get("/services/{sid}/packages", response_model=List[PackageOut])
async def list_packages(sid: str):
    items = await db.packages.find({"service_id": sid, "is_active": True}, {"_id": 0}).sort("base_price_paise", 1).to_list(50)
    return items

# ============================================================================
# DESIGNS / PORTFOLIO
# ============================================================================
class DesignOut(BaseModel):
    id: str
    service_id: str
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None
    provider_rating: Optional[float] = None
    package_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    image_url: str
    price_paise: Optional[int] = None
    is_active: bool = True

@api.get("/designs", response_model=List[DesignOut])
async def list_designs(service_id: Optional[str] = None, limit: int = 30):
    query: dict = {"is_active": True, "approval_status": "APPROVED"}
    if service_id:
        query["service_id"] = service_id
    items = await db.designs.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return items

@api.get("/designs/{did}", response_model=DesignOut)
async def get_design(did: str):
    d = await db.designs.find_one({"id": did, "is_active": True}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Design not found")
    return d

# ============================================================================
# BOOKINGS
# ============================================================================
class BookingIn(BaseModel):
    service_id: str
    package_id: str
    design_id: Optional[str] = None
    provider_id: Optional[str] = None  # optional preference (not guaranteed)
    custom_request_id: Optional[str] = None
    reference_image_url: Optional[str] = None
    reference_note: Optional[str] = None
    address_id: str
    booking_type: BookingType
    scheduled_at: Optional[datetime] = None
    notes: Optional[str] = None

class BookingOut(BaseModel):
    id: str
    customer_id: str
    service_id: str
    service_name: Optional[str] = None
    package_id: str
    package_name: Optional[str] = None
    design_id: Optional[str] = None
    design_title: Optional[str] = None
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None
    address: Optional[dict] = None
    booking_type: BookingType
    scheduled_at: Optional[datetime] = None
    status: BookingStatus
    payment_status: PaymentStatus
    price_paise: int  # snapshot
    price_snapshot: Optional[dict] = None
    reference_image_url: Optional[str] = None
    reference_note: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

@api.post("/bookings", response_model=BookingOut, status_code=201)
async def create_booking(body: BookingIn, request: Request, user=Depends(require_role(Role.CUSTOMER))):
    # ---- Idempotency: same customer + Idempotency-Key returns the same booking
    idem_key = request.headers.get("Idempotency-Key") or request.headers.get("idempotency-key")
    if idem_key:
        existing = await db.bookings.find_one({"customer_id_user": user["id"], "idempotency_key": idem_key}, {"_id": 0})
        if existing:
            return existing

    cust = await db.customers.find_one({"user_id": user["id"]})
    if not cust:
        raise HTTPException(400, "Customer profile missing")
    service = await db.services.find_one({"id": body.service_id, "is_active": True}, {"_id": 0})
    if not service:
        raise HTTPException(404, "Service not found")
    # supported booking types (default: all if not set)
    supported = service.get("supported_booking_types") or ["ASAP", "SCHEDULED", "LATER"]
    if body.booking_type.value not in supported:
        raise HTTPException(400, f"{body.booking_type.value} not supported for this service")
    pkg = await db.packages.find_one({"id": body.package_id, "service_id": body.service_id, "is_active": True}, {"_id": 0})
    if not pkg:
        raise HTTPException(404, "Package not found")
    addr = await db.addresses.find_one({"id": body.address_id, "customer_id": cust["id"]}, {"_id": 0})
    if not addr:
        raise HTTPException(404, "Address not found")
    design = None
    if body.design_id:
        design = await db.designs.find_one({"id": body.design_id, "is_active": True, "approval_status": "APPROVED"}, {"_id": 0})
        if not design:
            raise HTTPException(404, "Selected design not found or not approved")
        # design must belong to selected service
        if design.get("service_id") != body.service_id:
            raise HTTPException(400, "Design does not belong to selected service")
    if body.booking_type in (BookingType.SCHEDULED, BookingType.LATER):
        if not body.scheduled_at:
            raise HTTPException(400, "scheduled_at required for SCHEDULED/LATER bookings")
        if body.scheduled_at.tzinfo is None:
            body.scheduled_at = body.scheduled_at.replace(tzinfo=timezone.utc)
        if body.scheduled_at <= now_utc():
            raise HTTPException(400, "scheduled_at must be in the future")

    # ---- Server-authoritative price ----
    price = pkg["base_price_paise"]
    if design and design.get("price_paise"):
        price = design["price_paise"]

    bid = new_id()
    status_val = BookingStatus.SEARCHING_PROVIDER if body.booking_type == BookingType.ASAP else BookingStatus.PENDING
    duration = pkg.get("duration_minutes") or service.get("duration_minutes")
    doc = {
        "id": bid, "customer_id": cust["id"], "customer_id_user": user["id"],
        "service_id": service["id"], "service_name": service["name"],
        "package_id": pkg["id"], "package_name": pkg["name"],
        "design_id": design["id"] if design else None,
        "design_title": design["title"] if design else None,
        "provider_id": None, "provider_name": None,
        "provider_preference_id": None,  # set below if requested
        "address": {k: v for k, v in addr.items() if k not in ("customer_id",)},
        "booking_type": body.booking_type.value,
        "scheduled_at": body.scheduled_at,
        "status": status_val.value,
        "payment_status": PaymentStatus.PENDING.value,
        "price_paise": price,
        "price_snapshot": {
            "package_base_paise": pkg["base_price_paise"],
            "design_paise": (design or {}).get("price_paise") if design else None,
            "final_paise": price, "currency": "INR",
            "duration_minutes": duration, "captured_at": now_utc().isoformat(),
        },
        "reference_image_url": body.reference_image_url,
        "reference_note": body.reference_note,
        "notes": body.notes,
        "idempotency_key": idem_key,
        "created_at": now_utc(), "updated_at": now_utc(),
    }
    # Optional explicit provider preference (or from design)
    if body.provider_id:
        doc["provider_preference_id"] = body.provider_id
    if design and design.get("provider_id"):
        doc["provider_preference_id"] = design["provider_id"]

    await db.bookings.insert_one(doc)
    await add_status_history(bid, None, status_val.value, user["id"], "customer", "Booking created")

    # ---- Smart matching & dispatch (sequential, top-scored first) ----
    await matcher.run_matching(bid)

    # Customer notification
    await db.notifications.insert_one({
        "id": new_id(), "user_id": user["id"], "type": "BOOKING_CREATED",
        "title": "Booking created",
        "message": f"Your {service['name']} booking has been created. We're finding a provider for you.",
        "booking_id": bid, "read": False, "created_at": now_utc(),
    })
    doc.pop("_id", None)
    return doc


# ---------------------------------------------------------------------------
# Booking status history + eligibility service + assignment offering
# ---------------------------------------------------------------------------
async def add_status_history(booking_id: str, old_status: Optional[str], new_status: str,
                              actor_user_id: Optional[str], actor_role: str, reason: Optional[str] = None,
                              meta: Optional[dict] = None):
    await db.booking_status_history.insert_one({
        "id": new_id(), "booking_id": booking_id,
        "old_status": old_status, "new_status": new_status,
        "actor_user_id": actor_user_id, "actor_role": actor_role,
        "reason": reason, "meta": meta or {}, "created_at": now_utc(),
    })

ASSIGNMENT_TTL_SECONDS = 120  # 2 min per offer

async def offer_to_eligible_providers(booking: dict) -> None:
    """Create OFFERED BookingAssignment records for eligible providers.
    Foundation only — advanced ranking will be added in Prompt 7."""
    svc_id = booking["service_id"]
    # Eligible providers: offer the service, active user, not offline (for ASAP);
    # for scheduled/later we still offer to all (working-schedule check comes in Prompt 7).
    is_asap = booking["booking_type"] == BookingType.ASAP.value
    offered_provider_ids = {d["provider_id"] async for d in db.provider_services.find(
        {"service_id": svc_id, "is_active": True}, {"provider_id": 1, "_id": 0})}
    if not offered_provider_ids:
        return
    # Check user active + provider preference short-circuits list to just that provider
    provs = await db.providers.find({"id": {"$in": list(offered_provider_ids)}}, {"_id": 0}).to_list(500)
    if booking.get("provider_preference_id"):
        provs = [p for p in provs if p["id"] == booking["provider_preference_id"]]
    users = {u["id"]: u async for u in db.users.find(
        {"id": {"$in": [p["user_id"] for p in provs]}, "is_active": True},
        {"_id": 0, "id": 1, "is_active": 1})}
    eligible: List[dict] = []
    for p in provs:
        if p["user_id"] not in users:
            continue
        if is_asap:
            a = await db.provider_availability.find_one({"provider_id": p["id"]})
            if not a or a["state"] == Availability.OFFLINE.value or a["state"] == Availability.ON_SERVICE.value:
                continue
        eligible.append(p)
    if not eligible:
        return
    expires_at = now_utc() + timedelta(seconds=ASSIGNMENT_TTL_SECONDS if is_asap else 24 * 3600)
    docs = [{
        "id": new_id(), "booking_id": booking["id"], "provider_id": p["id"],
        "status": AssignmentStatus.OFFERED.value,
        "offered_at": now_utc(), "expires_at": expires_at,
        "matching_score": None, "distance_km": None,
        "created_at": now_utc(),
    } for p in eligible]
    if docs:
        await db.booking_assignments.insert_many(docs)
        # Notify provider users
        await db.notifications.insert_many([{
            "id": new_id(), "user_id": p["user_id"], "type": "NEW_REQUEST",
            "title": "New service request",
            "message": f"{booking['service_name']} • {booking['package_name']}",
            "booking_id": booking["id"], "read": False, "created_at": now_utc(),
        } for p in eligible])

@api.get("/bookings", response_model=List[BookingOut])
async def list_bookings(status_filter: Optional[str] = None, user=Depends(current_user)):
    cust = await db.customers.find_one({"user_id": user["id"]})
    if not cust:
        return []
    q: dict = {"customer_id": cust["id"]}
    if status_filter == "upcoming":
        q["status"] = {"$in": [BookingStatus.PENDING.value, BookingStatus.SEARCHING_PROVIDER.value,
                                BookingStatus.PROVIDER_ACCEPTED.value, BookingStatus.CONFIRMED.value]}
    elif status_filter == "active":
        q["status"] = {"$in": [BookingStatus.PROVIDER_ON_THE_WAY.value, BookingStatus.ARRIVED.value,
                                BookingStatus.SERVICE_STARTED.value]}
    elif status_filter == "completed":
        q["status"] = BookingStatus.SERVICE_COMPLETED.value
    elif status_filter == "cancelled":
        q["status"] = {"$in": [BookingStatus.CANCELLED.value, BookingStatus.EXPIRED.value]}
    items = await db.bookings.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items

@api.get("/bookings/{bid}", response_model=BookingOut)
async def get_booking(bid: str, user=Depends(current_user)):
    cust = await db.customers.find_one({"user_id": user["id"]})
    if not cust:
        raise HTTPException(404, "Not found")
    b = await db.bookings.find_one({"id": bid, "customer_id": cust["id"]}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    return b

class CancelIn(BaseModel):
    reason: Optional[str] = None

@api.post("/bookings/{bid}/cancel", response_model=BookingOut)
async def cancel_booking(bid: str, body: CancelIn | None = None, user=Depends(current_user)):
    cust = await db.customers.find_one({"user_id": user["id"]})
    if not cust:
        raise HTTPException(404, "Not found")
    b = await db.bookings.find_one({"id": bid, "customer_id": cust["id"]}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if b["status"] in (BookingStatus.SERVICE_COMPLETED.value, BookingStatus.CANCELLED.value,
                        BookingStatus.EXPIRED.value):
        raise HTTPException(400, "Booking cannot be cancelled")
    reason = (body.reason if body else None) or "Customer cancelled"
    await db.bookings.update_one({"id": bid}, {"$set": {"status": BookingStatus.CANCELLED.value,
                                                          "cancellation_reason": reason,
                                                          "cancelled_by": "customer",
                                                          "cancelled_at": now_utc(),
                                                          "updated_at": now_utc()}})
    # Cancel any outstanding OFFERED assignments
    await db.booking_assignments.update_many(
        {"booking_id": bid, "status": AssignmentStatus.OFFERED.value},
        {"$set": {"status": AssignmentStatus.CANCELLED.value, "responded_at": now_utc()}},
    )
    await add_status_history(bid, b["status"], BookingStatus.CANCELLED.value,
                              user["id"], "customer", reason)
    # Notify assigned provider (if any)
    if b.get("provider_id"):
        prov = await db.providers.find_one({"id": b["provider_id"]}, {"user_id": 1})
        if prov:
            await db.notifications.insert_one({
                "id": new_id(), "user_id": prov["user_id"], "type": "BOOKING_CANCELLED",
                "title": "Booking cancelled by customer",
                "message": f"{b['service_name']} booking was cancelled. Reason: {reason}",
                "booking_id": bid, "read": False, "created_at": now_utc(),
            })
            try: await hub.emit(prov["user_id"], "booking.cancelled.v1", {
                "booking_id": bid, "reason": reason, "ts": now_utc().isoformat()})
            except Exception: pass
    b["status"] = BookingStatus.CANCELLED.value
    return b

@api.get("/bookings/{bid}/history")
async def booking_history(bid: str, user=Depends(current_user)):
    b = await db.bookings.find_one({"id": bid}, {"_id": 0, "customer_id": 1, "provider_id": 1})
    if not b:
        raise HTTPException(404, "Not found")
    cust = await db.customers.find_one({"user_id": user["id"]})
    prov = await db.providers.find_one({"user_id": user["id"]})
    allowed = (
        user["role"] == Role.ADMIN.value
        or (cust and b.get("customer_id") == cust.get("id"))
        or (prov and b.get("provider_id") == prov.get("id"))
    )
    if not allowed:
        raise HTTPException(403, "Forbidden")
    items = await db.booking_status_history.find({"booking_id": bid}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return items


# ---------------------------------------------------------------------------
# Matching engine endpoints
# ---------------------------------------------------------------------------
@api.post("/bookings/{bid}/match")
async def trigger_match(bid: str, user=Depends(current_user)):
    """Manual re-match trigger. Admin or booking's own customer can trigger."""
    b = await db.bookings.find_one({"id": bid}, {"_id": 0, "customer_id": 1})
    if not b:
        raise HTTPException(404, "Booking not found")
    cust = await db.customers.find_one({"user_id": user["id"]})
    allowed = user["role"] == Role.ADMIN.value or (cust and b["customer_id"] == cust["id"])
    if not allowed:
        raise HTTPException(403, "Forbidden")
    r = await matcher.run_matching(bid)
    return r

@api.get("/bookings/{bid}/matching-status")
async def matching_status(bid: str, user=Depends(current_user)):
    b = await db.bookings.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Not found")
    cust = await db.customers.find_one({"user_id": user["id"]})
    allowed = user["role"] == Role.ADMIN.value or (cust and b.get("customer_id") == cust["id"])
    if not allowed:
        raise HTTPException(403, "Forbidden")
    # Live offer (if any)
    live = await db.booking_assignments.find_one(
        {"booking_id": bid, "status": "OFFERED", "expires_at": {"$gt": now_utc()}}, {"_id": 0}
    )
    total_assignments = await db.booking_assignments.count_documents({"booking_id": bid})
    result = {
        "booking_status": b["status"],
        "assigned_provider_id": b.get("provider_id"),
        "live_offer": live,
        "total_offers": total_assignments,
    }
    return result

@api.get("/admin/bookings/{bid}/matching")
async def admin_matching_debug(bid: str, admin=Depends(require_role(Role.ADMIN))):
    b = await db.bookings.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Not found")
    ranked = await matcher.rank(b)
    assignments = await db.booking_assignments.find({"booking_id": bid}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"booking": b, "ranked_candidates": ranked, "assignments": assignments}


# ============================================================================
# NOTIFICATIONS + REALTIME
# ============================================================================
async def notify(
    user_id: str,
    event_type: str,
    data: dict,
    booking_id: str | None = None,
    event_id: str | None = None,
) -> dict | None:
    """Create an in-app notification (idempotent by `event_id` when supplied) and
    emit a realtime event over WebSocket. Never raises — failure isolation."""
    try:
        title, body = render(event_type, data)
        # Idempotency: if event_id is provided, skip duplicates
        if event_id:
            existing = await db.notifications.find_one({"event_id": event_id, "user_id": user_id})
            if existing:
                return None
        doc = {
            "id": new_id(),
            "user_id": user_id,
            "type": event_type,
            "title": title,
            "message": body,
            "booking_id": booking_id,
            "read": False,
            "event_id": event_id,
            "metadata": {k: v for k, v in data.items() if k not in ("password", "otp", "token")},
            "created_at": now_utc(),
        }
        await db.notifications.insert_one(doc)
        # Realtime emit (fire-and-forget; hub is failure-safe)
        payload = {"notification": {k: v for k, v in doc.items() if k != "_id"},
                    "ts": doc["created_at"].isoformat()}
        try: await hub.emit(user_id, event_type, payload)
        except Exception: pass
        # Also emit a generic "notification" for badges/toasts
        try: await hub.emit(user_id, "notification.created.v1", payload)
        except Exception: pass
        doc.pop("_id", None)
        return doc
    except Exception as e:
        log.exception("notify failed: %s", e)
        return None


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(default="")):
    # Authenticate via JWT before accepting
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if claims.get("type") != "access":
            await websocket.close(code=4401); return
        user_id = claims["sub"]
    except Exception:
        await websocket.close(code=4401); return
    user = await db.users.find_one({"id": user_id, "is_active": True}, {"_id": 0, "id": 1, "role": 1})
    if not user:
        await websocket.close(code=4401); return
    await websocket.accept()
    await hub.join(user_id, websocket)
    try:
        # Send hello for client-side ack
        await websocket.send_text(json.dumps({"event": "hello.v1", "payload": {"user_id": user_id, "role": user["role"]}}))
        while True:
            # Keep alive; the server does not require inbound messages, but we drain any pings.
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("ws error: %s", e)
    finally:
        await hub.leave(user_id, websocket)


# ---------- Notification REST ----------
@api.get("/notifications/unread-count")
async def unread_count(user=Depends(current_user)):
    n = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"unread": n}

@api.patch("/notifications/read-all")
async def mark_all_read(user=Depends(current_user)):
    r = await db.notifications.update_many({"user_id": user["id"], "read": False},
                                              {"$set": {"read": True, "read_at": now_utc()}})
    return {"ok": True, "updated": r.modified_count}



class NotificationOut(BaseModel):
    id: str
    user_id: str
    type: str
    title: str
    message: str
    booking_id: Optional[str] = None
    read: bool = False
    created_at: datetime

@api.get("/notifications", response_model=List[NotificationOut])
async def list_notifications(skip: int = 0, limit: int = 30, unread_only: bool = False, user=Depends(current_user)):
    q: dict = {"user_id": user["id"]}
    if unread_only:
        q["read"] = False
    items = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(min(limit, 100)).to_list(limit)
    return items

@api.post("/notifications/{nid}/read")
async def mark_read(nid: str, user=Depends(current_user)):
    await db.notifications.update_one({"id": nid, "user_id": user["id"]},
                                        {"$set": {"read": True, "read_at": now_utc()}})
    return {"ok": True}

# ============================================================================
# MEDIA - customer reference image upload (base64 for MVP)
# NOTE: In production, replace with signed S3/GCS upload URLs.
# ============================================================================
class MediaIn(BaseModel):
    data_base64: str  # data URI or raw base64
    content_type: str = "image/jpeg"
    kind: Literal["reference", "portfolio", "avatar"] = "reference"

class MediaOut(BaseModel):
    id: str
    url: str

@api.post("/media/upload", response_model=MediaOut, status_code=201)
async def upload_media(body: MediaIn, user=Depends(current_user)):
    # Store base64 in a media doc; expose via /api/media/{id}
    mid = new_id()
    payload = body.data_base64
    if "," in payload and payload.startswith("data:"):
        payload = payload.split(",", 1)[1]
    await db.media.insert_one({
        "id": mid, "user_id": user["id"], "kind": body.kind,
        "content_type": body.content_type, "data_base64": payload,
        "created_at": now_utc(),
    })
    return MediaOut(id=mid, url=f"/api/media/{mid}")

@api.get("/media/{mid}")
async def get_media(mid: str):
    from fastapi.responses import Response
    import base64
    m = await db.media.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Not found")
    try:
        raw = base64.b64decode(m["data_base64"])
    except Exception:
        raise HTTPException(500, "Invalid media")
    return Response(content=raw, media_type=m.get("content_type", "image/jpeg"))

# ============================================================================
# PROVIDER MODULE
# ============================================================================
async def get_provider(user=Depends(require_role(Role.PROVIDER))) -> dict:
    p = await db.providers.find_one({"user_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Provider profile not found")
    p["_auth_user"] = user
    return p

class ProviderOut(BaseModel):
    id: str
    user_id: str
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    business_name: Optional[str] = None
    bio: Optional[str] = None
    profile_image_url: Optional[str] = None
    provider_type: ProviderType
    experience_years: int = 0
    service_radius_km: int = 10
    base_city: Optional[str] = None
    base_state: Optional[str] = None
    rating: float = 0.0
    total_reviews: int = 0
    total_completed: int = 0
    kyc_status: str = "NOT_SUBMITTED"
    kyc_rejection_reason: Optional[str] = None

class ProviderPatch(BaseModel):
    business_name: Optional[str] = None
    bio: Optional[str] = None
    profile_image_url: Optional[str] = None
    provider_type: Optional[ProviderType] = None
    experience_years: Optional[int] = None
    service_radius_km: Optional[int] = None
    base_city: Optional[str] = None
    base_state: Optional[str] = None

@api.get("/provider/me", response_model=ProviderOut)
async def provider_me(p=Depends(get_provider)):
    u = p["_auth_user"]
    return {**p, "name": u["name"], "email": u["email"], "phone": u.get("phone")}

@api.patch("/provider/me", response_model=ProviderOut)
async def provider_update(body: ProviderPatch, p=Depends(get_provider)):
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if upd:
        upd["updated_at"] = now_utc()
        await db.providers.update_one({"id": p["id"]}, {"$set": upd})
    fresh = await db.providers.find_one({"id": p["id"]}, {"_id": 0})
    u = p["_auth_user"]
    return {**fresh, "name": u["name"], "email": u["email"], "phone": u.get("phone")}

# ---- Availability ----
class AvailabilityIn(BaseModel):
    state: Availability
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class AvailabilityOut(BaseModel):
    provider_id: str
    state: Availability
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    updated_at: datetime

@api.get("/provider/availability", response_model=AvailabilityOut)
async def get_avail(p=Depends(get_provider)):
    a = await db.provider_availability.find_one({"provider_id": p["id"]}, {"_id": 0})
    if not a:
        a = {"provider_id": p["id"], "state": Availability.OFFLINE.value, "latitude": None, "longitude": None, "updated_at": now_utc()}
        await db.provider_availability.insert_one(a)
    return a

@api.post("/provider/availability", response_model=AvailabilityOut)
async def set_avail(body: AvailabilityIn, p=Depends(get_provider)):
    current = await db.provider_availability.find_one({"provider_id": p["id"]})
    # Safety: can't manually go AVAILABLE while ON_SERVICE
    if current and current.get("state") == Availability.ON_SERVICE.value and body.state == Availability.AVAILABLE:
        raise HTTPException(400, "Cannot go AVAILABLE while an active service is in progress")
    upd = {"state": body.state.value, "latitude": body.latitude, "longitude": body.longitude, "updated_at": now_utc()}
    await db.provider_availability.update_one({"provider_id": p["id"]}, {"$set": upd}, upsert=True)
    return {"provider_id": p["id"], **upd}

@api.post("/provider/location")
async def update_location(body: AvailabilityIn, p=Depends(get_provider)):
    # Only accept when AVAILABLE or ON_SERVICE
    a = await db.provider_availability.find_one({"provider_id": p["id"]})
    if not a or a["state"] == Availability.OFFLINE.value:
        return {"ok": False, "reason": "offline"}
    await db.provider_availability.update_one({"provider_id": p["id"]},
        {"$set": {"latitude": body.latitude, "longitude": body.longitude, "updated_at": now_utc()}})
    return {"ok": True}

# ---- Working schedule ----
class ScheduleDay(BaseModel):
    day_of_week: int = Field(ge=0, le=6)  # 0=Mon, 6=Sun
    start_time: str  # HH:MM
    end_time: str
    is_active: bool = False

@api.get("/provider/schedule", response_model=List[ScheduleDay])
async def get_schedule(p=Depends(get_provider)):
    days = await db.provider_schedules.find({"provider_id": p["id"]}, {"_id": 0}).sort("day_of_week", 1).to_list(20)
    return days

@api.put("/provider/schedule", response_model=List[ScheduleDay])
async def put_schedule(body: List[ScheduleDay], p=Depends(get_provider)):
    await db.provider_schedules.delete_many({"provider_id": p["id"]})
    docs = [{
        "id": new_id(), "provider_id": p["id"],
        "day_of_week": d.day_of_week, "start_time": d.start_time,
        "end_time": d.end_time, "is_active": d.is_active,
        "created_at": now_utc(),
    } for d in body]
    if docs:
        await db.provider_schedules.insert_many(docs)
    days = await db.provider_schedules.find({"provider_id": p["id"]}, {"_id": 0}).sort("day_of_week", 1).to_list(20)
    return days

# ---- Provider Services (offered) ----
class ProviderServiceOut(BaseModel):
    service_id: str
    service_name: str
    category_name: Optional[str] = None
    image_url: Optional[str] = None
    is_offered: bool
    experience_years: int = 0
    is_active: bool = True

@api.get("/provider/services", response_model=List[ProviderServiceOut])
async def provider_services(p=Depends(get_provider)):
    svcs = await db.services.find({"is_active": True}, {"_id": 0}).to_list(500)
    cats = {c["id"]: c["name"] async for c in db.categories.find({}, {"_id": 0, "id": 1, "name": 1})}
    offered = {d["service_id"]: d async for d in db.provider_services.find({"provider_id": p["id"]})}
    out = []
    for s in svcs:
        o = offered.get(s["id"])
        out.append({
            "service_id": s["id"], "service_name": s["name"],
            "category_name": cats.get(s["category_id"]),
            "image_url": s.get("image_url"),
            "is_offered": bool(o and o.get("is_active", True)),
            "experience_years": (o or {}).get("experience_years", 0) if o else 0,
            "is_active": bool(o and o.get("is_active", True)) if o else False,
        })
    return out

class ProviderServiceToggle(BaseModel):
    service_id: str
    is_offered: bool
    experience_years: int = 0

@api.post("/provider/services", response_model=ProviderServiceOut)
async def provider_service_toggle(body: ProviderServiceToggle, p=Depends(get_provider)):
    svc = await db.services.find_one({"id": body.service_id, "is_active": True}, {"_id": 0})
    if not svc:
        raise HTTPException(404, "Service not found")
    existing = await db.provider_services.find_one({"provider_id": p["id"], "service_id": body.service_id})
    if existing:
        await db.provider_services.update_one({"_id": existing["_id"]},
            {"$set": {"is_active": body.is_offered, "experience_years": body.experience_years, "updated_at": now_utc()}})
    else:
        await db.provider_services.insert_one({
            "id": new_id(), "provider_id": p["id"], "service_id": body.service_id,
            "is_active": body.is_offered, "experience_years": body.experience_years,
            "created_at": now_utc(), "updated_at": now_utc(),
        })
    cat = await db.categories.find_one({"id": svc["category_id"]}, {"_id": 0, "name": 1})
    return {"service_id": svc["id"], "service_name": svc["name"], "category_name": cat["name"] if cat else None,
            "image_url": svc.get("image_url"), "is_offered": body.is_offered,
            "experience_years": body.experience_years, "is_active": body.is_offered}

# ---- Provider Portfolio ----
class PortfolioIn(BaseModel):
    service_id: str
    title: str
    description: Optional[str] = None
    image_url: str
    package_id: Optional[str] = None
    price_paise: Optional[int] = None

class PortfolioOut(PortfolioIn):
    id: str
    provider_id: str
    approval_status: str  # DRAFT, PENDING_REVIEW, APPROVED, REJECTED, INACTIVE
    is_active: bool
    created_at: datetime

@api.get("/provider/portfolio", response_model=List[PortfolioOut])
async def list_provider_portfolio(p=Depends(get_provider)):
    items = await db.designs.find({"provider_id": p["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items

@api.post("/provider/portfolio", response_model=PortfolioOut, status_code=201)
async def create_portfolio(body: PortfolioIn, p=Depends(get_provider)):
    svc = await db.services.find_one({"id": body.service_id, "is_active": True})
    if not svc:
        raise HTTPException(404, "Service not found")
    did = new_id()
    doc = {
        "id": did, "provider_id": p["id"], "provider_name": p.get("business_name"),
        "provider_rating": p.get("rating", 0),
        "service_id": body.service_id, "title": body.title, "description": body.description,
        "image_url": body.image_url, "package_id": body.package_id, "price_paise": body.price_paise,
        "approval_status": "PENDING_REVIEW", "is_active": True,
        "created_at": now_utc(), "updated_at": now_utc(),
    }
    await db.designs.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.delete("/provider/portfolio/{pid_}")
async def delete_portfolio(pid_: str, p=Depends(get_provider)):
    r = await db.designs.delete_one({"id": pid_, "provider_id": p["id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

# ---- Provider Booking Requests & Lifecycle ----
@api.get("/provider/requests", response_model=List[BookingOut])
async def provider_requests(p=Depends(get_provider)):
    # Lazy-expire OFFERED assignments whose expires_at is past AND trigger re-dispatch for those bookings
    expired_cursor = db.booking_assignments.find(
        {"provider_id": p["id"], "status": AssignmentStatus.OFFERED.value, "expires_at": {"$lt": now_utc()}},
        {"_id": 0, "booking_id": 1},
    )
    expired_bids: List[str] = []
    async for x in expired_cursor:
        expired_bids.append(x["booking_id"])
    if expired_bids:
        await db.booking_assignments.update_many(
            {"provider_id": p["id"], "status": AssignmentStatus.OFFERED.value, "expires_at": {"$lt": now_utc()}},
            {"$set": {"status": AssignmentStatus.EXPIRED.value, "responded_at": now_utc()}},
        )
        for bid_ in expired_bids:
            try: await matcher.run_matching(bid_)
            except Exception: pass
    # OFFERED assignments live for this provider now
    offered = await db.booking_assignments.find(
        {"provider_id": p["id"], "status": AssignmentStatus.OFFERED.value,
         "expires_at": {"$gt": now_utc()}},
        {"_id": 0, "booking_id": 1},
    ).to_list(100)
    booking_ids = [a["booking_id"] for a in offered]
    if not booking_ids:
        return []
    items = await db.bookings.find(
        {"id": {"$in": booking_ids}, "provider_id": None,
         "status": {"$in": [BookingStatus.SEARCHING_PROVIDER.value, BookingStatus.PENDING.value]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return items

@api.get("/provider/bookings", response_model=List[BookingOut])
async def provider_bookings(status_filter: Optional[str] = None, p=Depends(get_provider)):
    q: dict = {"provider_id": p["id"]}
    if status_filter == "active":
        q["status"] = {"$in": [BookingStatus.PROVIDER_ACCEPTED.value, BookingStatus.CONFIRMED.value,
                                BookingStatus.PROVIDER_ON_THE_WAY.value, BookingStatus.ARRIVED.value,
                                BookingStatus.SERVICE_STARTED.value]}
    elif status_filter == "completed":
        q["status"] = BookingStatus.SERVICE_COMPLETED.value
    elif status_filter == "cancelled":
        q["status"] = {"$in": [BookingStatus.CANCELLED.value, BookingStatus.EXPIRED.value]}
    elif status_filter == "upcoming":
        q["status"] = BookingStatus.PROVIDER_ACCEPTED.value
    items = await db.bookings.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items

@api.get("/provider/bookings/{bid}", response_model=BookingOut)
async def provider_booking(bid: str, p=Depends(get_provider)):
    b = await db.bookings.find_one({"id": bid, "provider_id": p["id"]}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    return b

@api.post("/provider/requests/{bid}/accept", response_model=BookingOut)
async def accept_request(bid: str, p=Depends(get_provider)):
    # Availability check
    a = await db.provider_availability.find_one({"provider_id": p["id"]})
    if not a or a["state"] == Availability.OFFLINE.value:
        raise HTTPException(400, "You are offline. Go online to accept requests.")
    if a["state"] == Availability.ON_SERVICE.value:
        raise HTTPException(400, "You already have an active service in progress.")
    # Booking must still exist & be unclaimed
    booking = await db.bookings.find_one({"id": bid}, {"_id": 0})
    if not booking:
        raise HTTPException(404, "Booking not found")
    # Provider must offer that service
    offers = await db.provider_services.find_one({"provider_id": p["id"], "service_id": booking["service_id"], "is_active": True})
    if not offers:
        raise HTTPException(403, "You don't offer this service")
    # Expire own stale assignments first
    await db.booking_assignments.update_many(
        {"provider_id": p["id"], "booking_id": bid, "status": AssignmentStatus.OFFERED.value, "expires_at": {"$lt": now_utc()}},
        {"$set": {"status": AssignmentStatus.EXPIRED.value, "responded_at": now_utc()}},
    )
    # If an OFFERED assignment exists for this provider, ensure not expired
    assign = await db.booking_assignments.find_one({"provider_id": p["id"], "booking_id": bid,
                                                     "status": AssignmentStatus.OFFERED.value})
    # If none exists (fallback path), we still allow acceptance if unclaimed and provider offers service
    # ---- Atomic take: only succeeds if not already assigned and status is SEARCHING/PENDING ----
    b = await db.bookings.find_one_and_update(
        {"id": bid, "provider_id": None,
         "status": {"$in": [BookingStatus.SEARCHING_PROVIDER.value, BookingStatus.PENDING.value]}},
        {"$set": {
            "provider_id": p["id"], "provider_name": p.get("business_name"),
            "status": BookingStatus.PROVIDER_ACCEPTED.value,
            "updated_at": now_utc(),
        }},
        return_document=True,
    )
    if not b:
        raise HTTPException(409, "This booking is no longer available")
    b.pop("_id", None)
    # Log accepted assignment
    await db.booking_assignments.update_one(
        {"provider_id": p["id"], "booking_id": bid, "status": AssignmentStatus.OFFERED.value},
        {"$set": {"status": AssignmentStatus.ACCEPTED.value, "responded_at": now_utc()}},
    ) if assign else await db.booking_assignments.insert_one({
        "id": new_id(), "booking_id": bid, "provider_id": p["id"],
        "status": AssignmentStatus.ACCEPTED.value,
        "offered_at": booking["created_at"], "responded_at": now_utc(),
        "created_at": now_utc(),
    })
    # Cancel other OFFERED assignments for this booking
    await db.booking_assignments.update_many(
        {"booking_id": bid, "provider_id": {"$ne": p["id"]}, "status": AssignmentStatus.OFFERED.value},
        {"$set": {"status": AssignmentStatus.CANCELLED.value, "responded_at": now_utc()}},
    )
    await add_status_history(bid, booking["status"], BookingStatus.PROVIDER_ACCEPTED.value,
                              p["user_id"], "provider", "Provider accepted")
    # Customer notification
    cust = await db.customers.find_one({"id": b["customer_id"]}, {"user_id": 1})
    if cust:
        await db.notifications.insert_one({
            "id": new_id(), "user_id": cust["user_id"], "type": "PROVIDER_ACCEPTED",
            "title": "Provider confirmed",
            "message": f"{p.get('business_name')} accepted your {b['service_name']} booking.",
            "booking_id": bid, "read": False, "created_at": now_utc(),
        })
        # Realtime → customer
        try: await hub.emit(cust["user_id"], "booking.status.updated.v1", {
            "booking_id": bid, "old_status": booking["status"], "new_status": BookingStatus.PROVIDER_ACCEPTED.value,
            "provider_name": p.get("business_name"), "ts": now_utc().isoformat()})
        except Exception: pass
    return b

class RejectIn(BaseModel):
    reason: Optional[str] = None

@api.post("/provider/requests/{bid}/reject")
async def reject_request(bid: str, body: RejectIn, p=Depends(get_provider)):
    r = await db.booking_assignments.update_one(
        {"provider_id": p["id"], "booking_id": bid, "status": AssignmentStatus.OFFERED.value},
        {"$set": {"status": AssignmentStatus.REJECTED.value, "rejection_reason": body.reason, "responded_at": now_utc()}},
    )
    if r.modified_count == 0:
        await db.booking_assignments.insert_one({
            "id": new_id(), "booking_id": bid, "provider_id": p["id"],
            "status": AssignmentStatus.REJECTED.value, "rejection_reason": body.reason,
            "offered_at": now_utc(), "responded_at": now_utc(), "created_at": now_utc(),
        })
    await add_status_history(bid, None, "PROVIDER_REJECTED_OFFER", p["user_id"], "provider", body.reason)
    # Try to dispatch to next best eligible provider
    await matcher.run_matching(bid)
    return {"ok": True}

class BookingStatusIn(BaseModel):
    status: BookingStatus

VALID_PROVIDER_TRANSITIONS = {
    BookingStatus.PROVIDER_ACCEPTED.value: [BookingStatus.CONFIRMED.value, BookingStatus.PROVIDER_ON_THE_WAY.value, BookingStatus.CANCELLED.value],
    BookingStatus.CONFIRMED.value: [BookingStatus.PROVIDER_ON_THE_WAY.value, BookingStatus.CANCELLED.value],
    BookingStatus.PROVIDER_ON_THE_WAY.value: [BookingStatus.ARRIVED.value, BookingStatus.CANCELLED.value],
    BookingStatus.ARRIVED.value: [BookingStatus.SERVICE_STARTED.value],
    BookingStatus.SERVICE_STARTED.value: [BookingStatus.SERVICE_COMPLETED.value],
}

@api.post("/provider/bookings/{bid}/status", response_model=BookingOut)
async def transition_status(bid: str, body: BookingStatusIn, p=Depends(get_provider)):
    b = await db.bookings.find_one({"id": bid, "provider_id": p["id"]})
    if not b:
        raise HTTPException(404, "Booking not found")
    allowed = VALID_PROVIDER_TRANSITIONS.get(b["status"], [])
    if body.status.value not in allowed:
        raise HTTPException(400, f"Cannot transition from {b['status']} to {body.status.value}")
    upd = {"status": body.status.value, "updated_at": now_utc()}
    await db.bookings.update_one({"id": bid}, {"$set": upd})
    await add_status_history(bid, b["status"], body.status.value, p["user_id"], "provider")
    if body.status == BookingStatus.SERVICE_STARTED:
        await db.provider_availability.update_one({"provider_id": p["id"]}, {"$set": {"state": Availability.ON_SERVICE.value, "updated_at": now_utc()}})
    if body.status == BookingStatus.SERVICE_COMPLETED:
        gross = b["price_paise"]
        commission = int(gross * 0.15)
        net = gross - commission
        await db.provider_earnings.insert_one({
            "id": new_id(), "provider_id": p["id"], "booking_id": bid,
            "gross_paise": gross, "commission_paise": commission, "net_paise": net,
            "status": "PENDING", "created_at": now_utc(),
        })
        await db.providers.update_one({"id": p["id"]}, {"$inc": {"total_completed": 1}})
        await db.provider_availability.update_one({"provider_id": p["id"]}, {"$set": {"state": Availability.AVAILABLE.value, "updated_at": now_utc()}})
    cust = await db.customers.find_one({"id": b["customer_id"]}, {"user_id": 1})
    if cust:
        labels = {
            BookingStatus.PROVIDER_ON_THE_WAY.value: "Provider is on the way",
            BookingStatus.ARRIVED.value: "Provider has arrived",
            BookingStatus.SERVICE_STARTED.value: "Service started",
            BookingStatus.SERVICE_COMPLETED.value: "Service completed",
        }
        if body.status.value in labels:
            await db.notifications.insert_one({
                "id": new_id(), "user_id": cust["user_id"],
                "type": f"BOOKING_{body.status.value}", "title": labels[body.status.value],
                "message": f"Your {b['service_name']} booking: {labels[body.status.value]}.",
                "booking_id": bid, "read": False, "created_at": now_utc(),
            })
            try: await hub.emit(cust["user_id"], "booking.status.updated.v1", {
                "booking_id": bid, "old_status": b["status"], "new_status": body.status.value,
                "ts": now_utc().isoformat()})
            except Exception: pass
    fresh = await db.bookings.find_one({"id": bid}, {"_id": 0})
    return fresh

# ---- Earnings ----
class EarningSummary(BaseModel):
    today_paise: int
    week_paise: int
    month_paise: int
    total_paise: int
    completed_count: int
    pending_payout_paise: int
    paid_payout_paise: int

class EarningItem(BaseModel):
    id: str
    booking_id: str
    gross_paise: int
    commission_paise: int
    net_paise: int
    status: str
    created_at: datetime

@api.get("/provider/earnings/summary", response_model=EarningSummary)
async def earnings_summary(p=Depends(get_provider)):
    now = now_utc()
    day0 = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    week0 = day0 - timedelta(days=day0.weekday())
    month0 = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    def agg(dt): return [{"$match": {"provider_id": p["id"], "created_at": {"$gte": dt}}},
                          {"$group": {"_id": None, "s": {"$sum": "$net_paise"}}}]
    async def _sum(pipeline):
        r = await db.provider_earnings.aggregate(pipeline).to_list(1)
        return int(r[0]["s"]) if r else 0
    today = await _sum(agg(day0))
    week = await _sum(agg(week0))
    month = await _sum(agg(month0))
    total_pipe = [{"$match": {"provider_id": p["id"]}}, {"$group": {"_id": None, "s": {"$sum": "$net_paise"}, "c": {"$sum": 1}}}]
    t = await db.provider_earnings.aggregate(total_pipe).to_list(1)
    total = int(t[0]["s"]) if t else 0
    completed = int(t[0]["c"]) if t else 0
    pending_pipe = [{"$match": {"provider_id": p["id"], "status": "PENDING"}}, {"$group": {"_id": None, "s": {"$sum": "$net_paise"}}}]
    paid_pipe = [{"$match": {"provider_id": p["id"], "status": "PAID"}}, {"$group": {"_id": None, "s": {"$sum": "$net_paise"}}}]
    pen = await db.provider_earnings.aggregate(pending_pipe).to_list(1)
    paid = await db.provider_earnings.aggregate(paid_pipe).to_list(1)
    return EarningSummary(
        today_paise=today, week_paise=week, month_paise=month, total_paise=total,
        completed_count=completed,
        pending_payout_paise=int(pen[0]["s"]) if pen else 0,
        paid_payout_paise=int(paid[0]["s"]) if paid else 0,
    )

@api.get("/provider/earnings", response_model=List[EarningItem])
async def earnings_list(p=Depends(get_provider)):
    items = await db.provider_earnings.find({"provider_id": p["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items

# ---- Reviews ----
@api.get("/provider/reviews")
async def provider_reviews(p=Depends(get_provider)):
    items = await db.reviews.find({"provider_id": p["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return items

# ---- KYC ----
class KYCIn(BaseModel):
    document_type: str  # AADHAAR / PAN / OTHER
    document_number: Optional[str] = None
    front_image_url: Optional[str] = None
    back_image_url: Optional[str] = None
    selfie_url: Optional[str] = None

@api.get("/provider/kyc")
async def get_kyc(p=Depends(get_provider)):
    doc = await db.provider_kyc.find_one({"provider_id": p["id"]}, {"_id": 0})
    return {"status": p.get("kyc_status", "NOT_SUBMITTED"),
            "rejection_reason": p.get("kyc_rejection_reason"),
            "submitted": doc is not None,
            "document_type": (doc or {}).get("document_type")}

@api.post("/provider/kyc")
async def submit_kyc(body: KYCIn, p=Depends(get_provider)):
    await db.provider_kyc.update_one(
        {"provider_id": p["id"]},
        {"$set": {**body.model_dump(), "provider_id": p["id"], "updated_at": now_utc()},
         "$setOnInsert": {"id": new_id(), "created_at": now_utc()}},
        upsert=True,
    )
    await db.providers.update_one({"id": p["id"]}, {"$set": {"kyc_status": "PENDING", "kyc_rejection_reason": None, "updated_at": now_utc()}})
    return {"ok": True, "status": "PENDING"}


# ============================================================================
# ADMIN MODULE
# ============================================================================
def admin_only():
    return require_role(Role.ADMIN)

async def log_audit(admin_id: str, action: str, entity_type: str, entity_id: Optional[str] = None, meta: Optional[dict] = None):
    await db.audit_logs.insert_one({
        "id": new_id(), "admin_id": admin_id, "action": action,
        "entity_type": entity_type, "entity_id": entity_id, "meta": meta or {},
        "created_at": now_utc(),
    })

@api.get("/admin/dashboard")
async def admin_dashboard(_=Depends(admin_only())):
    async def _cnt(coll, q=None):
        return await db[coll].count_documents(q or {})
    stats = {
        "customers_total": await _cnt("customers"),
        "providers_total": await _cnt("providers"),
        "providers_online": await db.provider_availability.count_documents({"state": {"$ne": Availability.OFFLINE.value}}),
        "providers_offline": await db.provider_availability.count_documents({"state": Availability.OFFLINE.value}),
        "providers_pending_kyc": await _cnt("providers", {"kyc_status": "PENDING"}),
        "bookings_active": await _cnt("bookings", {"status": {"$in": [
            BookingStatus.PROVIDER_ACCEPTED.value, BookingStatus.CONFIRMED.value,
            BookingStatus.PROVIDER_ON_THE_WAY.value, BookingStatus.ARRIVED.value,
            BookingStatus.SERVICE_STARTED.value]}}),
        "bookings_completed": await _cnt("bookings", {"status": BookingStatus.SERVICE_COMPLETED.value}),
        "bookings_cancelled": await _cnt("bookings", {"status": BookingStatus.CANCELLED.value}),
        "portfolio_pending": await _cnt("designs", {"approval_status": "PENDING_REVIEW"}),
    }
    rev = await db.provider_earnings.aggregate([{"$group": {"_id": None, "gross": {"$sum": "$gross_paise"}, "commission": {"$sum": "$commission_paise"}, "pending": {"$sum": {"$cond": [{"$eq": ["$status", "PENDING"]}, "$net_paise", 0]}}}}]).to_list(1)
    stats["revenue_paise"] = int(rev[0]["gross"]) if rev else 0
    stats["platform_paise"] = int(rev[0]["commission"]) if rev else 0
    stats["pending_payouts_paise"] = int(rev[0]["pending"]) if rev else 0
    recent_bookings = await db.bookings.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
    recent_providers = await db.providers.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
    pending_kyc = await db.providers.find({"kyc_status": "PENDING"}, {"_id": 0}).sort("updated_at", -1).limit(5).to_list(5)
    return {"stats": stats, "recent_bookings": recent_bookings, "recent_providers": recent_providers, "pending_kyc": pending_kyc}

@api.get("/admin/customers")
async def admin_list_customers(q: Optional[str] = None, skip: int = 0, limit: int = 20, _=Depends(admin_only())):
    query: dict = {"role": Role.CUSTOMER.value}
    if q:
        query["$or"] = [{"email": {"$regex": q, "$options": "i"}}, {"name": {"$regex": q, "$options": "i"}}, {"phone": {"$regex": q, "$options": "i"}}]
    total = await db.users.count_documents(query)
    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"total": total, "items": users}

@api.get("/admin/customers/{cid}")
async def admin_customer_detail(cid: str, _=Depends(admin_only())):
    u = await db.users.find_one({"id": cid, "role": Role.CUSTOMER.value}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(404, "Not found")
    cust = await db.customers.find_one({"user_id": cid}, {"_id": 0})
    addrs = await db.addresses.find({"customer_id": (cust or {}).get("id")}, {"_id": 0}).to_list(50) if cust else []
    bookings = await db.bookings.find({"customer_id": (cust or {}).get("id")}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50) if cust else []
    return {"user": u, "customer": cust, "addresses": addrs, "bookings": bookings}

class UserStatusIn(BaseModel):
    is_active: bool

@api.post("/admin/customers/{cid}/status")
async def admin_customer_status(cid: str, body: UserStatusIn, admin=Depends(admin_only())):
    r = await db.users.update_one({"id": cid, "role": Role.CUSTOMER.value}, {"$set": {"is_active": body.is_active, "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "CUSTOMER_STATUS_CHANGED", "user", cid, {"is_active": body.is_active})
    return {"ok": True}

@api.get("/admin/providers")
async def admin_list_providers(q: Optional[str] = None, kyc: Optional[str] = None, active: Optional[bool] = None,
                                skip: int = 0, limit: int = 20, _=Depends(admin_only())):
    user_query: dict = {"role": Role.PROVIDER.value}
    if q:
        user_query["$or"] = [{"email": {"$regex": q, "$options": "i"}}, {"name": {"$regex": q, "$options": "i"}}]
    if active is not None:
        user_query["is_active"] = active
    users = await db.users.find(user_query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    uids = [u["id"] for u in users]
    prov_query: dict = {"user_id": {"$in": uids}}
    if kyc:
        prov_query["kyc_status"] = kyc
    provs = await db.providers.find(prov_query, {"_id": 0}).to_list(500)
    umap = {u["id"]: u for u in users}
    avail = {a["provider_id"]: a["state"] async for a in db.provider_availability.find({"provider_id": {"$in": [p["id"] for p in provs]}}, {"_id": 0})}
    items = []
    for p in provs:
        u = umap.get(p["user_id"], {})
        items.append({**p, "email": u.get("email"), "phone": u.get("phone"), "name": u.get("name"),
                      "is_active": u.get("is_active"), "availability": avail.get(p["id"], "OFFLINE")})
    return {"total": len(items), "items": items[skip: skip + limit]}

@api.get("/admin/providers/{pid}")
async def admin_provider_detail(pid: str, _=Depends(admin_only())):
    p = await db.providers.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Not found")
    u = await db.users.find_one({"id": p["user_id"]}, {"_id": 0, "password_hash": 0})
    av = await db.provider_availability.find_one({"provider_id": pid}, {"_id": 0})
    services = await db.provider_services.find({"provider_id": pid}, {"_id": 0}).to_list(200)
    svc_map = {s["id"]: s["name"] async for s in db.services.find({}, {"_id": 0, "id": 1, "name": 1})}
    for s in services:
        s["service_name"] = svc_map.get(s["service_id"])
    portfolio = await db.designs.find({"provider_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(100)
    bookings = await db.bookings.find({"provider_id": pid}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return {"provider": p, "user": u, "availability": av, "services": services, "portfolio": portfolio, "bookings": bookings}

@api.post("/admin/providers/{pid}/status")
async def admin_provider_status(pid: str, body: UserStatusIn, admin=Depends(admin_only())):
    p = await db.providers.find_one({"id": pid})
    if not p:
        raise HTTPException(404, "Not found")
    await db.users.update_one({"id": p["user_id"]}, {"$set": {"is_active": body.is_active, "updated_at": now_utc()}})
    await log_audit(admin["id"], "PROVIDER_STATUS_CHANGED", "provider", pid, {"is_active": body.is_active})
    return {"ok": True}

@api.get("/admin/kyc")
async def admin_list_kyc(status_filter: Optional[str] = None, _=Depends(admin_only())):
    q: dict = {}
    if status_filter:
        q["kyc_status"] = status_filter
    provs = await db.providers.find(q, {"_id": 0}).sort("updated_at", -1).to_list(200)
    uids = [p["user_id"] for p in provs]
    users = {u["id"]: u async for u in db.users.find({"id": {"$in": uids}}, {"_id": 0, "password_hash": 0})}
    for p in provs:
        u = users.get(p["user_id"], {})
        p["name"] = u.get("name"); p["email"] = u.get("email"); p["phone"] = u.get("phone")
    return provs

@api.get("/admin/kyc/{pid}")
async def admin_kyc_detail(pid: str, _=Depends(admin_only())):
    p = await db.providers.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Not found")
    doc = await db.provider_kyc.find_one({"provider_id": pid}, {"_id": 0})
    u = await db.users.find_one({"id": p["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"provider": p, "kyc": doc, "user": u}

class KYCDecision(BaseModel):
    reason: Optional[str] = None

@api.post("/admin/kyc/{pid}/approve")
async def admin_kyc_approve(pid: str, admin=Depends(admin_only())):
    r = await db.providers.update_one({"id": pid}, {"$set": {"kyc_status": "APPROVED", "kyc_rejection_reason": None, "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    p = await db.providers.find_one({"id": pid})
    await db.notifications.insert_one({
        "id": new_id(), "user_id": p["user_id"], "type": "KYC_APPROVED",
        "title": "KYC Approved", "message": "Your KYC has been approved.", "booking_id": None,
        "read": False, "created_at": now_utc(),
    })
    await log_audit(admin["id"], "KYC_APPROVED", "provider", pid)
    return {"ok": True}

@api.post("/admin/kyc/{pid}/reject")
async def admin_kyc_reject(pid: str, body: KYCDecision, admin=Depends(admin_only())):
    if not body.reason:
        raise HTTPException(400, "Reason is required")
    r = await db.providers.update_one({"id": pid}, {"$set": {"kyc_status": "REJECTED", "kyc_rejection_reason": body.reason, "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    p = await db.providers.find_one({"id": pid})
    await db.notifications.insert_one({
        "id": new_id(), "user_id": p["user_id"], "type": "KYC_REJECTED",
        "title": "KYC Rejected", "message": body.reason, "booking_id": None,
        "read": False, "created_at": now_utc(),
    })
    await log_audit(admin["id"], "KYC_REJECTED", "provider", pid, {"reason": body.reason})
    return {"ok": True}

class CategoryIn(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    icon: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True

@api.post("/admin/categories", response_model=CategoryOut)
async def admin_create_category(body: CategoryIn, admin=Depends(admin_only())):
    if await db.categories.find_one({"slug": body.slug}):
        raise HTTPException(409, "Slug already exists")
    doc = {"id": new_id(), **body.model_dump(), "created_at": now_utc(), "updated_at": now_utc()}
    await db.categories.insert_one(doc)
    await log_audit(admin["id"], "CATEGORY_CREATED", "category", doc["id"])
    return {k: v for k, v in doc.items() if k not in ("created_at", "updated_at")}

@api.patch("/admin/categories/{cid}", response_model=CategoryOut)
async def admin_update_category(cid: str, body: CategoryIn, admin=Depends(admin_only())):
    r = await db.categories.update_one({"id": cid}, {"$set": {**body.model_dump(), "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.categories.find_one({"id": cid}, {"_id": 0})
    await log_audit(admin["id"], "CATEGORY_UPDATED", "category", cid)
    return doc

@api.delete("/admin/categories/{cid}")
async def admin_delete_category(cid: str, admin=Depends(admin_only())):
    r = await db.categories.update_one({"id": cid}, {"$set": {"is_active": False, "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "CATEGORY_DEACTIVATED", "category", cid)
    return {"ok": True}

class ServiceIn(BaseModel):
    category_id: str
    name: str
    slug: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    starting_price_paise: int
    duration_minutes: Optional[int] = None
    is_active: bool = True
    allows_reference_image: bool = True
    allows_design_selection: bool = True
    supported_booking_types: List[str] = ["ASAP", "SCHEDULED", "LATER"]

@api.get("/admin/services")
async def admin_list_services(_=Depends(admin_only())):
    items = await db.services.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    cats = {c["id"]: c["name"] async for c in db.categories.find({}, {"_id": 0, "id": 1, "name": 1})}
    for s in items:
        s["category_name"] = cats.get(s.get("category_id"))
    return items

@api.post("/admin/services", response_model=ServiceOut)
async def admin_create_service(body: ServiceIn, admin=Depends(admin_only())):
    if await db.services.find_one({"slug": body.slug}):
        raise HTTPException(409, "Slug already exists")
    doc = {"id": new_id(), **body.model_dump(), "popularity": 0, "created_at": now_utc(), "updated_at": now_utc()}
    await db.services.insert_one(doc)
    await log_audit(admin["id"], "SERVICE_CREATED", "service", doc["id"])
    return await get_service(doc["id"])

@api.patch("/admin/services/{sid}", response_model=ServiceOut)
async def admin_update_service(sid: str, body: ServiceIn, admin=Depends(admin_only())):
    r = await db.services.update_one({"id": sid}, {"$set": {**body.model_dump(), "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "SERVICE_UPDATED", "service", sid)
    return await get_service(sid)

@api.delete("/admin/services/{sid}")
async def admin_delete_service(sid: str, admin=Depends(admin_only())):
    r = await db.services.update_one({"id": sid}, {"$set": {"is_active": False, "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "SERVICE_DEACTIVATED", "service", sid)
    return {"ok": True}

class PackageIn(BaseModel):
    service_id: str
    name: str
    description: Optional[str] = None
    base_price_paise: int
    duration_minutes: Optional[int] = None
    included_items: List[str] = []
    is_active: bool = True

@api.get("/admin/packages")
async def admin_list_packages(service_id: Optional[str] = None, _=Depends(admin_only())):
    q: dict = {}
    if service_id:
        q["service_id"] = service_id
    items = await db.packages.find(q, {"_id": 0}).sort("base_price_paise", 1).to_list(500)
    svc = {s["id"]: s["name"] async for s in db.services.find({}, {"_id": 0, "id": 1, "name": 1})}
    for p in items:
        p["service_name"] = svc.get(p.get("service_id"))
    return items

@api.post("/admin/packages", response_model=PackageOut)
async def admin_create_package(body: PackageIn, admin=Depends(admin_only())):
    doc = {"id": new_id(), **body.model_dump(), "created_at": now_utc(), "updated_at": now_utc()}
    await db.packages.insert_one(doc)
    await log_audit(admin["id"], "PACKAGE_CREATED", "package", doc["id"])
    return {k: v for k, v in doc.items() if k not in ("created_at", "updated_at")}

@api.patch("/admin/packages/{pid}", response_model=PackageOut)
async def admin_update_package(pid: str, body: PackageIn, admin=Depends(admin_only())):
    r = await db.packages.update_one({"id": pid}, {"$set": {**body.model_dump(), "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "PACKAGE_UPDATED", "package", pid, {"price_paise": body.base_price_paise})
    doc = await db.packages.find_one({"id": pid}, {"_id": 0})
    return doc

@api.delete("/admin/packages/{pid}")
async def admin_delete_package(pid: str, admin=Depends(admin_only())):
    r = await db.packages.update_one({"id": pid}, {"$set": {"is_active": False, "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "PACKAGE_DEACTIVATED", "package", pid)
    return {"ok": True}

@api.get("/admin/portfolio")
async def admin_list_portfolio(status_filter: Optional[str] = None, _=Depends(admin_only())):
    q: dict = {}
    if status_filter:
        q["approval_status"] = status_filter
    items = await db.designs.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items

@api.post("/admin/portfolio/{did}/approve")
async def admin_portfolio_approve(did: str, admin=Depends(admin_only())):
    r = await db.designs.update_one({"id": did}, {"$set": {"approval_status": "APPROVED", "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    d = await db.designs.find_one({"id": did})
    if d and d.get("provider_id"):
        p = await db.providers.find_one({"id": d["provider_id"]})
        if p:
            await db.notifications.insert_one({
                "id": new_id(), "user_id": p["user_id"], "type": "PORTFOLIO_APPROVED",
                "title": "Design approved", "message": f"Your design '{d['title']}' is live.",
                "booking_id": None, "read": False, "created_at": now_utc(),
            })
    await log_audit(admin["id"], "PORTFOLIO_APPROVED", "design", did)
    return {"ok": True}

@api.post("/admin/portfolio/{did}/reject")
async def admin_portfolio_reject(did: str, body: KYCDecision, admin=Depends(admin_only())):
    if not body.reason:
        raise HTTPException(400, "Reason is required")
    r = await db.designs.update_one({"id": did}, {"$set": {"approval_status": "REJECTED", "rejection_reason": body.reason, "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    d = await db.designs.find_one({"id": did})
    if d and d.get("provider_id"):
        p = await db.providers.find_one({"id": d["provider_id"]})
        if p:
            await db.notifications.insert_one({
                "id": new_id(), "user_id": p["user_id"], "type": "PORTFOLIO_REJECTED",
                "title": "Design rejected", "message": body.reason, "booking_id": None,
                "read": False, "created_at": now_utc(),
            })
    await log_audit(admin["id"], "PORTFOLIO_REJECTED", "design", did, {"reason": body.reason})
    return {"ok": True}

@api.get("/admin/custom-requests")
async def admin_custom_requests(_=Depends(admin_only())):
    return await db.bookings.find({"reference_image_url": {"$ne": None}}, {"_id": 0}).sort("created_at", -1).to_list(200)

@api.get("/admin/bookings")
async def admin_list_bookings(status_filter: Optional[str] = None, q: Optional[str] = None,
                                skip: int = 0, limit: int = 30, _=Depends(admin_only())):
    query: dict = {}
    if status_filter:
        query["status"] = status_filter
    if q:
        query["$or"] = [{"service_name": {"$regex": q, "$options": "i"}}, {"id": q}]
    total = await db.bookings.count_documents(query)
    items = await db.bookings.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"total": total, "items": items}

class CityIn(BaseModel):
    name: str
    state: str
    country: str = "India"
    is_active: bool = True

@api.post("/admin/cities", response_model=CityOut)
async def admin_create_city(body: CityIn, admin=Depends(admin_only())):
    if await db.cities.find_one({"name": body.name, "state": body.state}):
        raise HTTPException(409, "City already exists")
    doc = {"id": new_id(), **body.model_dump(), "created_at": now_utc()}
    await db.cities.insert_one(doc)
    await log_audit(admin["id"], "CITY_CREATED", "city", doc["id"], {"name": body.name})
    return {k: v for k, v in doc.items() if k != "created_at"}

@api.patch("/admin/cities/{cid}", response_model=CityOut)
async def admin_update_city(cid: str, body: CityIn, admin=Depends(admin_only())):
    r = await db.cities.update_one({"id": cid}, {"$set": body.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.cities.find_one({"id": cid}, {"_id": 0})
    await log_audit(admin["id"], "CITY_UPDATED", "city", cid)
    return doc

@api.delete("/admin/cities/{cid}")
async def admin_delete_city(cid: str, admin=Depends(admin_only())):
    r = await db.cities.update_one({"id": cid}, {"$set": {"is_active": False}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "CITY_DEACTIVATED", "city", cid)
    return {"ok": True}

@api.get("/admin/reviews")
async def admin_reviews(_=Depends(admin_only())):
    return await db.reviews.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)

class ReviewHideIn(BaseModel):
    hidden: bool

@api.post("/admin/reviews/{rid}/moderate")
async def admin_moderate_review(rid: str, body: ReviewHideIn, admin=Depends(admin_only())):
    r = await db.reviews.update_one({"id": rid}, {"$set": {"hidden": body.hidden, "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "REVIEW_MODERATED", "review", rid, {"hidden": body.hidden})
    return {"ok": True}

@api.get("/admin/complaints")
async def admin_complaints(_=Depends(admin_only())):
    return await db.complaints.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)

class ComplaintStatusIn(BaseModel):
    status: Literal["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"]

@api.patch("/admin/complaints/{cid}")
async def admin_update_complaint(cid: str, body: ComplaintStatusIn, admin=Depends(admin_only())):
    r = await db.complaints.update_one({"id": cid}, {"$set": {"status": body.status, "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "COMPLAINT_UPDATED", "complaint", cid, {"status": body.status})
    return {"ok": True}

class CouponIn(BaseModel):
    code: str
    discount_type: Literal["FLAT", "PERCENT"] = "FLAT"
    discount_value: int
    min_amount_paise: int = 0
    max_discount_paise: Optional[int] = None
    usage_limit: Optional[int] = None
    expires_at: Optional[datetime] = None
    is_active: bool = True

@api.get("/admin/coupons")
async def admin_list_coupons(_=Depends(admin_only())):
    return await db.coupons.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)

@api.post("/admin/coupons")
async def admin_create_coupon(body: CouponIn, admin=Depends(admin_only())):
    code = body.code.strip().upper()
    if await db.coupons.find_one({"code": code}):
        raise HTTPException(409, "Coupon code exists")
    doc = {"id": new_id(), **body.model_dump(), "code": code, "usage_count": 0, "created_at": now_utc(), "updated_at": now_utc()}
    await db.coupons.insert_one(doc)
    await log_audit(admin["id"], "COUPON_CREATED", "coupon", doc["id"], {"code": code})
    return {k: v for k, v in doc.items() if k != "_id"}

@api.patch("/admin/coupons/{cid}")
async def admin_update_coupon(cid: str, body: CouponIn, admin=Depends(admin_only())):
    upd = body.model_dump()
    upd["code"] = upd["code"].strip().upper()
    upd["updated_at"] = now_utc()
    r = await db.coupons.update_one({"id": cid}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "COUPON_UPDATED", "coupon", cid)
    doc = await db.coupons.find_one({"id": cid}, {"_id": 0})
    return doc

@api.delete("/admin/coupons/{cid}")
async def admin_delete_coupon(cid: str, admin=Depends(admin_only())):
    r = await db.coupons.update_one({"id": cid}, {"$set": {"is_active": False, "updated_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_audit(admin["id"], "COUPON_DEACTIVATED", "coupon", cid)
    return {"ok": True}

@api.get("/admin/earnings")
async def admin_earnings(_=Depends(admin_only())):
    items = await db.provider_earnings.find({}, {"_id": 0}).sort("created_at", -1).limit(200).to_list(200)
    prov_map = {p["id"]: p.get("business_name") async for p in db.providers.find({}, {"_id": 0, "id": 1, "business_name": 1})}
    for e in items:
        e["provider_name"] = prov_map.get(e.get("provider_id"))
    return items

@api.get("/admin/audit-logs")
async def admin_audit_logs(limit: int = 100, _=Depends(admin_only())):
    items = await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    admins = {u["id"]: u["email"] async for u in db.users.find({"role": Role.ADMIN.value}, {"_id": 0, "id": 1, "email": 1})}
    for a in items:
        a["admin_email"] = admins.get(a.get("admin_id"))
    return items

class AnnouncementIn(BaseModel):
    title: str
    message: str
    audience: Literal["ALL", "CUSTOMERS", "PROVIDERS"] = "ALL"

@api.post("/admin/announcements")
async def admin_announce(body: AnnouncementIn, admin=Depends(admin_only())):
    role_filter: dict = {"is_active": True}
    if body.audience == "CUSTOMERS":
        role_filter["role"] = Role.CUSTOMER.value
    elif body.audience == "PROVIDERS":
        role_filter["role"] = Role.PROVIDER.value
    else:
        role_filter["role"] = {"$in": [Role.CUSTOMER.value, Role.PROVIDER.value]}
    users = await db.users.find(role_filter, {"_id": 0, "id": 1}).to_list(5000)
    now = now_utc()
    if users:
        await db.notifications.insert_many([{
            "id": new_id(), "user_id": u["id"], "type": "ADMIN_ANNOUNCEMENT",
            "title": body.title, "message": body.message, "booking_id": None,
            "read": False, "created_at": now,
        } for u in users])
    await log_audit(admin["id"], "ANNOUNCEMENT_SENT", "announcement", None, {"audience": body.audience, "recipients": len(users)})
    return {"ok": True, "recipients": len(users)}


@api.get("/")
async def root():
    return {"service": "SANDBAC API", "status": "ok", "version": "1.0.0"}

@api.get("/health")
async def health():
    return {"status": "ok", "timestamp": now_utc().isoformat()}

# ============================================================================
# SEEDING & INDEXES
# ============================================================================
SEED_CATEGORIES = [
    {"slug": "beauty", "name": "Beauty", "description": "Facials, glow, skincare & more", "icon": "sparkles", "sort_order": 1,
     "image_url": "https://images.unsplash.com/photo-1647004692483-c5d942fe1137?crop=entropy&cs=srgb&fm=jpg&q=85&w=800"},
    {"slug": "decoration", "name": "Decoration", "description": "At-home party & event decor", "icon": "balloon", "sort_order": 2,
     "image_url": "https://images.unsplash.com/photo-1504196606672-aef5c9cefc92?crop=entropy&cs=srgb&fm=jpg&q=85&w=800"},
    {"slug": "mehndi", "name": "Mehndi", "description": "Traditional henna artistry", "icon": "hand", "sort_order": 3,
     "image_url": "https://images.unsplash.com/photo-1732118400647-a81e3b37be87?crop=entropy&cs=srgb&fm=jpg&q=85&w=800"},
    {"slug": "makeup", "name": "Makeup", "description": "Party, engagement & bridal looks", "icon": "brush", "sort_order": 4,
     "image_url": "https://images.unsplash.com/photo-1610047614301-13c63f00c032?crop=entropy&cs=srgb&fm=jpg&q=85&w=800"},
    {"slug": "celebration", "name": "Celebration", "description": "Anniversaries & special moments", "icon": "confetti", "sort_order": 5,
     "image_url": "https://images.unsplash.com/photo-1612145463153-e97c1774fe2a?crop=entropy&cs=srgb&fm=jpg&q=85&w=800"},
]

SEED_SERVICES = [
    # (cat_slug, name, slug, desc, start_paise, dur, image, popularity)
    ("beauty", "Face Glow", "face-glow", "Deep cleansing + brightening facial at your doorstep.", 29900, 60,
     "https://images.unsplash.com/photo-1647004692483-c5d942fe1137?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 95),
    ("decoration", "Birthday Decoration", "birthday-decoration", "Balloon arches, foil banners, thematic setups.", 59900, 120,
     "https://images.unsplash.com/photo-1504196606672-aef5c9cefc92?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 98),
    ("mehndi", "Mehndi", "mehndi", "Bridal, arabic, traditional & minimal henna designs.", 19900, 90,
     "https://images.unsplash.com/photo-1732118400647-a81e3b37be87?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 92),
    ("makeup", "Party Makeup", "party-makeup", "Glam party makeup with premium products.", 79900, 90,
     "https://images.unsplash.com/photo-1610047614301-13c63f00c032?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 90),
    ("makeup", "Bridal Makeup", "bridal-makeup", "Complete bridal look with airbrush & HD makeup.", 499900, 240,
     "https://images.unsplash.com/photo-1610047614301-13c63f00c032?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 88),
    ("celebration", "Anniversary Decoration", "anniversary-decoration", "Romantic setups, candles, roses & personalisation.", 89900, 120,
     "https://images.unsplash.com/photo-1612145463153-e97c1774fe2a?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 85),
]

SEED_PACKAGES = {
    # service_slug -> list of (name, desc, price_paise, dur, items)
    "face-glow": [
        ("Basic", "Cleanup + basic facial", 29900, 60, ["Cleansing", "Exfoliation", "Massage"]),
        ("Premium", "Advanced brightening facial", 49900, 75, ["Cleansing", "De-tan", "Brightening mask", "Massage"]),
        ("Luxury", "Gold + Vitamin C facial", 79900, 90, ["Gold facial", "Vitamin C therapy", "Neck & shoulder massage"]),
    ],
    "birthday-decoration": [
        ("Basic", "50 balloons + banner", 59900, 90, ["50 balloons", "Happy Birthday banner", "Setup"]),
        ("Premium", "Themed decor with backdrop", 99900, 150, ["100 balloons", "Foil backdrop", "LED lights", "Setup"]),
        ("Luxury", "Full premium theme setup", 149900, 180, ["150 balloons", "Custom themed backdrop", "LED + fairy lights", "Table setup"]),
    ],
    "mehndi": [
        ("Basic", "Simple arabic design (one hand)", 19900, 45, ["One hand mehndi", "Arabic style"]),
        ("Premium", "Both hands bridal-style", 49900, 90, ["Both hands", "Detailed design"]),
        ("Luxury", "Full bridal mehndi both hands + feet", 149900, 240, ["Both hands full", "Feet", "Premium cones"]),
    ],
    "party-makeup": [
        ("Basic", "Everyday party makeup", 79900, 60, ["Base makeup", "Eyes", "Lips"]),
        ("Premium", "HD party makeup", 129900, 90, ["HD base", "Eye look", "Lashes", "Hairstyling"]),
    ],
    "bridal-makeup": [
        ("Bridal", "Traditional bridal makeup", 499900, 180, ["Airbrush base", "Full eye look", "Lashes", "Draping"]),
        ("Bridal Premium", "HD + airbrush bridal", 899900, 240, ["HD + Airbrush", "Custom look", "Hairstyling", "Draping"]),
    ],
    "anniversary-decoration": [
        ("Romantic", "Candlelight + roses", 89900, 90, ["Rose petals", "Candles", "Balloon heart"]),
        ("Premium", "Full romantic setup", 149900, 120, ["Rose canopy", "LED lights", "Table setup", "Personalised banner"]),
    ],
}

SEED_DESIGNS = [
    # service_slug, title, image_url, price_paise (optional override)
    ("birthday-decoration", "Rose Gold Balloon Arch", "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 99900),
    ("birthday-decoration", "Pastel Baby Shower Setup", "https://images.unsplash.com/photo-1533294455009-a77b7557d2d1?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 129900),
    ("birthday-decoration", "Classic Foil & Balloons", "https://images.unsplash.com/photo-1478146059778-26028b07395a?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 79900),
    ("mehndi", "Bridal Full-Hand", "https://images.unsplash.com/photo-1610030006870-c7ac1c8ac83a?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 149900),
    ("mehndi", "Arabic Minimal", "https://images.unsplash.com/photo-1595872018818-97555653a011?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 29900),
    ("face-glow", "Vitamin C Radiance", "https://images.unsplash.com/photo-1552693673-1bf958298935?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 59900),
    ("party-makeup", "Smoky Evening Glam", "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 99900),
    ("bridal-makeup", "Traditional Red Bridal", "https://images.unsplash.com/photo-1595777216528-071e0127ccbf?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 599900),
    ("anniversary-decoration", "Candlelight Rose Room", "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", 119900),
]

SEED_CITIES = [
    {"name": "Bengaluru", "state": "Karnataka"},
    {"name": "Mumbai", "state": "Maharashtra"},
    {"name": "Delhi", "state": "Delhi"},
    {"name": "Hyderabad", "state": "Telangana"},
    {"name": "Pune", "state": "Maharashtra"},
    {"name": "Chennai", "state": "Tamil Nadu"},
    {"name": "Davangere", "state": "Karnataka"},
]

async def create_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("phone")
    await db.users.create_index("role")
    await db.refresh_tokens.create_index("token_hash", unique=True)
    await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.categories.create_index("slug", unique=True)
    await db.services.create_index("slug", unique=True)
    await db.services.create_index("category_id")
    await db.packages.create_index("service_id")
    await db.designs.create_index([("service_id", 1), ("is_active", 1)])
    await db.designs.create_index("provider_id")
    await db.bookings.create_index("customer_id")
    await db.bookings.create_index("provider_id")
    await db.bookings.create_index("status")
    await db.bookings.create_index("scheduled_at")
    await db.addresses.create_index("customer_id")
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.cities.create_index("name")
    await db.providers.create_index("user_id", unique=True)
    await db.provider_availability.create_index("provider_id", unique=True)
    await db.provider_schedules.create_index([("provider_id", 1), ("day_of_week", 1)])
    await db.provider_services.create_index([("provider_id", 1), ("service_id", 1)], unique=True)
    await db.provider_services.create_index("service_id")
    await db.booking_assignments.create_index([("booking_id", 1), ("provider_id", 1)])
    await db.provider_earnings.create_index("provider_id")
    await db.provider_kyc.create_index("provider_id", unique=True)
    await db.audit_logs.create_index([("created_at", -1)])
    await db.coupons.create_index("code", unique=True)
    await db.designs.create_index("approval_status")
    await db.booking_status_history.create_index([("booking_id", 1), ("created_at", 1)])
    await db.booking_assignments.create_index([("provider_id", 1), ("status", 1)])
    await db.booking_assignments.create_index([("booking_id", 1), ("status", 1)])
    await db.bookings.create_index([("customer_id_user", 1), ("idempotency_key", 1)])
    await db.notifications.create_index([("user_id", 1), ("event_id", 1)])

async def seed_data():
    # cities
    if await db.cities.count_documents({}) == 0:
        await db.cities.insert_many([
            {"id": new_id(), "name": c["name"], "state": c["state"], "country": "India",
             "is_active": True, "created_at": now_utc()} for c in SEED_CITIES
        ])
    # categories
    cat_by_slug = {}
    for c in SEED_CATEGORIES:
        existing = await db.categories.find_one({"slug": c["slug"]})
        if existing:
            cat_by_slug[c["slug"]] = existing["id"]
            continue
        cid = new_id()
        cat_by_slug[c["slug"]] = cid
        await db.categories.insert_one({
            "id": cid, "slug": c["slug"], "name": c["name"], "description": c["description"],
            "icon": c["icon"], "image_url": c["image_url"], "sort_order": c["sort_order"],
            "is_active": True, "created_at": now_utc(), "updated_at": now_utc(),
        })
    # services
    svc_by_slug = {}
    for (cslug, name, slug, desc, price, dur, img, pop) in SEED_SERVICES:
        existing = await db.services.find_one({"slug": slug})
        if existing:
            svc_by_slug[slug] = existing["id"]
            continue
        sid = new_id()
        svc_by_slug[slug] = sid
        await db.services.insert_one({
            "id": sid, "slug": slug, "name": name, "description": desc,
            "category_id": cat_by_slug[cslug], "starting_price_paise": price,
            "duration_minutes": dur, "image_url": img, "popularity": pop, "is_active": True,
            "created_at": now_utc(), "updated_at": now_utc(),
        })
    # packages
    for slug, pkgs in SEED_PACKAGES.items():
        sid = svc_by_slug.get(slug)
        if not sid:
            continue
        if await db.packages.count_documents({"service_id": sid}) > 0:
            continue
        for (name, desc, price, dur, items) in pkgs:
            await db.packages.insert_one({
                "id": new_id(), "service_id": sid, "name": name, "description": desc,
                "base_price_paise": price, "duration_minutes": dur, "included_items": items,
                "is_active": True, "created_at": now_utc(), "updated_at": now_utc(),
            })
    # designs
    if await db.designs.count_documents({}) == 0:
        sample_providers = ["Aisha Studio", "Riya Makeovers", "Bloom Decor", "Henna House", "Glow Lab"]
        for i, (slug, title, url, price) in enumerate(SEED_DESIGNS):
            sid = svc_by_slug.get(slug)
            if not sid:
                continue
            await db.designs.insert_one({
                "id": new_id(), "service_id": sid, "title": title, "description": title,
                "image_url": url, "price_paise": price,
                "provider_id": None, "provider_name": sample_providers[i % len(sample_providers)],
                "provider_rating": 4.5 + (i % 5) * 0.1,
                "approval_status": "APPROVED", "is_active": True,
                "created_at": now_utc(), "updated_at": now_utc(),
            })
    # admin
    if not await db.users.find_one({"email": ADMIN_EMAIL.lower()}):
        await db.users.insert_one({
            "id": new_id(), "name": "SANDBAC Admin", "email": ADMIN_EMAIL.lower(),
            "phone": None, "password_hash": pwd_ctx.hash(ADMIN_PASSWORD),
            "role": Role.ADMIN.value, "is_active": True, "is_verified": True,
            "created_at": now_utc(), "updated_at": now_utc(),
        })

@app.on_event("startup")
async def on_startup():
    try:
        await create_indexes()
        await seed_data()
        log.info("SANDBAC started: indexes ready & seed complete")
    except Exception as e:
        log.exception("startup error: %s", e)

@app.on_event("shutdown")
async def on_shutdown():
    client.close()

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)
