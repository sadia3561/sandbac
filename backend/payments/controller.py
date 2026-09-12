"""Payments FastAPI router factory.

Called once from server.py with existing dependencies (db, current_user, gateway,
services). Returns an APIRouter ready to be mounted with `app.include_router()`.
"""
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, Request
import logging

from .types import (
    CreateOrderIn, CreateOrderOut, VerifyPaymentIn, PaymentOut,
    RefundRequestIn, RefundOut, EarningOut, PayoutOut,
    CommissionConfigIn, CommissionConfigOut,
    BankDetailsIn, BankDetailsOut, PayoutRequestIn,
    CommissionScope,
)
from . import constants as C

log = logging.getLogger("sandbac.payments.controller")


def build_router(
    *,
    db,
    gateway,
    payments,           # PaymentService
    commission,         # CommissionService
    refunds,            # RefundService
    earnings,           # EarningsService
    payouts,            # PayoutService
    webhooks,           # WebhookService
    events,             # PaymentEventBus
    current_user,       # dependency callable
    role_enum,          # Role enum from server
) -> APIRouter:

    r = APIRouter(prefix="/api", tags=["payments"])
    Role = role_enum

    # ---- helpers ---------------------------------------------------------
    async def _customer(user) -> dict:
        c = await db.customers.find_one({"user_id": user["id"]}, {"_id": 0})
        if not c:
            raise HTTPException(400, "Customer profile missing")
        return c

    async def _provider(user) -> dict:
        p = await db.providers.find_one({"user_id": user["id"]}, {"_id": 0})
        if not p:
            raise HTTPException(404, "Provider profile not found")
        return p

    def _require_role(*roles):
        async def dep(user=Depends(current_user)):
            if user["role"] not in [x.value for x in roles]:
                raise HTTPException(403, "Insufficient role")
            return user
        return dep

    # =====================================================================
    # CUSTOMER
    # =====================================================================
    @r.get("/payments/config")
    async def payment_client_config():
        return {**gateway.client_config(), "currency": C.DEFAULT_CURRENCY}

    @r.post("/payments/order", response_model=CreateOrderOut, status_code=201)
    async def create_order(body: CreateOrderIn, user=Depends(_require_role(Role.CUSTOMER))):
        booking = await db.bookings.find_one({"id": body.booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(404, "Booking not found")
        cust = await _customer(user)
        if booking["customer_id"] != cust["id"]:
            raise HTTPException(403, "Not your booking")
        if booking["status"] in ("CANCELLED", "EXPIRED"):
            raise HTTPException(400, "Booking not payable")
        try:
            return await payments.create_order_for_booking(booking=booking, customer=user)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @r.post("/payments/verify", response_model=PaymentOut)
    async def verify_payment(body: VerifyPaymentIn, user=Depends(_require_role(Role.CUSTOMER))):
        try:
            return await payments.verify_and_capture(
                payment_id=body.payment_id,
                gateway_order_id=body.gateway_order_id,
                gateway_payment_id=body.gateway_payment_id,
                gateway_signature=body.gateway_signature,
                customer_user_id=user["id"],
            )
        except ValueError as e:
            raise HTTPException(400, str(e))

    class CancelAttemptIn(CreateOrderIn):
        payment_id: str
        gateway_order_id: str
        reason: Optional[str] = None

    @r.post("/payments/attempt/cancel")
    async def cancel_attempt(body: CancelAttemptIn, user=Depends(current_user)):
        p = await db.payments.find_one({"id": body.payment_id}, {"_id": 0})
        if not p or p.get("customer_user_id") != user["id"]:
            raise HTTPException(404, "Not found")
        await payments.mark_attempt_failed(
            payment_id=body.payment_id, gateway_order_id=body.gateway_order_id,
            reason=body.reason or "customer_cancelled",
        )
        return {"ok": True}

    @r.get("/payments/{payment_id}", response_model=PaymentOut)
    async def get_payment(payment_id: str, user=Depends(current_user)):
        p = await payments.get_for_customer(payment_id=payment_id, customer_user_id=user["id"])
        if not p and user["role"] == Role.ADMIN.value:
            p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
        if not p:
            raise HTTPException(404, "Not found")
        return p

    @r.get("/customer/payments", response_model=list[PaymentOut])
    async def customer_payment_history(skip: int = 0, limit: int = 30,
                                        user=Depends(_require_role(Role.CUSTOMER))):
        return await payments.list_for_customer(
            customer_user_id=user["id"], skip=skip, limit=min(limit, 100),
        )

    @r.get("/bookings/{booking_id}/payment")
    async def booking_payment(booking_id: str, user=Depends(current_user)):
        booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(404, "Not found")
        cust = await db.customers.find_one({"user_id": user["id"]})
        prov = await db.providers.find_one({"user_id": user["id"]})
        allowed = user["role"] == Role.ADMIN.value \
            or (cust and booking["customer_id"] == cust["id"]) \
            or (prov and booking.get("provider_id") == prov["id"])
        if not allowed:
            raise HTTPException(403, "Forbidden")
        p = await db.payments.find_one({"booking_id": booking_id}, {"_id": 0},
                                         sort=[("created_at", -1)])
        if not p:
            return None
        if user["role"] == Role.PROVIDER.value:
            p = {k: v for k, v in p.items() if k not in ("failure_reason", "gateway_signature")}
        return p

    @r.get("/bookings/{booking_id}/payment/attempts")
    async def booking_payment_attempts(booking_id: str, user=Depends(current_user)):
        booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(404, "Not found")
        cust = await db.customers.find_one({"user_id": user["id"]})
        if not (user["role"] == Role.ADMIN.value or (cust and booking["customer_id"] == cust["id"])):
            raise HTTPException(403, "Forbidden")
        return await payments.list_attempts(booking_id=booking_id)

    # =====================================================================
    # WEBHOOK
    # =====================================================================
    @r.post("/payments/webhook")
    async def payments_webhook(request: Request,
                                x_signature: Optional[str] = Header(default=None, alias="X-Sandbac-Signature"),
                                x_razorpay_signature: Optional[str] = Header(default=None, alias="X-Razorpay-Signature")):
        raw = await request.body()
        signature = x_signature or x_razorpay_signature or ""
        return await webhooks.handle(raw_body=raw, signature_header=signature)

    # =====================================================================
    # REFUNDS
    # =====================================================================
    @r.post("/payments/{payment_id}/refund", response_model=RefundOut)
    async def create_refund(payment_id: str, body: RefundRequestIn, user=Depends(current_user)):
        p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
        if not p:
            raise HTTPException(404, "Payment not found")
        cust = await db.customers.find_one({"user_id": user["id"]})
        is_admin = user["role"] == Role.ADMIN.value
        is_owner = cust and p.get("customer_id") == cust.get("id")
        if not (is_admin or is_owner):
            raise HTTPException(403, "Forbidden")
        if is_owner and not is_admin:
            booking = await db.bookings.find_one({"id": p["booking_id"]}, {"_id": 0, "status": 1})
            if not booking or booking["status"] != "CANCELLED":
                raise HTTPException(400, "Booking must be cancelled before refund")
        try:
            return await refunds.create(
                payment_id=payment_id,
                requested_amount_paise=body.amount_paise,
                reason=body.reason,
                requested_by_user_id=user["id"],
                source="admin" if is_admin else "customer",
            )
        except ValueError as e:
            raise HTTPException(400, str(e))

    @r.get("/bookings/{booking_id}/refunds", response_model=list[RefundOut])
    async def list_refunds_for_booking(booking_id: str, user=Depends(current_user)):
        booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "customer_id": 1})
        if not booking:
            raise HTTPException(404, "Not found")
        cust = await db.customers.find_one({"user_id": user["id"]})
        if not (user["role"] == Role.ADMIN.value or (cust and booking["customer_id"] == cust["id"])):
            raise HTTPException(403, "Forbidden")
        return await refunds.list_for_booking(booking_id)

    # =====================================================================
    # PROVIDER — EARNINGS
    # =====================================================================
    @r.get("/provider/earnings", response_model=list[EarningOut])
    async def list_provider_earnings(skip: int = 0, limit: int = 50,
                                      user=Depends(_require_role(Role.PROVIDER))):
        prov = await _provider(user)
        # opportunistic hold-period promotion
        try: await earnings.promote_available()
        except Exception: pass
        return await earnings.list_for_provider(provider_id=prov["id"], skip=skip, limit=limit)

    @r.get("/provider/earnings/summary/v2")
    async def provider_earnings_summary_v2(user=Depends(_require_role(Role.PROVIDER))):
        prov = await _provider(user)
        try: await earnings.promote_available()
        except Exception: pass
        return await earnings.provider_summary(provider_id=prov["id"])

    @r.get("/provider/earnings/detail/{eid}", response_model=EarningOut)
    async def get_provider_earning(eid: str, user=Depends(_require_role(Role.PROVIDER))):
        prov = await _provider(user)
        e = await db.earnings.find_one({"id": eid, "provider_id": prov["id"]}, {"_id": 0})
        if not e:
            raise HTTPException(404, "Not found")
        return e

    # =====================================================================
    # PROVIDER — BANK / PAYOUTS
    # =====================================================================
    @r.put("/provider/bank-details", response_model=BankDetailsOut)
    async def save_bank(body: BankDetailsIn, user=Depends(_require_role(Role.PROVIDER))):
        prov = await _provider(user)
        return await payouts.save_bank_details(
            provider_id=prov["id"], account_holder=body.account_holder,
            account_number=body.account_number, ifsc=body.ifsc,
            bank_name=body.bank_name, upi_id=body.upi_id,
        )

    @r.get("/provider/bank-details")
    async def get_bank(user=Depends(_require_role(Role.PROVIDER))):
        prov = await _provider(user)
        return await payouts.get_bank_details(provider_id=prov["id"])

    @r.post("/provider/payouts/request", response_model=PayoutOut, status_code=201)
    async def request_payout(body: PayoutRequestIn, user=Depends(_require_role(Role.PROVIDER))):
        prov = await _provider(user)
        try: await earnings.promote_available()
        except Exception: pass
        try:
            return await payouts.request_payout(provider_id=prov["id"], earning_ids=body.earning_ids)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @r.get("/provider/payouts", response_model=list[PayoutOut])
    async def list_provider_payouts(limit: int = 50, user=Depends(_require_role(Role.PROVIDER))):
        prov = await _provider(user)
        return await payouts.list_for_provider(provider_id=prov["id"], limit=limit)

    # =====================================================================
    # ADMIN
    # =====================================================================
    @r.get("/admin/payments", response_model=list[PaymentOut])
    async def admin_list_payments(state: Optional[str] = None, skip: int = 0, limit: int = 50,
                                    user=Depends(_require_role(Role.ADMIN))):
        return await payments.admin_list(state=state, skip=skip, limit=limit)

    @r.get("/admin/payments/dashboard")
    async def admin_payments_dashboard(user=Depends(_require_role(Role.ADMIN))):
        p_totals = await payments.admin_totals()
        e_totals = await earnings.admin_totals()
        refunds_count = await db.refunds.count_documents({"state": "COMPLETED"})
        rf = await db.refunds.aggregate([
            {"$match": {"state": "COMPLETED"}},
            {"$group": {"_id": None, "s": {"$sum": "$approved_amount_paise"}}},
        ]).to_list(1)
        pa = await db.payouts.aggregate([
            {"$match": {"state": "PAID"}},
            {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}}},
        ]).to_list(1)
        return {
            "payments": p_totals,
            "earnings": e_totals,
            "refunds": {"count": refunds_count, "paise": int(rf[0]["s"]) if rf else 0},
            "payouts_paid": {"paise": int(pa[0]["s"]) if pa else 0},
            "currency": C.DEFAULT_CURRENCY,
        }

    @r.get("/admin/refunds", response_model=list[RefundOut])
    async def admin_list_refunds(state: Optional[str] = None, skip: int = 0, limit: int = 50,
                                   user=Depends(_require_role(Role.ADMIN))):
        return await refunds.list_all(skip=skip, limit=limit, state=state)

    @r.get("/admin/earnings", response_model=list[EarningOut])
    async def admin_list_earnings(skip: int = 0, limit: int = 50,
                                    user=Depends(_require_role(Role.ADMIN))):
        try: await earnings.promote_available()
        except Exception: pass
        return await db.earnings.find({}, {"_id": 0}).sort("created_at", -1) \
            .skip(skip).limit(min(limit, 200)).to_list(limit)

    @r.get("/admin/payouts", response_model=list[PayoutOut])
    async def admin_list_payouts(state: Optional[str] = None, skip: int = 0, limit: int = 50,
                                   user=Depends(_require_role(Role.ADMIN))):
        return await payouts.list_admin(state=state, skip=skip, limit=limit)

    class MarkPayoutIn(RefundRequestIn):
        gateway_payout_id: Optional[str] = None

    @r.post("/admin/payouts/{payout_id}/mark-paid", response_model=PayoutOut)
    async def admin_mark_paid(payout_id: str, body: Optional[MarkPayoutIn] = None,
                                user=Depends(_require_role(Role.ADMIN))):
        try:
            return await payouts.mark_paid(
                payout_id=payout_id,
                gateway_payout_id=(body.gateway_payout_id if body else None),
            )
        except ValueError as e:
            raise HTTPException(400, str(e))

    @r.post("/admin/payouts/{payout_id}/mark-failed", response_model=PayoutOut)
    async def admin_mark_failed(payout_id: str, body: RefundRequestIn,
                                  user=Depends(_require_role(Role.ADMIN))):
        try:
            return await payouts.mark_failed(payout_id=payout_id, reason=body.reason or "admin_failed")
        except ValueError as e:
            raise HTTPException(400, str(e))

    @r.get("/admin/commission-config", response_model=list[CommissionConfigOut])
    async def admin_list_commission(user=Depends(_require_role(Role.ADMIN))):
        return await commission.list_all()

    @r.post("/admin/commission-config", response_model=CommissionConfigOut)
    async def admin_upsert_commission(body: CommissionConfigIn,
                                        user=Depends(_require_role(Role.ADMIN))):
        if body.scope != CommissionScope.GLOBAL and not body.scope_id:
            raise HTTPException(400, "scope_id required for non-GLOBAL scope")
        if body.percent is None and body.fixed_paise is None:
            raise HTTPException(400, "Provide percent or fixed_paise")
        return await commission.upsert(
            scope=body.scope.value, scope_id=body.scope_id,
            percent=body.percent, fixed_paise=body.fixed_paise, is_active=body.is_active,
        )

    # =====================================================================
    # MOCK-ONLY: simulate gateway "checkout success" for the mobile app.
    # Guarded to non-production environments; real gateways NEVER need this.
    # =====================================================================
    @r.post("/payments/mock/pay")
    async def mock_pay(body: dict, user=Depends(current_user)):
        if C.GATEWAY_ENVIRONMENT == "production" or gateway.name != "mock":
            raise HTTPException(404, "Not available")
        pid = body.get("payment_id")
        goid = body.get("gateway_order_id")
        if not pid or not goid:
            raise HTTPException(400, "payment_id and gateway_order_id required")
        p = await db.payments.find_one({"id": pid, "customer_user_id": user["id"]}, {"_id": 0})
        if not p:
            raise HTTPException(404, "payment not found")
        if p.get("gateway_order_id") != goid:
            raise HTTPException(400, "order mismatch")
        # Only the mock gateway exposes compute_signature (typed via duck-typing)
        gpid = f"pay_mock_{goid[-10:]}"
        try:
            sig = gateway.compute_signature(goid, gpid)  # type: ignore[attr-defined]
        except Exception:
            raise HTTPException(500, "signature generation failed")
        return {"gateway_payment_id": gpid, "gateway_signature": sig}

    return r
