import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://services-doorstep.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def customer_tokens(api):
    """Register or login test customer. Returns dict of access, refresh, user."""
    email = "customer@sandbac.in"
    password = "Customer@Test2026"
    # try login first
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code == 200:
        return r.json()
    # register
    r = api.post(f"{BASE_URL}/api/auth/register", json={
        "name": "Test Customer", "email": email, "password": password
    })
    assert r.status_code in (201, 409), f"register failed {r.status_code}: {r.text}"
    if r.status_code == 409:
        r = api.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def customer_headers(customer_tokens):
    return {"Authorization": f"Bearer {customer_tokens['access_token']}"}


@pytest.fixture(scope="session")
def admin_tokens(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@sandbac.in", "password": "Sandbac@Admin2026"
    })
    assert r.status_code == 200, f"admin login failed: {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def admin_headers(admin_tokens):
    return {"Authorization": f"Bearer {admin_tokens['access_token']}"}
