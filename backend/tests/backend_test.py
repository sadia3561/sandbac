"""SANDBAC backend tests - covers health, auth, catalog, addresses, bookings, media, role-guard."""
import base64
import time
import uuid
import pytest


# ---------------- Health / Seeding ----------------
class TestHealthAndSeed:
    def test_health(self, api, base_url):
        r = api.get(f"{base_url}/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_cities_seeded(self, api, base_url):
        r = api.get(f"{base_url}/api/locations/cities")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 5
        assert all("name" in c and "state" in c for c in data)

    def test_categories_seeded_and_sorted(self, api, base_url):
        r = api.get(f"{base_url}/api/categories")
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 5
        sort_orders = [c.get("sort_order", 0) for c in data]
        assert sort_orders == sorted(sort_orders), "categories not sorted by sort_order"

    def test_services_seeded(self, api, base_url):
        r = api.get(f"{base_url}/api/services")
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 6
        assert all("starting_price_paise" in s for s in data)


# ---------------- Auth ----------------
class TestAuth:
    def test_register_duplicate_returns_409(self, api, base_url, customer_tokens):
        # customer already registered by fixture
        r = api.post(f"{base_url}/api/auth/register", json={
            "name": "Dup", "email": "customer@sandbac.in", "password": "Customer@Test2026"
        })
        assert r.status_code == 409

    def test_register_creates_customer_profile(self, api, base_url):
        email = f"t_{uuid.uuid4().hex[:8]}@sandbac.in"
        r = api.post(f"{base_url}/api/auth/register", json={
            "name": "New User", "email": email, "password": "TestPass@123"
        })
        assert r.status_code == 201
        data = r.json()
        assert "access_token" in data and "refresh_token" in data
        assert data["user"]["role"] == "CUSTOMER"
        assert data["user"]["email"] == email
        # /me works with token
        h = {"Authorization": f"Bearer {data['access_token']}"}
        me = api.get(f"{base_url}/api/auth/me", headers=h)
        assert me.status_code == 200
        assert me.json()["email"] == email

    def test_login_wrong_password_returns_401(self, api, base_url):
        r = api.post(f"{base_url}/api/auth/login", json={
            "email": "customer@sandbac.in", "password": "WrongPassword!"
        })
        assert r.status_code == 401

    def test_login_success(self, api, base_url):
        r = api.post(f"{base_url}/api/auth/login", json={
            "email": "customer@sandbac.in", "password": "Customer@Test2026"
        })
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_me_no_token_returns_401(self, api, base_url):
        r = api.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_me_with_token(self, api, base_url, customer_headers):
        r = api.get(f"{base_url}/api/auth/me", headers=customer_headers)
        assert r.status_code == 200
        u = r.json()
        assert u["email"] == "customer@sandbac.in"
        assert u["role"] == "CUSTOMER"

    def test_refresh_rotation_and_replay_401(self, api, base_url):
        # register fresh user
        email = f"t_{uuid.uuid4().hex[:8]}@sandbac.in"
        r = api.post(f"{base_url}/api/auth/register", json={
            "name": "RT", "email": email, "password": "TestPass@123"
        })
        assert r.status_code == 201
        old_rt = r.json()["refresh_token"]
        # use it
        r2 = api.post(f"{base_url}/api/auth/refresh", json={"refresh_token": old_rt})
        assert r2.status_code == 200
        assert r2.json()["refresh_token"] != old_rt
        # replay should fail
        r3 = api.post(f"{base_url}/api/auth/refresh", json={"refresh_token": old_rt})
        assert r3.status_code == 401


# ---------------- Catalog ----------------
class TestCatalog:
    def test_services_filter_by_category(self, api, base_url):
        cats = api.get(f"{base_url}/api/categories").json()
        cid = cats[0]["id"]
        r = api.get(f"{base_url}/api/services", params={"category_id": cid})
        assert r.status_code == 200
        for s in r.json():
            assert s["category_id"] == cid

    def test_services_popular_sorted(self, api, base_url):
        r = api.get(f"{base_url}/api/services/popular")
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_service_detail_and_packages(self, api, base_url):
        svcs = api.get(f"{base_url}/api/services").json()
        sid = svcs[0]["id"]
        r = api.get(f"{base_url}/api/services/{sid}")
        assert r.status_code == 200
        assert r.json()["id"] == sid
        p = api.get(f"{base_url}/api/services/{sid}/packages")
        assert p.status_code == 200
        pkgs = p.json()
        assert len(pkgs) >= 1
        prices = [x["base_price_paise"] for x in pkgs]
        assert prices == sorted(prices), "packages not sorted by price asc"

    def test_service_not_found(self, api, base_url):
        assert api.get(f"{base_url}/api/services/nope-nope").status_code == 404

    def test_designs_list_and_filter_and_detail(self, api, base_url):
        r = api.get(f"{base_url}/api/designs")
        assert r.status_code == 200
        designs = r.json()
        assert len(designs) >= 9
        d = designs[0]
        # by service
        r2 = api.get(f"{base_url}/api/designs", params={"service_id": d["service_id"]})
        assert r2.status_code == 200
        # detail
        r3 = api.get(f"{base_url}/api/designs/{d['id']}")
        assert r3.status_code == 200
        assert r3.json()["id"] == d["id"]


# ---------------- Addresses ----------------
class TestAddresses:
    def test_address_crud_and_scope(self, api, base_url, customer_headers):
        payload = {
            "label": "Home", "house": "12A", "street": "Test St",
            "city": "Bengaluru", "state": "Karnataka", "pincode": "560001",
            "is_default": True,
        }
        r = api.post(f"{base_url}/api/addresses", json=payload, headers=customer_headers)
        assert r.status_code == 201
        aid = r.json()["id"]
        # list
        r2 = api.get(f"{base_url}/api/addresses", headers=customer_headers)
        assert r2.status_code == 200
        assert any(a["id"] == aid for a in r2.json())
        # delete
        r3 = api.delete(f"{base_url}/api/addresses/{aid}", headers=customer_headers)
        assert r3.status_code == 200
        # confirm gone
        r4 = api.get(f"{base_url}/api/addresses", headers=customer_headers)
        assert not any(a["id"] == aid for a in r4.json())

    def test_addresses_require_auth(self, api, base_url):
        assert api.get(f"{base_url}/api/addresses").status_code == 401


# ---------------- Bookings ----------------
@pytest.fixture(scope="session")
def booking_setup(api, base_url, customer_headers):
    svcs = api.get(f"{base_url}/api/services").json()
    svc = svcs[0]
    pkgs = api.get(f"{base_url}/api/services/{svc['id']}/packages").json()
    pkg = pkgs[0]
    # create address
    addr_r = api.post(f"{base_url}/api/addresses", json={
        "label": "Home", "house": "1", "street": "Main", "city": "Bengaluru",
        "state": "Karnataka", "pincode": "560001", "is_default": True,
    }, headers=customer_headers)
    assert addr_r.status_code == 201
    return {"service": svc, "package": pkg, "address_id": addr_r.json()["id"]}


class TestBookings:
    def test_create_asap_booking_status_searching(self, api, base_url, customer_headers, booking_setup):
        body = {
            "service_id": booking_setup["service"]["id"],
            "package_id": booking_setup["package"]["id"],
            "address_id": booking_setup["address_id"],
            "booking_type": "ASAP",
        }
        r = api.post(f"{base_url}/api/bookings", json=body, headers=customer_headers)
        assert r.status_code == 201, r.text
        b = r.json()
        assert b["status"] == "SEARCHING_PROVIDER"
        assert b["price_paise"] == booking_setup["package"]["base_price_paise"]
        assert b["provider_id"] is None
        # notification created
        n = api.get(f"{base_url}/api/notifications", headers=customer_headers)
        assert n.status_code == 200
        assert any(x.get("booking_id") == b["id"] for x in n.json())

    def test_create_scheduled_requires_scheduled_at(self, api, base_url, customer_headers, booking_setup):
        body = {
            "service_id": booking_setup["service"]["id"],
            "package_id": booking_setup["package"]["id"],
            "address_id": booking_setup["address_id"],
            "booking_type": "SCHEDULED",
        }
        r = api.post(f"{base_url}/api/bookings", json=body, headers=customer_headers)
        assert r.status_code == 400

    def test_create_scheduled_ok(self, api, base_url, customer_headers, booking_setup):
        from datetime import datetime, timedelta, timezone
        body = {
            "service_id": booking_setup["service"]["id"],
            "package_id": booking_setup["package"]["id"],
            "address_id": booking_setup["address_id"],
            "booking_type": "SCHEDULED",
            "scheduled_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        }
        r = api.post(f"{base_url}/api/bookings", json=body, headers=customer_headers)
        assert r.status_code == 201
        assert r.json()["status"] == "PENDING"

    def test_list_and_filter_and_cancel(self, api, base_url, customer_headers, booking_setup):
        # create booking
        body = {
            "service_id": booking_setup["service"]["id"],
            "package_id": booking_setup["package"]["id"],
            "address_id": booking_setup["address_id"],
            "booking_type": "ASAP",
        }
        r = api.post(f"{base_url}/api/bookings", json=body, headers=customer_headers)
        bid = r.json()["id"]
        # get detail
        d = api.get(f"{base_url}/api/bookings/{bid}", headers=customer_headers)
        assert d.status_code == 200
        # upcoming filter
        up = api.get(f"{base_url}/api/bookings", params={"status_filter": "upcoming"}, headers=customer_headers)
        assert up.status_code == 200
        assert any(x["id"] == bid for x in up.json())
        # cancel
        c = api.post(f"{base_url}/api/bookings/{bid}/cancel", headers=customer_headers)
        assert c.status_code == 200
        assert c.json()["status"] == "CANCELLED"
        # cancelled filter
        cf = api.get(f"{base_url}/api/bookings", params={"status_filter": "cancelled"}, headers=customer_headers)
        assert any(x["id"] == bid for x in cf.json())

    def test_admin_cannot_create_booking(self, api, base_url, admin_headers, booking_setup):
        body = {
            "service_id": booking_setup["service"]["id"],
            "package_id": booking_setup["package"]["id"],
            "address_id": booking_setup["address_id"],
            "booking_type": "ASAP",
        }
        r = api.post(f"{base_url}/api/bookings", json=body, headers=admin_headers)
        assert r.status_code == 403


# ---------------- Media ----------------
class TestMedia:
    def test_upload_and_fetch(self, api, base_url, customer_headers):
        # 1x1 png
        png = base64.b64encode(bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4"
            "890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
        )).decode()
        r = api.post(f"{base_url}/api/media/upload", json={
            "data_base64": png, "content_type": "image/png", "kind": "reference"
        }, headers=customer_headers)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["url"].startswith("/api/media/")
        # fetch
        g = api.get(f"{base_url}{data['url']}")
        assert g.status_code == 200
        assert g.headers.get("content-type", "").startswith("image/")
