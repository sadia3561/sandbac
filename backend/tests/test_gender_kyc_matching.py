"""Gender restriction + KYC gate enforcement tests.

Rules verified:
  R1  Facial / Mehndi / Makeup / Saree Draping → matches ONLY female providers
  R2  Decoration / Celebration → matches providers of ANY gender
  R3  Provider without KYC=APPROVED is EXCLUDED from matching regardless of gender
  R4  Direct-accept endpoint rejects (a) unverified provider (b) wrong-gender provider
"""
import asyncio, time, httpx

BASE = "http://localhost:8001/api"
ADMIN = ("admin@sandbac.in", "Sandbac@Admin2026")


async def _login(c, email, pw):
    r = await c.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    r.raise_for_status()
    return r.json()["access_token"]


async def _register_provider(c, email, pw, name, gender):
    r = await c.post(f"{BASE}/auth/register-provider", json={
        "name": name, "email": email, "phone": "+919" + str(int(time.time()))[-9:],
        "password": pw, "business_name": name, "provider_type": "FULL_TIME",
        "gender": gender, "city": "Bengaluru", "state": "Karnataka",
    })
    if r.status_code == 409:
        return await _login(c, email, pw), None
    r.raise_for_status()
    return r.json()["access_token"], r.json()


async def _register_customer(c, email, pw):
    r = await c.post(f"{BASE}/auth/register", json={
        "name": "Test Cust", "email": email, "phone": "+919000000000",
        "password": pw,
    })
    if r.status_code == 409:
        r = await c.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    r.raise_for_status()
    return r.json()["access_token"]


async def _admin_approve_kyc_directly(c, admin_tok, provider_user_email):
    # Look up provider via admin API
    provs = (await c.get(f"{BASE}/admin/providers?q={provider_user_email}",
                          headers={"Authorization": f"Bearer {admin_tok}"})).json()
    items = provs["items"] if isinstance(provs, dict) else provs
    assert items, f"provider not visible to admin: {provider_user_email}"
    provider_id = items[0]["id"]
    # Directly set kyc_status via admin DB — but we don't have that endpoint. Use kyc approve if pending.
    # Trigger fake KYC row + approve:
    return provider_id


