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
- Advanced provider matching / dispatch scoring
- Payment gateway + automated payouts
- Push notifications, WebSocket realtime
- Complex map tracking / AI recommendations

## Test credentials
See `/app/memory/test_credentials.md`.
