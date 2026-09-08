import { authStorage } from "./authStorage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function refreshAccess(): Promise<boolean> {
  const rt = await authStorage.getRefresh();
  if (!rt) return false;
  try {
    const r = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!r.ok) { await authStorage.clear(); return false; }
    const d = await r.json();
    await authStorage.setTokens(d.access_token, d.refresh_token);
    await authStorage.setUser(d.user);
    return true;
  } catch { return false; }
}

export async function apiFetch<T = any>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const access = await authStorage.getAccess();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(access ? { Authorization: `Bearer ${access}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401 && retry && access) {
    const ok = await refreshAccess();
    if (ok) return apiFetch<T>(path, init, false);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j?.detail)) msg = j.detail.map((d: any) => d.msg).join(", ");
    } catch {}
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // auth
  register: (name: string, email: string, password: string, phone?: string) =>
    apiFetch<any>("/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password, phone }) }),
  login: (email: string, password: string) =>
    apiFetch<any>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => apiFetch<any>("/api/auth/me"),
  logout: async () => {
    const rt = await authStorage.getRefresh();
    if (rt) { try { await apiFetch("/api/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: rt }) }); } catch {} }
    await authStorage.clear();
  },
  // locations
  cities: () => apiFetch<any[]>("/api/locations/cities"),
  // catalog
  categories: () => apiFetch<any[]>("/api/categories"),
  services: (categoryId?: string, q?: string) => {
    const p = new URLSearchParams();
    if (categoryId) p.set("category_id", categoryId);
    if (q) p.set("q", q);
    const qs = p.toString();
    return apiFetch<any[]>(`/api/services${qs ? "?" + qs : ""}`);
  },
  popular: (limit = 8) => apiFetch<any[]>(`/api/services/popular?limit=${limit}`),
  service: (id: string) => apiFetch<any>(`/api/services/${id}`),
  packages: (sid: string) => apiFetch<any[]>(`/api/services/${sid}/packages`),
  designs: (serviceId?: string) => apiFetch<any[]>(`/api/designs${serviceId ? "?service_id=" + serviceId : ""}`),
  design: (id: string) => apiFetch<any>(`/api/designs/${id}`),
  // addresses
  addresses: () => apiFetch<any[]>("/api/addresses"),
  createAddress: (a: any) => apiFetch<any>("/api/addresses", { method: "POST", body: JSON.stringify(a) }),
  deleteAddress: (id: string) => apiFetch<any>(`/api/addresses/${id}`, { method: "DELETE" }),
  // bookings
  createBooking: (b: any) => apiFetch<any>("/api/bookings", { method: "POST", body: JSON.stringify(b) }),
  bookings: (status?: string) => apiFetch<any[]>(`/api/bookings${status ? "?status_filter=" + status : ""}`),
  booking: (id: string) => apiFetch<any>(`/api/bookings/${id}`),
  cancelBooking: (id: string) => apiFetch<any>(`/api/bookings/${id}/cancel`, { method: "POST" }),
  // notifications
  notifications: () => apiFetch<any[]>("/api/notifications"),
  markRead: (id: string) => apiFetch<any>(`/api/notifications/${id}/read`, { method: "POST" }),
  // media
  uploadReference: (base64: string, contentType = "image/jpeg") =>
    apiFetch<{ id: string; url: string }>("/api/media/upload", {
      method: "POST", body: JSON.stringify({ data_base64: base64, content_type: contentType, kind: "reference" }),
    }),

  // ---------- PROVIDER ----------
  registerProvider: (b: any) => apiFetch<any>("/api/auth/register-provider", { method: "POST", body: JSON.stringify(b) }),
  providerMe: () => apiFetch<any>("/api/provider/me"),
  providerUpdate: (b: any) => apiFetch<any>("/api/provider/me", { method: "PATCH", body: JSON.stringify(b) }),
  providerAvailability: () => apiFetch<any>("/api/provider/availability"),
  providerSetAvailability: (state: "OFFLINE" | "AVAILABLE" | "BUSY" | "ON_SERVICE", lat?: number, lng?: number) =>
    apiFetch<any>("/api/provider/availability", { method: "POST", body: JSON.stringify({ state, latitude: lat, longitude: lng }) }),
  providerSchedule: () => apiFetch<any[]>("/api/provider/schedule"),
  providerSetSchedule: (days: any[]) => apiFetch<any[]>("/api/provider/schedule", { method: "PUT", body: JSON.stringify(days) }),
  providerServices: () => apiFetch<any[]>("/api/provider/services"),
  providerToggleService: (service_id: string, is_offered: boolean, experience_years = 0) =>
    apiFetch<any>("/api/provider/services", { method: "POST", body: JSON.stringify({ service_id, is_offered, experience_years }) }),
  providerPortfolio: () => apiFetch<any[]>("/api/provider/portfolio"),
  providerCreatePortfolio: (b: any) => apiFetch<any>("/api/provider/portfolio", { method: "POST", body: JSON.stringify(b) }),
  providerDeletePortfolio: (id: string) => apiFetch<any>(`/api/provider/portfolio/${id}`, { method: "DELETE" }),
  providerRequests: () => apiFetch<any[]>("/api/provider/requests"),
  providerBookings: (status?: string) => apiFetch<any[]>(`/api/provider/bookings${status ? "?status_filter=" + status : ""}`),
  providerBooking: (id: string) => apiFetch<any>(`/api/provider/bookings/${id}`),
  providerAccept: (bid: string) => apiFetch<any>(`/api/provider/requests/${bid}/accept`, { method: "POST" }),
  providerReject: (bid: string, reason?: string) => apiFetch<any>(`/api/provider/requests/${bid}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  providerTransition: (bid: string, status: string) => apiFetch<any>(`/api/provider/bookings/${bid}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  providerEarningsSummary: () => apiFetch<any>("/api/provider/earnings/summary"),
  providerEarnings: () => apiFetch<any[]>("/api/provider/earnings"),
  providerKYC: () => apiFetch<any>("/api/provider/kyc"),
  providerSubmitKYC: (b: any) => apiFetch<any>("/api/provider/kyc", { method: "POST", body: JSON.stringify(b) }),
  uploadImage: (base64: string, contentType = "image/jpeg", kind: "reference" | "portfolio" | "avatar" = "portfolio") =>
    apiFetch<{ id: string; url: string }>("/api/media/upload", {
      method: "POST", body: JSON.stringify({ data_base64: base64, content_type: contentType, kind }),
    }),

  // ---------- ADMIN ----------
  adminDashboard: () => apiFetch<any>("/api/admin/dashboard"),
  adminCustomers: (params: { q?: string; skip?: number; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (params.q) p.set("q", params.q);
    if (params.skip != null) p.set("skip", String(params.skip));
    if (params.limit != null) p.set("limit", String(params.limit));
    return apiFetch<any>(`/api/admin/customers${p.toString() ? "?" + p : ""}`);
  },
  adminCustomer: (id: string) => apiFetch<any>(`/api/admin/customers/${id}`),
  adminSetCustomerActive: (id: string, is_active: boolean) => apiFetch<any>(`/api/admin/customers/${id}/status`, { method: "POST", body: JSON.stringify({ is_active }) }),
  adminProviders: (params: { q?: string; kyc?: string; active?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (params.q) p.set("q", params.q);
    if (params.kyc) p.set("kyc", params.kyc);
    if (params.active != null) p.set("active", String(params.active));
    return apiFetch<any>(`/api/admin/providers${p.toString() ? "?" + p : ""}`);
  },
  adminProvider: (id: string) => apiFetch<any>(`/api/admin/providers/${id}`),
  adminSetProviderActive: (id: string, is_active: boolean) => apiFetch<any>(`/api/admin/providers/${id}/status`, { method: "POST", body: JSON.stringify({ is_active }) }),
  adminKycList: (status?: string) => apiFetch<any[]>(`/api/admin/kyc${status ? "?status_filter=" + status : ""}`),
  adminKycDetail: (pid: string) => apiFetch<any>(`/api/admin/kyc/${pid}`),
  adminKycApprove: (pid: string) => apiFetch<any>(`/api/admin/kyc/${pid}/approve`, { method: "POST" }),
  adminKycReject: (pid: string, reason: string) => apiFetch<any>(`/api/admin/kyc/${pid}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminCategoriesAll: () => apiFetch<any[]>("/api/categories"),
  adminCreateCategory: (b: any) => apiFetch<any>("/api/admin/categories", { method: "POST", body: JSON.stringify(b) }),
  adminUpdateCategory: (id: string, b: any) => apiFetch<any>(`/api/admin/categories/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  adminDeleteCategory: (id: string) => apiFetch<any>(`/api/admin/categories/${id}`, { method: "DELETE" }),
  adminServices: () => apiFetch<any[]>("/api/admin/services"),
  adminCreateService: (b: any) => apiFetch<any>("/api/admin/services", { method: "POST", body: JSON.stringify(b) }),
  adminUpdateService: (id: string, b: any) => apiFetch<any>(`/api/admin/services/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  adminDeleteService: (id: string) => apiFetch<any>(`/api/admin/services/${id}`, { method: "DELETE" }),
  adminPackages: (service_id?: string) => apiFetch<any[]>(`/api/admin/packages${service_id ? "?service_id=" + service_id : ""}`),
  adminCreatePackage: (b: any) => apiFetch<any>("/api/admin/packages", { method: "POST", body: JSON.stringify(b) }),
  adminUpdatePackage: (id: string, b: any) => apiFetch<any>(`/api/admin/packages/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  adminDeletePackage: (id: string) => apiFetch<any>(`/api/admin/packages/${id}`, { method: "DELETE" }),
  adminPortfolio: (status?: string) => apiFetch<any[]>(`/api/admin/portfolio${status ? "?status_filter=" + status : ""}`),
  adminPortfolioApprove: (id: string) => apiFetch<any>(`/api/admin/portfolio/${id}/approve`, { method: "POST" }),
  adminPortfolioReject: (id: string, reason: string) => apiFetch<any>(`/api/admin/portfolio/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminCustomRequests: () => apiFetch<any[]>("/api/admin/custom-requests"),
  adminBookings: (params: { status?: string; q?: string; skip?: number; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (params.status) p.set("status_filter", params.status);
    if (params.q) p.set("q", params.q);
    if (params.skip != null) p.set("skip", String(params.skip));
    if (params.limit != null) p.set("limit", String(params.limit));
    return apiFetch<any>(`/api/admin/bookings${p.toString() ? "?" + p : ""}`);
  },
  adminCities: () => apiFetch<any[]>("/api/locations/cities"),
  adminCreateCity: (b: any) => apiFetch<any>("/api/admin/cities", { method: "POST", body: JSON.stringify(b) }),
  adminUpdateCity: (id: string, b: any) => apiFetch<any>(`/api/admin/cities/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  adminDeleteCity: (id: string) => apiFetch<any>(`/api/admin/cities/${id}`, { method: "DELETE" }),
  adminReviews: () => apiFetch<any[]>("/api/admin/reviews"),
  adminModerateReview: (id: string, hidden: boolean) => apiFetch<any>(`/api/admin/reviews/${id}/moderate`, { method: "POST", body: JSON.stringify({ hidden }) }),
  adminComplaints: () => apiFetch<any[]>("/api/admin/complaints"),
  adminCoupons: () => apiFetch<any[]>("/api/admin/coupons"),
  adminCreateCoupon: (b: any) => apiFetch<any>("/api/admin/coupons", { method: "POST", body: JSON.stringify(b) }),
  adminUpdateCoupon: (id: string, b: any) => apiFetch<any>(`/api/admin/coupons/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  adminDeleteCoupon: (id: string) => apiFetch<any>(`/api/admin/coupons/${id}`, { method: "DELETE" }),
  adminEarnings: () => apiFetch<any[]>("/api/admin/earnings"),
  adminAuditLogs: () => apiFetch<any[]>("/api/admin/audit-logs"),
  adminAnnounce: (b: any) => apiFetch<any>("/api/admin/announcements", { method: "POST", body: JSON.stringify(b) }),
};

export const API_BASE = BASE;
export const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
