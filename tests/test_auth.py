"""Tests for authentication, session handling, CSRF defense, roles, and rate limiting."""

import logging
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient

from backend.auth import (
    COOKIE_NAME,
    get_current_user,
    login_rate_limiter,
    require_role,
)
from backend.config import settings
from backend.db import get_db
from backend.main import create_app
from backend.seed import seed

DEMO_ADMIN_PASS = "Admin#2026!"
DEMO_VIEWER_PASS = "Viewer#2026!"


@pytest.fixture
def test_app(tmp_path: Path) -> Generator[FastAPI, None, None]:
    """Register test-only router with read and write role-protected routes."""
    test_router = APIRouter(prefix="/test")

    @test_router.get("/protected-read")
    async def protected_read(user: dict[str, Any] = Depends(get_current_user)):
        return {"status": "ok", "user": user["username"], "role": user["role"]}

    @test_router.post("/viewer-write")
    async def viewer_write(user: dict[str, Any] = Depends(get_current_user)):
        return {"status": "ok", "user": user["username"], "role": user["role"]}

    @test_router.post("/admin-write")
    async def admin_write(user: dict[str, Any] = Depends(require_role("admin"))):
        return {"status": "ok", "admin": user["username"]}

    db_file = tmp_path / "test_auth.db"
    orig_db = settings.db_path
    orig_rounds = settings.bcrypt_rounds

    settings.db_path = db_file
    settings.bcrypt_rounds = 4

    seed(db_file)
    app = create_app(extra_routers=[test_router])

    yield app

    settings.db_path = orig_db
    settings.bcrypt_rounds = orig_rounds


@pytest.fixture
def auth_client(test_app: FastAPI) -> TestClient:
    """Create test client with test router registered."""
    return TestClient(test_app)


def test_no_cookie_returns_401(auth_client: TestClient) -> None:
    """Accessing protected routes without a session cookie must return HTTP 401."""
    response = auth_client.get("/auth/me")
    assert response.status_code == 401
    data = response.json()
    assert data["error"]["code"] == "UNAUTHORIZED"

    response2 = auth_client.get("/test/protected-read")
    assert response2.status_code == 401
    assert response2.json()["error"]["code"] == "UNAUTHORIZED"


def test_missing_csrf_header_returns_403(auth_client: TestClient) -> None:
    """State-changing requests without X-Requested-With header must return HTTP 403."""
    response = auth_client.post(
        "/auth/login",
        json={"username": "admin", "password": DEMO_ADMIN_PASS},
    )
    assert response.status_code == 403
    data = response.json()
    assert data["error"]["code"] == "CSRF_FAILED"


def test_unknown_user_and_wrong_password_give_identical_responses(auth_client: TestClient) -> None:
    """Login must not reveal username existence: same error code and text for both cases."""
    headers = {"X-Requested-With": "XMLHttpRequest"}

    # Unknown username
    resp_unknown = auth_client.post(
        "/auth/login",
        json={"username": "nonexistent_user", "password": "WrongPassword123!"},
        headers=headers,
    )

    # Known username with wrong password
    resp_wrong_pw = auth_client.post(
        "/auth/login",
        json={"username": "admin", "password": "WrongPassword123!"},
        headers=headers,
    )

    assert resp_unknown.status_code == 401
    assert resp_wrong_pw.status_code == 401
    assert resp_unknown.json() == resp_wrong_pw.json()
    assert resp_unknown.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert resp_unknown.json()["error"]["message"] == "Invalid credentials"


def test_rate_limit_sixth_failed_login_returns_429(auth_client: TestClient) -> None:
    """Enforce rate limit: 5 failed attempts allowed, 6th attempt returns HTTP 429."""
    headers = {"X-Requested-With": "XMLHttpRequest"}
    fake_time = 1000.0

    # Inject controllable clock into rate limiter
    login_rate_limiter.time_provider = lambda: fake_time
    login_rate_limiter.attempts.clear()

    # Attempts 1 to 5: 401
    for _ in range(5):
        resp = auth_client.post(
            "/auth/login",
            json={"username": "ratelimited_user", "password": "BadPassword!"},
            headers=headers,
        )
        assert resp.status_code == 401
        fake_time += 1.0

    # Attempt 6: 429
    resp6 = auth_client.post(
        "/auth/login",
        json={"username": "ratelimited_user", "password": "BadPassword!"},
        headers=headers,
    )
    assert resp6.status_code == 429
    assert resp6.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"

    # Advance clock past 5-minute window (300s): should allow attempt again
    fake_time += 301.0
    resp_after = auth_client.post(
        "/auth/login",
        json={"username": "ratelimited_user", "password": "BadPassword!"},
        headers=headers,
    )
    assert resp_after.status_code == 401


