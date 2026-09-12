import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/src/context/AuthContext";
import { authStorage } from "@/src/api/authStorage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

/**
 * SANDBAC realtime hook — connects to /api/ws with the current JWT and
 * invalidates the relevant react-query caches when the backend pushes an event.
 * Reconnects with exponential backoff. REST remains source of truth; WS only nudges.
 */
export function useRealtime() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);
  const backoffRef = useRef(1000);

  useEffect(() => {
    if (!user) return;
    closedRef.current = false;

    const connect = async () => {
      if (closedRef.current) return;
      const token = await authStorage.getAccess();
      if (!token) return;
      const url = BASE.replace(/^http/, "ws") + `/api/ws?token=${encodeURIComponent(token)}`;
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => { backoffRef.current = 1000; };
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(String(ev.data));
            // Invalidate caches so the UI refreshes from REST (backend = source of truth)
            qc.invalidateQueries({ queryKey: ["notifs"] });
            qc.invalidateQueries({ queryKey: ["notif-unread"] });
            if (m.event === "booking.status.updated.v1" || m.event === "booking.cancelled.v1") {
              qc.invalidateQueries({ queryKey: ["bookings"] });
              qc.invalidateQueries({ queryKey: ["booking", m.payload?.booking_id] });
              qc.invalidateQueries({ queryKey: ["prov", "bookings"] });
              qc.invalidateQueries({ queryKey: ["prov", "booking-detail", m.payload?.booking_id] });
            }
            if (m.event === "provider.assignment.created.v1") {
              qc.invalidateQueries({ queryKey: ["prov", "reqs"] });
              qc.invalidateQueries({ queryKey: ["prov", "bookings"] });
            }
          } catch { /* ignore malformed */ }
        };
        ws.onerror = () => { try { ws.close(); } catch {} };
        ws.onclose = () => {
          if (closedRef.current) return;
          const delay = Math.min(backoffRef.current, 20_000);
          backoffRef.current = Math.min(delay * 2, 20_000);
          setTimeout(connect, delay);
        };
      } catch {
        setTimeout(connect, Math.min(backoffRef.current, 20_000));
      }
    };

    connect();
    return () => {
      closedRef.current = true;
      try { wsRef.current?.close(); } catch {}
    };
  }, [user, qc]);
}
