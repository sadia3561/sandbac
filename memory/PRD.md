# SANDBAC — Product Requirements Document

**Services At Your Need Doorstep — Beauty And Celebration.**
India-wide on-demand home services marketplace.

## Tech stack (adapted to Emergent platform)
- **Frontend (single Expo app)**: React Native + expo-router + TypeScript. One app serves Customer / Provider / Admin experiences, gated by user role.
- **Backend**: FastAPI + Motor (MongoDB), modular routers.
- **Database**: MongoDB (equivalent modelling of the Prisma spec — UUID `id` fields, indexes, ISO timestamps, price stored as integer paise, price snapshot on bookings).
- **Auth**: JWT access (60m) + rotating refresh (30d); SecureStore/AsyncStorage; role-gated router.
- **Design**: SANDBAC ruby/rose-gold, Ionicons.

## Role routing
- CUSTOMER → `/(tabs)` — customer app
- PROVIDER → `/(provider)` — provider app
- ADMIN → `/(admin)` — admin web panel (responsive, sidebar on desktop, hamburger on mobile)

## Admin Web Panel (built this step)
15 sections in the sidebar, all backed by `/api/admin/*` routes and audit-logged:
Dashboard · Customers · Providers · Provider KYC · Categories · Services · Packages · Portfolio / Designs · Custom Requests · Bookings · Service Areas · Reviews · Complaints · Announcements · Coupons · Earnings · Audit Logs.

Every list has empty / loading / error states. Every write action is server-authoritative, requires ADMIN JWT, and creates an audit-log entry with admin id, action, entity id, and safe metadata. All prices, cities, services, categories, and providers come from the DB — no hardcoded values anywhere in the panel.

## Customer & Provider apps (built earlier)
Untouched, still working. Customer: welcome / login / register / location onboarding / home / categories / service detail / designs / booking flow (ASAP / SCHEDULED / LATER + reference image upload) / bookings list / bookings detail / notifications / addresses / profile. Provider: welcome / registration / home dashboard with GO ONLINE toggle / bookings tabs / booking detail with accept/reject/status transitions / portfolio CRUD + admin approval status / earnings / services / working schedule / KYC.

## Deferred (per spec)
- Payment gateway + automated payouts
- Push notifications, WebSocket realtime (event hooks in place)
- Complex map tracking / AI recommendations / image similarity

## Smart Matching & Dispatch Engine (this step) — `/app/backend/matching.py`
Three modular services on top of the booking engine:

**ProviderEligibilityService** — filters + reasons for admin diagnostics.
Reasons: `SERVICE_NOT_SUPPORTED`, `OUTSIDE_SERVICE_RADIUS`, `OUTSIDE_SERVICE_AREA`, `CURRENTLY_UNAVAILABLE`, `SCHEDULE_CONFLICT`, `EXISTING_BOOKING_CONFLICT`, `PROVIDER_INACTIVE`, `KYC_NOT_APPROVED`, `DESIGN_NOT_SUPPORTED`, `PROVIDER_PREFERENCE_UNAVAILABLE`. Uses Haversine distance from address lat/lng vs latest provider location (falls back to base) with per-provider `service_radius_km` (default 15 km).

**ASAP** = provider must be currently `AVAILABLE`. **SCHEDULED / LATER** = ignores current online state and validates: day-of-week schedule match, time-in-window, and no overlap with existing PROVIDER_ACCEPTED → SERVICE_STARTED bookings (+30 min buffer).

**ProviderScoringService** — normalised 0..1 factors combined with configurable weights (`WEIGHTS` dict): distance 0.35, rating 0.20, availability 0.10, service_match 0.05, area_match 0.05, design_match 0.05, preference 0.15, workload 0.05. Final 0..100 score. Rating is never the sole factor.

**ProviderDispatchService** — Sequential dispatch: one OFFERED `BookingAssignment` at a time with per-offer TTL (90 s ASAP / 60 min scheduled). On reject / expiry the engine re-runs and dispatches to the next best. `run_matching(booking_id)` is idempotent (returns `OFFER_ACTIVE` if a live offer already exists; never creates duplicate active assignments). Design-tied-to-provider bookings are strict preferences: only that provider is eligible; no silent substitution. If no candidate remains → booking flagged with `no_provider_found`.

Random tie-break on shuffle before deterministic score sort keeps fairness across similar providers.

**Wired into**: `POST /api/bookings` (initial dispatch), `POST /api/provider/requests/{id}/reject` (immediate re-dispatch), `GET /api/provider/requests` (lazy expire + re-dispatch), plus new endpoints: `POST /api/bookings/{id}/match` (manual retry), `GET /api/bookings/{id}/matching-status`, `GET /api/admin/bookings/{id}/matching` (full ranked candidate list with reasons + assignment history for admin diagnostics).

## Booking Engine (this step)
- Server-authoritative price + `price_snapshot` on every booking (never trusts frontend).
- Validates: customer active, address ownership, service/package active, package↔service link, design approval + service link, service `supported_booking_types`.
- ASAP → `SEARCHING_PROVIDER`; SCHEDULED/LATER → `PENDING` with future-date validation.
- On creation: **broadcasts OFFERED `booking_assignments` to eligible providers** (service offered, user active, not offline for ASAP) with `expires_at` (2 min ASAP / 24 h scheduled).
- Provider accept is **atomic** via `find_one_and_update` — first one wins, others get 409; verifies AVAILABLE + provider offers service + assignment not expired. Auto-cancels sibling OFFERED assignments.
- Provider reject updates own OFFERED assignment; hides that booking from that provider only.
- Lazy expiration on `/provider/requests`.
- Full state-machine enforced via `VALID_PROVIDER_TRANSITIONS`.
- `booking_status_history` collection captures every transition (old → new, actor, role, reason).
- Customer cancel accepts reason + notifies assigned provider + cancels outstanding offers.
- **Idempotency-Key** header on POST /bookings.
- Provider preference (from design or explicit `provider_id`) captured as `provider_preference_id`.
- `/bookings/{id}/history` endpoint scoped to customer / assigned provider / admin.

## Test credentials
See `/app/memory/test_credentials.md`.
