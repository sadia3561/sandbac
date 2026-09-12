"""
SANDBAC Realtime + Notifications layer
Native FastAPI WebSockets, per-user rooms, JWT-authenticated.
Booking + notification events are emitted here; storage is authoritative.
"""
from __future__ import annotations
from collections import defaultdict
from typing import Any
import asyncio, json, logging

log = logging.getLogger("sandbac.rt")


class Hub:
    """Per-user WebSocket room manager. Thread-safe within a single event loop."""
    def __init__(self):
        self._rooms: dict[str, set[Any]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def join(self, user_id: str, ws) -> None:
        async with self._lock:
            self._rooms[user_id].add(ws)

    async def leave(self, user_id: str, ws) -> None:
        async with self._lock:
            self._rooms.get(user_id, set()).discard(ws)
            if not self._rooms.get(user_id):
                self._rooms.pop(user_id, None)

    async def emit(self, user_id: str, event: str, payload: dict) -> None:
        """Non-blocking broadcast to a single user's connections. Never raises."""
        msg = json.dumps({
            "event": event, "event_version": "v1",
            "payload": payload, "ts": payload.get("ts"),
        }, default=str)
        conns = list(self._rooms.get(user_id, ()))
        if not conns:
            return
        dead: list = []
        for ws in conns:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.leave(user_id, ws)

    async def broadcast_role(self, role: str, event: str, payload: dict, get_role) -> None:
        """Optional role-scoped broadcast (used for admin)."""
        # Iterate a shallow copy to avoid mutation
        items = list(self._rooms.items())
        for uid, conns in items:
            role_ = await get_role(uid)
            if role_ == role:
                for ws in list(conns):
                    try: await ws.send_text(json.dumps({"event": event, "event_version": "v1", "payload": payload}, default=str))
                    except Exception: pass


hub = Hub()


# --------- Notification templates ---------
# Backend-generated messages keep frontends stateless & localizable later.
NOTIFICATION_TEMPLATES: dict[str, dict] = {
    "BOOKING_CREATED": {"title": "Booking created", "body": "Your {service_name} booking has been created. Finding a provider."},
    "BOOKING_SEARCHING_PROVIDER": {"title": "Searching for provider", "body": "We're finding the best provider for your {service_name} booking."},
    "PROVIDER_REQUEST_RECEIVED": {"title": "New service request", "body": "{service_name} • {package_name}"},
    "PROVIDER_ACCEPTED": {"title": "Provider confirmed", "body": "Your SANDBAC booking has been accepted by {provider_name}."},
    "PROVIDER_ASSIGNMENT_EXPIRED": {"title": "Request expired", "body": "The request for {service_name} expired before you could respond."},
    "PROVIDER_ON_THE_WAY": {"title": "Provider on the way", "body": "{provider_name} is on the way for your {service_name} booking."},
    "PROVIDER_ARRIVED": {"title": "Provider arrived", "body": "{provider_name} has arrived at your location."},
    "SERVICE_STARTED": {"title": "Service started", "body": "Your {service_name} service is now in progress."},
    "SERVICE_COMPLETED": {"title": "Service completed", "body": "Your {service_name} booking is completed. Please leave a review."},
    "BOOKING_CANCELLED": {"title": "Booking cancelled", "body": "The {service_name} booking was cancelled."},
    "NO_PROVIDER_AVAILABLE": {"title": "No provider available", "body": "We couldn't find a provider for your {service_name} booking right now."},
    "KYC_APPROVED": {"title": "KYC approved", "body": "Your identity verification has been approved."},
    "KYC_REJECTED": {"title": "KYC rejected", "body": "{reason}"},
    "PORTFOLIO_APPROVED": {"title": "Design approved", "body": "Your design '{title}' is now live."},
    "PORTFOLIO_REJECTED": {"title": "Design rejected", "body": "{reason}"},
    "ADMIN_ANNOUNCEMENT": {"title": "{title}", "body": "{message}"},
}


def render(event_type: str, data: dict) -> tuple[str, str]:
    tpl = NOTIFICATION_TEMPLATES.get(event_type, {"title": event_type, "body": ""})
    try:
        return tpl["title"].format(**data), tpl["body"].format(**data)
    except Exception:
        return tpl["title"], tpl["body"]