def test_successful_login_and_logout_flow(auth_client: TestClient) -> None:
    """Full login -> /auth/me -> logout flow with cookie inspection."""
    headers = {"X-Requested-With": "XMLHttpRequest"}

    # 1. Login
    login_resp = auth_client.post(
        "/auth/login",
        json={"username": "admin", "password": DEMO_ADMIN_PASS},
        headers=headers,
    )
    assert login_resp.status_code == 200
    assert login_resp.json()["status"] == "ok"
    assert login_resp.json()["user"]["username"] == "admin"
    assert COOKIE_NAME in login_resp.cookies

    # 2. Inspect session via /auth/me
    me_resp = auth_client.get("/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["user"]["username"] == "admin"
    assert me_resp.json()["user"]["role"] == "admin"

    # 3. Logout
    logout_resp = auth_client.post("/auth/logout", headers=headers)
    assert logout_resp.status_code == 200
    assert logout_resp.json()["status"] == "ok"

    # 4. Subsequent /auth/me request fails with 401
    me_after = auth_client.get("/auth/me")
    assert me_after.status_code == 401


def test_viewer_on_admin_route_returns_403_and_admin_returns_200(auth_client: TestClient) -> None:
    """Role enforcement: viewer gets 403 on admin-only route, admin gets 200."""
    headers = {"X-Requested-With": "XMLHttpRequest"}

    # Login as viewer
    auth_client.post(
        "/auth/login",
        json={"username": "viewer", "password": DEMO_VIEWER_PASS},
        headers=headers,
    )

    # Viewer can access viewer-write route
    resp_viewer_ok = auth_client.post("/test/viewer-write", headers=headers)
    assert resp_viewer_ok.status_code == 200

    # Viewer denied on admin route
    resp_viewer_denied = auth_client.post("/test/admin-write", headers=headers)
    assert resp_viewer_denied.status_code == 403
    assert resp_viewer_denied.json()["error"]["code"] == "FORBIDDEN"

    # Login as admin
    auth_client.post(
        "/auth/login",
        json={"username": "admin", "password": DEMO_ADMIN_PASS},
        headers=headers,
    )

    # Admin allowed on admin route
    resp_admin_ok = auth_client.post("/test/admin-write", headers=headers)
    assert resp_admin_ok.status_code == 200
    assert resp_admin_ok.json()["admin"] == "admin"


def test_tampered_cookie_returns_401(auth_client: TestClient) -> None:
    """Tampered or invalid session cookie must be rejected with HTTP 401."""
    headers = {"X-Requested-With": "XMLHttpRequest"}
    auth_client.post(
        "/auth/login",
        json={"username": "admin", "password": DEMO_ADMIN_PASS},
        headers=headers,
    )

    valid_cookie = auth_client.cookies.get(COOKIE_NAME)
    assert valid_cookie is not None

    # Tamper with the cookie signature
    auth_client.cookies.set(COOKIE_NAME, valid_cookie + "corrupted")
    response = auth_client.get("/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_password_exceeding_128_chars_returns_422(auth_client: TestClient) -> None:
    """Payloads exceeding maximum schema constraints must return HTTP 422."""
    headers = {"X-Requested-With": "XMLHttpRequest"}
    long_password = "A" * 129
    response = auth_client.post(
        "/auth/login",
        json={"username": "admin", "password": long_password},
        headers=headers,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_current_user_reloads_role_from_db_on_every_request(auth_client: TestClient) -> None:
    """Session verification reloads role from DB so role demotion takes immediate effect."""
    headers = {"X-Requested-With": "XMLHttpRequest"}
    auth_client.post(
        "/auth/login",
        json={"username": "admin", "password": DEMO_ADMIN_PASS},
        headers=headers,
    )

    # Admin initially has access
    resp1 = auth_client.post("/test/admin-write", headers=headers)
    assert resp1.status_code == 200

    # Demote admin in database to viewer
    with get_db() as conn:
        conn.execute("UPDATE accounts SET role = 'viewer' WHERE username = 'admin';")

    # Immediate rejection on next request without modifying the cookie
    resp2 = auth_client.post("/test/admin-write", headers=headers)
    assert resp2.status_code == 403


def test_logs_clean_no_passwords_or_cookies_logged(
    auth_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """Verify that credentials, passwords, and cookie values are never written to logs."""
    headers = {"X-Requested-With": "XMLHttpRequest"}
    caplog.set_level(logging.DEBUG)

    login_resp = auth_client.post(
        "/auth/login",
        json={"username": "admin", "password": DEMO_ADMIN_PASS},
        headers=headers,
    )
    assert login_resp.status_code == 200
    cookie_value = login_resp.cookies.get(COOKIE_NAME)

    # Assert neither plain password nor session cookie token appears in any captured log message
    log_text = caplog.text
    assert DEMO_ADMIN_PASS not in log_text
    if cookie_value:
        assert cookie_value not in log_text