async def main():
    tag = str(int(time.time()))
    async with httpx.AsyncClient(timeout=30) as c:
        admin_tok = await _login(c, *ADMIN)

        # Two providers offering the SAME female-only service (Mehndi)
        f_email = f"gtest_f_{tag}@sandbac.in"
        m_email = f"gtest_m_{tag}@sandbac.in"
        f_tok, _ = await _register_provider(c, f_email, "Prov@1234", "Female Studio", "FEMALE")
        m_tok, _ = await _register_provider(c, m_email, "Prov@1234", "Male Studio", "MALE")

        # Directly force kyc_status=APPROVED via Mongo shell would be cleanest, but we'll go through the API.
        # Provider submits KYC → admin approves. But admin_kyc_approve requires provider_id.
        # Simplest path: use motor directly.
        from motor.motor_asyncio import AsyncIOMotorClient
        db_c = AsyncIOMotorClient("mongodb://localhost:27017")["sandbac_db"]

        # Approve F only for R3 first isolation
        f_prov = await db_c.users.find_one({"email": f_email})
        m_prov = await db_c.users.find_one({"email": m_email})
        await db_c.providers.update_one({"user_id": f_prov["id"]}, {"$set": {"kyc_status": "APPROVED"}})
        # M stays NOT_SUBMITTED for the KYC gate test
        # Both providers accept the Mehndi service + go AVAILABLE
        svcs = (await c.get(f"{BASE}/services")).json()
        mehndi = next(s for s in svcs if s["slug"] == "mehndi")
        birthday = next(s for s in svcs if s["slug"] == "birthday-decoration")
        assert mehndi["gender_restriction"] == "FEMALE_ONLY"
        assert birthday["gender_restriction"] == "NONE"

        for tok in [f_tok, m_tok]:
            await c.post(f"{BASE}/provider/services", headers={"Authorization": f"Bearer {tok}"},
                          json={"service_id": mehndi["id"], "is_offered": True, "experience_years": 2})
            await c.post(f"{BASE}/provider/services", headers={"Authorization": f"Bearer {tok}"},
                          json={"service_id": birthday["id"], "is_offered": True, "experience_years": 2})
            await c.post(f"{BASE}/provider/availability", headers={"Authorization": f"Bearer {tok}"},
                          json={"state": "AVAILABLE"})

        # Customer + address + booking (Mehndi = FEMALE_ONLY)
        cust_tok = await _register_customer(c, f"gtest_c_{tag}@sandbac.in", "Cust@1234")
        addr = (await c.post(f"{BASE}/addresses", headers={"Authorization": f"Bearer {cust_tok}"},
                              json={"label": "Home", "house": "1", "street": "MG", "city": "Bengaluru",
                                    "state": "Karnataka", "pincode": "560001",
                                    "latitude": 12.97, "longitude": 77.59, "is_default": True})).json()

        print("── R1: Mehndi (FEMALE_ONLY) — only female APPROVED providers eligible ──")
        bk = (await c.post(f"{BASE}/bookings", headers={"Authorization": f"Bearer {cust_tok}"},
                            json={"service_id": mehndi["id"],
                                  "package_id": (await c.get(f"{BASE}/services/{mehndi['id']}/packages")).json()[0]["id"],
                                  "address_id": addr["id"], "booking_type": "ASAP"})).json()
        # Admin matching-debug reveals ranked candidates + eligibility reasons
        dbg = (await c.get(f"{BASE}/admin/bookings/{bk['id']}/matching",
                            headers={"Authorization": f"Bearer {admin_tok}"})).json()
        ranked = dbg["ranked_candidates"]
        f_row = next((r for r in ranked if r["provider_name"] == "Female Studio"), None)
        m_row = next((r for r in ranked if r["provider_name"] == "Male Studio"), None)
        # Female provider must be eligible; Male provider must either be excluded from candidates
        # OR flagged with GENDER_RESTRICTION_MISMATCH.
        assert f_row and f_row["eligible"], f"female provider should be eligible: {f_row}"
        assert (m_row is None) or (not m_row["eligible"] and "GENDER_RESTRICTION_MISMATCH" in m_row["reasons"]) \
            , f"male provider should be excluded: {m_row}"
        print(f"   ✅ Female provider eligible; Male provider excluded ({'no candidate' if not m_row else m_row['reasons']})")

        print("── R2: Birthday Decoration (NONE) — both genders eligible ──")
        # Approve male KYC now so gender is the only differentiator
        await db_c.providers.update_one({"user_id": m_prov["id"]}, {"$set": {"kyc_status": "APPROVED"}})
        bk2 = (await c.post(f"{BASE}/bookings", headers={"Authorization": f"Bearer {cust_tok}"},
                             json={"service_id": birthday["id"],
                                   "package_id": (await c.get(f"{BASE}/services/{birthday['id']}/packages")).json()[0]["id"],
                                   "address_id": addr["id"], "booking_type": "ASAP"})).json()
        dbg2 = (await c.get(f"{BASE}/admin/bookings/{bk2['id']}/matching",
                             headers={"Authorization": f"Bearer {admin_tok}"})).json()
        ranked2 = dbg2["ranked_candidates"]
        f2 = next((r for r in ranked2 if r["provider_name"] == "Female Studio"), None)
        m2 = next((r for r in ranked2 if r["provider_name"] == "Male Studio"), None)
        assert f2 and f2["eligible"], f"female eligible on unrestricted: {f2}"
        assert m2 and m2["eligible"], f"male eligible on unrestricted: {m2}"
        print("   ✅ Both female + male providers eligible")

        print("── R3: KYC gate — unapproved provider excluded regardless of gender ──")
        # Revoke male's KYC and try Birthday again
        await db_c.providers.update_one({"user_id": m_prov["id"]}, {"$set": {"kyc_status": "PENDING"}})
        bk3 = (await c.post(f"{BASE}/bookings", headers={"Authorization": f"Bearer {cust_tok}"},
                             json={"service_id": birthday["id"],
                                   "package_id": (await c.get(f"{BASE}/services/{birthday['id']}/packages")).json()[0]["id"],
                                   "address_id": addr["id"], "booking_type": "ASAP"})).json()
        dbg3 = (await c.get(f"{BASE}/admin/bookings/{bk3['id']}/matching",
                             headers={"Authorization": f"Bearer {admin_tok}"})).json()
        m3 = next((r for r in dbg3["ranked_candidates"] if r["provider_name"] == "Male Studio"), None)
        assert (m3 is None) or (not m3["eligible"] and "KYC_NOT_APPROVED" in m3["reasons"]), \
            f"unapproved male should be excluded: {m3}"
        print(f"   ✅ Male provider without KYC excluded ({'no candidate' if not m3 else m3['reasons']})")

        print("── R4a: Direct-accept refuses provider without KYC ──")
        # Force a paying attempt through the direct-accept path
        # Create fresh booking, provider M (KYC=PENDING) tries to accept
        bk4 = (await c.post(f"{BASE}/bookings", headers={"Authorization": f"Bearer {cust_tok}"},
                             json={"service_id": birthday["id"],
                                   "package_id": (await c.get(f"{BASE}/services/{birthday['id']}/packages")).json()[0]["id"],
                                   "address_id": addr["id"], "booking_type": "ASAP"})).json()
        acc = await c.post(f"{BASE}/provider/requests/{bk4['id']}/accept",
                             headers={"Authorization": f"Bearer {m_tok}"})
        assert acc.status_code == 403 and "not yet verified" in acc.text.lower(), acc.text
        print(f"   ✅ 403 — {acc.json()['detail']}")

        print("── R4b: Direct-accept refuses wrong-gender provider on FEMALE_ONLY service ──")
        # Re-approve male's KYC, but Mehndi is FEMALE_ONLY. Male M must be rejected on gender rule.
        await db_c.providers.update_one({"user_id": m_prov["id"]}, {"$set": {"kyc_status": "APPROVED"}})
        bk5 = (await c.post(f"{BASE}/bookings", headers={"Authorization": f"Bearer {cust_tok}"},
                             json={"service_id": mehndi["id"],
                                   "package_id": (await c.get(f"{BASE}/services/{mehndi['id']}/packages")).json()[0]["id"],
                                   "address_id": addr["id"], "booking_type": "ASAP"})).json()
        acc2 = await c.post(f"{BASE}/provider/requests/{bk5['id']}/accept",
                              headers={"Authorization": f"Bearer {m_tok}"})
        assert acc2.status_code == 403 and "female" in acc2.text.lower(), acc2.text
        print(f"   ✅ 403 — {acc2.json()['detail']}")

        print("\n✅ ALL GENDER + KYC GATE TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
