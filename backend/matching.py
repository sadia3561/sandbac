"""
SANDBAC Smart Provider Matching & Dispatch Engine
--------------------------------------------------
Modular, deterministic, explainable matching on top of the existing booking engine.
Backend remains the authority on eligibility, scoring, and dispatch.

Layers:
  1. ProviderEligibilityService – answers "can this provider serve this booking?"
     with a list of exclusion reasons for admin diagnostics.
  2. ProviderScoringService – answers "how suitable is this eligible provider?"
     using normalised, weight-configurable factors.
  3. ProviderDispatchService – answers "which provider should get the offer next?"
     using sequential dispatch with per-offer TTL.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from math import radians, sin, cos, asin, sqrt
from typing import Any, Optional
import random, uuid

# ---- Configurable weights (initial defaults). Adjust safely without changing code paths.
WEIGHTS = {
    "distance": 0.35,      # smaller distance = higher score
    "rating":   0.20,
    "availability": 0.10,  # AVAILABLE > BUSY > OFFLINE for ASAP; less relevant for scheduled
    "service_match": 0.05, # binary; already filtered but rewards fit
    "area_match":    0.05,
    "design_match":  0.05, # design fit if applicable
    "preference":    0.15, # customer preferred provider
    "workload":      0.05, # fewer active bookings = higher score
}

# Reasons enumeration
R_SERVICE = "SERVICE_NOT_SUPPORTED"
R_RADIUS = "OUTSIDE_SERVICE_RADIUS"
R_AREA = "OUTSIDE_SERVICE_AREA"
R_UNAVAIL = "CURRENTLY_UNAVAILABLE"
R_SCHED_CONF = "SCHEDULE_CONFLICT"
R_BOOKING_CONF = "EXISTING_BOOKING_CONFLICT"
R_INACTIVE = "PROVIDER_INACTIVE"
R_KYC = "KYC_NOT_APPROVED"
R_DESIGN = "DESIGN_NOT_SUPPORTED"
R_PREF_UNAVAIL = "PROVIDER_PREFERENCE_UNAVAILABLE"

DISPATCH_TTL_ASAP_SEC = 90         # 90s per provider for ASAP
DISPATCH_TTL_SCHEDULED_SEC = 3600  # 60min per provider for scheduled
MAX_ELIGIBLE_CANDIDATES = 50       # DB filter cap
GLOBAL_DEFAULT_RADIUS_KM = 15      # if provider has no radius set


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * R * asin(sqrt(a))


def _parse_hhmm(s: str) -> tuple[int, int]:
    try:
        h, m = s.split(":", 1)
        return int(h), int(m)
    except Exception:
        return 0, 0


class EligibilityResult:
    __slots__ = ("provider", "eligible", "reasons", "distance_km", "flags")

    def __init__(self, provider: dict):
        self.provider = provider
        self.eligible: bool = False
        self.reasons: list[str] = []
        self.distance_km: Optional[float] = None
        self.flags: dict[str, Any] = {
            "service_match": False,
            "area_match": True,
            "schedule_match": True,
            "availability_match": True,
            "design_match": True,
            "preference_match": False,
        }

    def to_meta(self) -> dict:
        return {
            "provider_id": self.provider.get("id"),
            "eligible": self.eligible,
            "reasons": self.reasons,
            "distance_km": self.distance_km,
            **{f"m_{k}": v for k, v in self.flags.items()},
        }


class MatchingEngine:
    def __init__(self, db):
        self.db = db

    # ---------------- ELIGIBILITY ----------------
    async def _customer_coords(self, booking: dict) -> tuple[Optional[float], Optional[float]]:
        addr = booking.get("address") or {}
        return addr.get("latitude"), addr.get("longitude")

    async def _provider_coords(self, provider: dict) -> tuple[Optional[float], Optional[float]]:
        av = await self.db.provider_availability.find_one({"provider_id": provider["id"]}, {"_id": 0})
        if av and av.get("latitude") is not None and av.get("longitude") is not None:
            return av["latitude"], av["longitude"]
        return provider.get("base_latitude"), provider.get("base_longitude")

    async def check_eligibility(self, provider: dict, user: dict, booking: dict) -> EligibilityResult:
        r = EligibilityResult(provider)
        # Account / KYC
        if not user or not user.get("is_active", True):
            r.reasons.append(R_INACTIVE)
            return r
        # (KYC not blocking by default; require APPROVED only when configured)
        if (booking.get("require_kyc") is True) and provider.get("kyc_status") != "APPROVED":
            r.reasons.append(R_KYC)

        # Service capability
        offers = await self.db.provider_services.find_one({
            "provider_id": provider["id"], "service_id": booking["service_id"], "is_active": True,
        })
        if not offers:
            r.reasons.append(R_SERVICE)
        else:
            r.flags["service_match"] = True

        # Location / radius
        cust_lat, cust_lng = await self._customer_coords(booking)
        prov_lat, prov_lng = await self._provider_coords(provider)
        if cust_lat is not None and cust_lng is not None and prov_lat is not None and prov_lng is not None:
            r.distance_km = round(haversine_km(cust_lat, cust_lng, prov_lat, prov_lng), 2)
            radius = provider.get("service_radius_km") or GLOBAL_DEFAULT_RADIUS_KM
            if r.distance_km > radius:
                r.reasons.append(R_RADIUS)
                r.flags["area_match"] = False
        else:
            # Fallback: same city match if coords are missing
            city = (booking.get("address") or {}).get("city")
            if city and provider.get("base_city") and city.lower() != provider["base_city"].lower():
                r.reasons.append(R_AREA)
                r.flags["area_match"] = False

        # Availability / schedule
        is_asap = booking.get("booking_type") == "ASAP"
        avail = await self.db.provider_availability.find_one({"provider_id": provider["id"]}, {"_id": 0})
        state = (avail or {}).get("state", "OFFLINE")
        if is_asap:
            if state != "AVAILABLE":
                r.reasons.append(R_UNAVAIL)
                r.flags["availability_match"] = False
        else:
            # Scheduled: verify working schedule + no booking conflict at requested time
            sched_at = booking.get("scheduled_at")
            if sched_at:
                if isinstance(sched_at, str):
                    sched_at = datetime.fromisoformat(sched_at.replace("Z", "+00:00"))
                if sched_at.tzinfo is None:
                    sched_at = sched_at.replace(tzinfo=timezone.utc)
                dow = sched_at.weekday()  # 0=Mon
                sched_row = await self.db.provider_schedules.find_one(
                    {"provider_id": provider["id"], "day_of_week": dow, "is_active": True})
                if not sched_row:
                    r.reasons.append(R_SCHED_CONF)
                    r.flags["schedule_match"] = False
                else:
                    sh, sm = _parse_hhmm(sched_row.get("start_time", "00:00"))
                    eh, em = _parse_hhmm(sched_row.get("end_time", "23:59"))
                    if not (sh * 60 + sm <= sched_at.hour * 60 + sched_at.minute <= eh * 60 + em):
                        r.reasons.append(R_SCHED_CONF)
                        r.flags["schedule_match"] = False
                # Booking conflict check
                dur = (booking.get("price_snapshot") or {}).get("duration_minutes") or 60
                end_at = sched_at + timedelta(minutes=int(dur))
                conflict = await self.db.bookings.find_one({
                    "provider_id": provider["id"],
                    "status": {"$in": ["PROVIDER_ACCEPTED", "CONFIRMED", "PROVIDER_ON_THE_WAY",
                                        "ARRIVED", "SERVICE_STARTED"]},
                    "scheduled_at": {"$gte": sched_at - timedelta(minutes=int(dur)),
                                      "$lte": end_at + timedelta(minutes=30)},
                })
                if conflict:
                    r.reasons.append(R_BOOKING_CONF)
                    r.flags["schedule_match"] = False

        # Preferred provider
        pref = booking.get("provider_preference_id")
        if pref:
            if pref == provider["id"]:
                r.flags["preference_match"] = True
            # A non-preferred provider is still eligible unless customer required strict preference.
            # (Strict preference is enforced by the dispatch layer.)

        # Design capability: if design belongs to a specific provider, only that provider satisfies
        design_id = booking.get("design_id")
        if design_id:
            design = await self.db.designs.find_one({"id": design_id}, {"_id": 0})
            if design and design.get("provider_id") and design["provider_id"] != provider["id"]:
                r.reasons.append(R_DESIGN)
                r.flags["design_match"] = False

        r.eligible = not r.reasons
        return r

    # ---------------- SCORING ----------------
    async def score(self, e: EligibilityResult, booking: dict) -> float:
        if not e.eligible:
            return 0.0
        provider = e.provider
        # Normalisations to 0..1
        radius = provider.get("service_radius_km") or GLOBAL_DEFAULT_RADIUS_KM
        dist_score = 1.0
        if e.distance_km is not None and radius > 0:
            dist_score = max(0.0, 1.0 - min(e.distance_km, radius) / radius)
        rating = float(provider.get("rating") or 0.0)
        rating_score = min(1.0, rating / 5.0)
        avail = await self.db.provider_availability.find_one({"provider_id": provider["id"]}, {"_id": 0})
        avail_score = {"AVAILABLE": 1.0, "BUSY": 0.3, "ON_SERVICE": 0.2, "OFFLINE": 0.5}.get(
            (avail or {}).get("state", "OFFLINE"), 0.0
        )
        # Workload: active bookings count in [0..5]
        active_cnt = await self.db.bookings.count_documents({
            "provider_id": provider["id"],
            "status": {"$in": ["PROVIDER_ACCEPTED", "CONFIRMED", "PROVIDER_ON_THE_WAY",
                                "ARRIVED", "SERVICE_STARTED"]},
        })
        workload_score = max(0.0, 1.0 - min(active_cnt, 5) / 5.0)
        pref_score = 1.0 if e.flags["preference_match"] else 0.0
        design_score = 1.0 if e.flags["design_match"] else 0.0
        area_score = 1.0 if e.flags["area_match"] else 0.0
        svc_score = 1.0 if e.flags["service_match"] else 0.0

        total = (
            WEIGHTS["distance"] * dist_score
            + WEIGHTS["rating"] * rating_score
            + WEIGHTS["availability"] * avail_score
            + WEIGHTS["service_match"] * svc_score
            + WEIGHTS["area_match"] * area_score
            + WEIGHTS["design_match"] * design_score
            + WEIGHTS["preference"] * pref_score
            + WEIGHTS["workload"] * workload_score
        )
        return round(total * 100.0, 2)

    # ---------------- DISPATCH ----------------
    async def _candidate_providers(self, booking: dict) -> list[dict]:
        # DB filter: providers offering the service; active users
        svc_id = booking["service_id"]
        rows = await self.db.provider_services.find(
            {"service_id": svc_id, "is_active": True}, {"provider_id": 1, "_id": 0}
        ).to_list(500)
        prov_ids = list({r["provider_id"] for r in rows})
        if not prov_ids:
            return []
        provs = await self.db.providers.find({"id": {"$in": prov_ids}}, {"_id": 0}).to_list(500)
        users = {u["id"]: u async for u in self.db.users.find(
            {"id": {"$in": [p["user_id"] for p in provs]}, "is_active": True}, {"_id": 0}
        )}
        return [(p, users[p["user_id"]]) for p in provs if p["user_id"] in users][:MAX_ELIGIBLE_CANDIDATES]

    async def rank(self, booking: dict) -> list[dict]:
        """Return sorted list of {provider, eligible, score, distance_km, reasons, ...}."""
        cands = await self._candidate_providers(booking)
        out: list[dict] = []
        for prov, user in cands:
            e = await self.check_eligibility(prov, user, booking)
            score = await self.score(e, booking) if e.eligible else 0.0
            meta = e.to_meta()
            meta["score"] = score
            meta["provider_name"] = prov.get("business_name")
            meta["user_id"] = prov["user_id"]
            out.append(meta)
        # eligible first, then higher score first, then random tie-break for fairness
        random.shuffle(out)
        out.sort(key=lambda x: (0 if x["eligible"] else 1, -x["score"]))
        return out

    async def dispatch_next(self, booking: dict) -> Optional[dict]:
        """Create OFFERED assignment for the next best eligible provider that hasn't yet been offered/rejected/expired.
        Returns the created assignment dict or None if no candidate remains."""
        already_offered = {r["provider_id"] async for r in self.db.booking_assignments.find(
            {"booking_id": booking["id"], "status": {"$in": ["OFFERED", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]}},
            {"provider_id": 1, "_id": 0}
        )}
        ranked = await self.rank(booking)
        strict_pref = bool(booking.get("provider_preference_id")) and bool(booking.get("design_id"))
        # Design-with-specific-provider is a strict preference: only that provider can serve it.
        for r in ranked:
            if not r["eligible"]:
                continue
            if r["provider_id"] in already_offered:
                continue
            if strict_pref and r["provider_id"] != booking["provider_preference_id"]:
                continue
            provider = await self.db.providers.find_one({"id": r["provider_id"]}, {"_id": 0})
            if not provider:
                continue
            ttl = DISPATCH_TTL_ASAP_SEC if booking.get("booking_type") == "ASAP" else DISPATCH_TTL_SCHEDULED_SEC
            expires_at = now_utc() + timedelta(seconds=ttl)
            doc = {
                "id": str(uuid.uuid4()), "booking_id": booking["id"], "provider_id": r["provider_id"],
                "status": "OFFERED", "offered_at": now_utc(), "expires_at": expires_at,
                "matching_score": r["score"], "distance_km": r["distance_km"],
                "matching_meta": r, "created_at": now_utc(),
            }
            await self.db.booking_assignments.insert_one(doc)
            # In-app notification to the provider (real-time will land in Prompt 8)
            await self.db.notifications.insert_one({
                "id": str(uuid.uuid4()), "user_id": provider["user_id"], "type": "PROVIDER_REQUEST_RECEIVED",
                "title": "New service request",
                "message": f"{booking['service_name']} • {booking['package_name']} • score {r['score']:.1f}",
                "booking_id": booking["id"], "read": False, "created_at": now_utc(),
            })
            # Realtime notify (best-effort; the module lazily imports to avoid a cycle)
            try:
                from realtime import hub as _hub
                await _hub.emit(provider["user_id"], "provider.assignment.created.v1", {
                    "booking_id": booking["id"], "service_name": booking["service_name"],
                    "package_name": booking["package_name"], "score": r["score"],
                    "distance_km": r["distance_km"], "expires_at": expires_at.isoformat(),
                    "ts": now_utc().isoformat(),
                })
            except Exception:
                pass
            return doc
        # No candidates left
        return None

    async def run_matching(self, booking_id: str) -> dict:
        """Idempotent top-level entry. Ensures at most one live OFFERED assignment exists per booking at a time."""
        booking = await self.db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            return {"status": "NOT_FOUND"}
        if booking.get("provider_id"):
            return {"status": "ALREADY_ASSIGNED"}
        if booking["status"] in ("CANCELLED", "EXPIRED", "SERVICE_COMPLETED"):
            return {"status": "BOOKING_INACTIVE"}
        # Expire stale offers first
        await self.db.booking_assignments.update_many(
            {"booking_id": booking_id, "status": "OFFERED", "expires_at": {"$lt": now_utc()}},
            {"$set": {"status": "EXPIRED", "responded_at": now_utc()}},
        )
        # If there is a live OFFERED assignment, don't create another (idempotency)
        live = await self.db.booking_assignments.find_one(
            {"booking_id": booking_id, "status": "OFFERED", "expires_at": {"$gt": now_utc()}}
        )
        if live:
            return {"status": "OFFER_ACTIVE", "provider_id": live["provider_id"]}
        # Dispatch to next best
        assn = await self.dispatch_next(booking)
        if assn:
            return {"status": "OFFERED", "provider_id": assn["provider_id"], "score": assn["matching_score"],
                    "expires_at": assn["expires_at"].isoformat()}
        # No providers left → mark booking so admin/customer see the state
        await self.db.bookings.update_one({"id": booking_id}, {"$set": {"status": "SEARCHING_PROVIDER", "no_provider_found": True, "updated_at": now_utc()}})
        return {"status": "NO_PROVIDER_AVAILABLE"}
