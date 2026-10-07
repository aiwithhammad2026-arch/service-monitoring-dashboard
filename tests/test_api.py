"""Comprehensive tests for REST API endpoints, validation, security, and CSV export."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.db import get_db
from backend.simulator import tick

DEMO_ADMIN_PASS = "Admin#2026!"
DEMO_VIEWER_PASS = "Viewer#2026!"
CSRF_HEADERS = {"X-Requested-With": "XMLHttpRequest"}
DEFAULT_TH = {"max_error_pct": 5.0, "max_p95_ms": 800.0, "stale_after_s": 180}


def login_client(client: TestClient, username: str, password: str) -> None:
    """Helper to authenticate and store session cookie in TestClient."""
    resp = client.post(
        "/auth/login",
        json={"username": username, "password": password},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 200, f"Login failed for {username}: {resp.text}"


PROTECTED_ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "/auth/me", None),
    ("GET", "/metrics/overview", None),
    ("GET", "/metrics/history", None),
    ("GET", "/services", None),
    ("GET", "/services/auth", None),
    ("PUT", "/services/auth/thresholds", DEFAULT_TH),
    ("POST", "/sim/auth/mode", {"mode": "normal"}),
    ("POST", "/sim/auth/pause", {"paused": True}),
    ("POST", "/sim/auth/reporting", {"reporting_paused": True}),
    ("GET", "/incidents", None),
    ("GET", "/incidents/1", None),
    ("POST", "/incidents/1/ack", None),
    ("POST", "/incidents/1/resolve", None),
    ("GET", "/audit", None),
    ("GET", "/export/metrics.csv", None),
    ("GET", "/export/incidents.csv", None),
]


@pytest.mark.parametrize("method,path,payload", PROTECTED_ROUTES)
def test_no_cookie_returns_401_on_every_protected_route(
    client: TestClient, method: str, path: str, payload: dict[str, Any] | None
) -> None:
    """Unauthenticated requests without session cookie must return HTTP 401 UNAUTHORIZED."""
    if method == "GET":
        resp = client.get(path)
    elif method == "PUT":
        resp = client.put(path, json=payload, headers=CSRF_HEADERS)
    elif method == "POST":
        resp = client.post(path, json=payload, headers=CSRF_HEADERS)
    else:
        pytest.fail(f"Unsupported method: {method}")

    assert resp.status_code == 401
    data = resp.json()
    assert data["error"]["code"] == "UNAUTHORIZED"


WRITE_ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("PUT", "/services/auth/thresholds", DEFAULT_TH),
    ("POST", "/sim/auth/mode", {"mode": "slow"}),
    ("POST", "/sim/auth/pause", {"paused": False}),
    ("POST", "/sim/auth/reporting", {"reporting_paused": False}),
    ("POST", "/incidents/999/ack", None),
    ("POST", "/incidents/999/resolve", None),
]


@pytest.mark.parametrize("method,path,payload", WRITE_ROUTES)
def test_viewer_gets_403_on_every_write_route(
    client: TestClient, method: str, path: str, payload: dict[str, Any] | None
) -> None:
    """Viewer role must receive HTTP 403 FORBIDDEN on all mutation endpoints."""
    login_client(client, "viewer", DEMO_VIEWER_PASS)

    if method == "PUT":
        resp = client.put(path, json=payload, headers=CSRF_HEADERS)
    elif method == "POST":
        resp = client.post(path, json=payload, headers=CSRF_HEADERS)
    else:
        pytest.fail(f"Unsupported method: {method}")

    assert resp.status_code == 403
    data = resp.json()
    assert data["error"]["code"] == "FORBIDDEN"


def test_viewer_gets_403_on_audit_endpoint(client: TestClient) -> None:
    """GET /audit is strictly admin-only; viewer must receive HTTP 403 FORBIDDEN."""
    login_client(client, "viewer", DEMO_VIEWER_PASS)
    resp = client.get("/audit")
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "FORBIDDEN"


def test_admin_gets_200_on_write_routes(client: TestClient) -> None:
    """Admin role must successfully execute all mutation endpoints."""
    # Seed an open incident to test ack and resolve
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO incidents (
                service_id, type, status, summary, opened_at, created_at, updated_at
            ) VALUES (
                'auth', 'latency', 'open', 'p95 breach',
                '2026-10-07T12:00:00Z', '2026-10-07T12:00:00Z', '2026-10-07T12:00:00Z'
            );
            """
        )
        incident_id = cursor.lastrowid

    login_client(client, "admin", DEMO_ADMIN_PASS)

    # 1. PUT thresholds
    resp = client.put(
        "/services/auth/thresholds",
        json={"max_error_pct": 7.5, "max_p95_ms": 950.0, "stale_after_s": 240},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 200

    # 2. POST sim mode
    resp = client.post("/sim/auth/mode", json={"mode": "slow"}, headers=CSRF_HEADERS)
    assert resp.status_code == 200

    # 3. POST sim pause
    resp = client.post("/sim/auth/pause", json={"paused": True}, headers=CSRF_HEADERS)
    assert resp.status_code == 200

    # 4. POST sim reporting
    resp = client.post("/sim/auth/reporting", json={"reporting_paused": True}, headers=CSRF_HEADERS)
    assert resp.status_code == 200

    # 5. POST incident ack
    resp = client.post(f"/incidents/{incident_id}/ack", headers=CSRF_HEADERS)
    assert resp.status_code == 200

    # 6. POST incident resolve
    resp = client.post(f"/incidents/{incident_id}/resolve", headers=CSRF_HEADERS)
    assert resp.status_code == 200

    # 7. GET /audit
    resp = client.get("/audit")
    assert resp.status_code == 200


def test_missing_csrf_header_returns_403(client: TestClient) -> None:
    """Mutation endpoints without X-Requested-With header return HTTP 403 CSRF_FAILED."""
    login_client(client, "admin", DEMO_ADMIN_PASS)
    resp = client.put(
        "/services/auth/thresholds",
        json={"max_error_pct": 5.0, "max_p95_ms": 800.0, "stale_after_s": 180},
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "CSRF_FAILED"


@pytest.mark.parametrize(
    "payload",
    [
        {"max_error_pct": 150.0, "max_p95_ms": 800.0, "stale_after_s": 180},
        {"max_error_pct": -5.0, "max_p95_ms": 800.0, "stale_after_s": 180},
        {"max_error_pct": 5.0, "max_p95_ms": 0.0, "stale_after_s": 180},
        {"max_error_pct": 5.0, "max_p95_ms": 800.0, "stale_after_s": 10},
    ],
)
def test_out_of_range_thresholds_return_422(client: TestClient, payload: dict[str, Any]) -> None:
    """Threshold values outside allowed boundaries return HTTP 422 VALIDATION_ERROR."""
    login_client(client, "admin", DEMO_ADMIN_PASS)
    resp = client.put(
        "/services/auth/thresholds",
        json=payload,
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_valid_threshold_update_persists_and_audits(client: TestClient) -> None:
    """Valid threshold updates update DB, reflect in service details, and record audit log."""
    login_client(client, "admin", DEMO_ADMIN_PASS)
    new_th = {"max_error_pct": 8.5, "max_p95_ms": 1100.0, "stale_after_s": 250}

    resp = client.put("/services/auth/thresholds", json=new_th, headers=CSRF_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["thresholds"] == new_th

    # Inspect GET /services/{id}
    detail_resp = client.get("/services/auth")
    assert detail_resp.status_code == 200
    assert detail_resp.json()["thresholds"] == new_th

    # Inspect audit log in DB
    with get_db() as conn:
        audit_row = conn.execute(
            """
            SELECT actor, action, target_type, target_id, details
            FROM audit_log
            WHERE action = 'threshold_update' AND target_id = 'auth'
            ORDER BY id DESC LIMIT 1;
            """
        ).fetchone()
        assert audit_row is not None
        assert audit_row["actor"] == "admin"
        assert audit_row["target_type"] == "service"


@pytest.mark.parametrize(
    "query_path",
    [
        "/metrics/overview?range=99d",
        "/metrics/overview?product=invalid_prod",
        "/metrics/history?range=invalid_range",
        "/services?status=invalid_status",
        "/services?product=invalid_product",
        "/incidents?status=invalid_status",
        "/export/metrics.csv?range=10m",
        "/export/incidents.csv?status=broken",
    ],
)
def test_allow_list_violations_return_422(client: TestClient, query_path: str) -> None:
    """Violations of query parameter allow-lists must return HTTP 422 VALIDATION_ERROR."""
    login_client(client, "viewer", DEMO_VIEWER_PASS)
    resp = client.get(query_path)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_invalid_sim_mode_returns_422(client: TestClient) -> None:
    """Invalid simulator mode return HTTP 422 VALIDATION_ERROR."""
    login_client(client, "admin", DEMO_ADMIN_PASS)
    resp = client.post(
        "/sim/auth/mode",
        json={"mode": "turbo"},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_unknown_service_returns_404(client: TestClient) -> None:
    """Requests targeting nonexistent service IDs return HTTP 404 NOT_FOUND."""
    login_client(client, "admin", DEMO_ADMIN_PASS)
    resp = client.get("/services/nonexistent-service")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"

    resp = client.put(
        "/services/nonexistent-service/thresholds",
        json={"max_error_pct": 5.0, "max_p95_ms": 800.0, "stale_after_s": 180},
        headers=CSRF_HEADERS,
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_pagination_and_clamping(client: TestClient) -> None:
    """Page bounds, totals, and page_size capping at 100."""
    login_client(client, "viewer", DEMO_VIEWER_PASS)

    # 1. page_size=1000 clamped to 100
    resp = client.get("/services?page_size=1000")
    assert resp.status_code == 200
    data = resp.json()
    assert data["page_size"] == 100

    # 2. page=1, page_size=3
    resp = client.get("/services?page=1&page_size=3")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 3
    assert data["total"] == 10
    assert data["pages"] == 4

    # 3. page beyond the end (page=10, page_size=5)
    resp = client.get("/services?page=10&page_size=5")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 0
    assert data["total"] == 10

    # 4. page < 1 returns 422
    resp = client.get("/services?page=0")
    assert resp.status_code == 422


def test_search_special_characters_sql_safety(client: TestClient) -> None:
    """Search with %, ', ;, does not fail and does not return entire catalog."""
    login_client(client, "viewer", DEMO_VIEWER_PASS)

    # Searching literal '%' should match 0 services (no services have '%' in name)
    resp = client.get("/services?q=%")
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 0

    # Searching SQL injection string
    resp = client.get("/services?q='; DROP TABLE services; --")
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 0

    # Valid search
    resp = client.get("/services?q=auth")
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 1
    assert resp.json()["items"][0]["id"] == "auth"


def test_csv_export_formula_injection_defense(client: TestClient) -> None:
    """CSV export prefixes dangerous leading formula chars with single quote."""
    # Seed an incident with leading formula characters in summary
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO incidents (
                service_id, type, status, summary, opened_at, created_at, updated_at
            ) VALUES (
                'auth', 'error_rate', 'open', '=cmd|'' /C calc''!A0',
                '2026-10-07T12:00:00Z', '2026-10-07T12:00:00Z', '2026-10-07T12:00:00Z'
            );
            """
        )

    login_client(client, "viewer", DEMO_VIEWER_PASS)
    resp = client.get("/export/incidents.csv")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert resp.headers["content-disposition"] == 'attachment; filename="incidents.csv"'

    content = resp.text
    # Cell starting with '=' must be escaped with "'"
    assert "'=cmd|' /C calc'!A0" in content


def test_incident_conflict_handling(client: TestClient) -> None:
    """Ack twice returns 409; resolve then ack returns 409."""
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO incidents (
                service_id, type, status, summary, opened_at, created_at, updated_at
            ) VALUES (
                'payments', 'error_rate', 'open', 'Rate breach',
                '2026-10-07T12:00:00Z', '2026-10-07T12:00:00Z', '2026-10-07T12:00:00Z'
            );
            """
        )
        incident_id = cursor.lastrowid

    login_client(client, "admin", DEMO_ADMIN_PASS)

    # 1. Ack once -> 200
    resp = client.post(f"/incidents/{incident_id}/ack", headers=CSRF_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["incident"]["status"] == "acknowledged"

    # 2. Ack twice -> 409 CONFLICT
    resp = client.post(f"/incidents/{incident_id}/ack", headers=CSRF_HEADERS)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CONFLICT"

    # 3. Resolve -> 200
    resp = client.post(f"/incidents/{incident_id}/resolve", headers=CSRF_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["incident"]["status"] == "resolved"

    # 4. Resolve again -> 409 CONFLICT
    resp = client.post(f"/incidents/{incident_id}/resolve", headers=CSRF_HEADERS)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CONFLICT"

    # 5. Ack after resolve -> 409 CONFLICT
    resp = client.post(f"/incidents/{incident_id}/ack", headers=CSRF_HEADERS)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CONFLICT"


def test_sim_controls_persist_and_affect_subsequent_tick(client: TestClient) -> None:
    """Simulator mode and pause toggles persist in sim_state and govern next tick."""
    login_client(client, "admin", DEMO_ADMIN_PASS)

    # 1. Set mode to failing
    resp = client.post("/sim/web-frontend/mode", json={"mode": "failing"}, headers=CSRF_HEADERS)
    assert resp.status_code == 200

    now_dt = datetime.now(UTC).replace(second=0, microsecond=0) + timedelta(minutes=5)
    with get_db() as conn:
        tick(conn, now=now_dt, seed=123)
        row = conn.execute(
            """
            SELECT requests, errors FROM metric_buckets
            WHERE service_id = 'web-frontend' AND bucket_start = ?;
            """,
            (now_dt.isoformat(),),
        ).fetchone()
        assert row is not None
        assert row["requests"] > 0
        error_rate = row["errors"] / row["requests"]
        assert 0.35 <= error_rate <= 0.45

    # 2. Set paused
    resp = client.post("/sim/web-frontend/pause", json={"paused": True}, headers=CSRF_HEADERS)
    assert resp.status_code == 200

    now_dt2 = now_dt + timedelta(minutes=1)
    with get_db() as conn:
        tick(conn, now=now_dt2, seed=123)
        row = conn.execute(
            """
            SELECT requests, errors FROM metric_buckets
            WHERE service_id = 'web-frontend' AND bucket_start = ?;
            """,
            (now_dt2.isoformat(),),
        ).fetchone()
        assert row is not None
        assert row["requests"] == 0
        assert row["errors"] == 0

    # 3. Set reporting_paused
    resp = client.post(
        "/sim/web-frontend/reporting", json={"reporting_paused": True}, headers=CSRF_HEADERS
    )
    assert resp.status_code == 200

    now_dt3 = now_dt2 + timedelta(minutes=1)
    with get_db() as conn:
        tick(conn, now=now_dt3, seed=123)
        row = conn.execute(
            """
            SELECT requests FROM metric_buckets
            WHERE service_id = 'web-frontend' AND bucket_start = ?;
            """,
            (now_dt3.isoformat(),),
        ).fetchone()
        # No bucket written when reporting_paused
        assert row is None


def test_zero_traffic_range_returns_nulls_in_overview(client: TestClient) -> None:
    """Zero-traffic time range returns nulls for percentages and latency, never 0% or 100%."""
    # Wipe telemetry buckets to simulate zero-traffic state
    with get_db() as conn:
        conn.execute("DELETE FROM metric_buckets;")

    login_client(client, "viewer", DEMO_VIEWER_PASS)
    resp = client.get("/metrics/overview?range=1h")
    assert resp.status_code == 200
    data = resp.json()

    assert data["requests"] == 0
    assert data["errors"] == 0
    assert data["rpm"] == 0.0
    assert data["success_pct"] is None
    assert data["error_pct"] is None
    assert data["avg_latency"] is None
    assert data["p50"] is None
    assert data["p95"] is None


def test_metrics_endpoints_with_filters(client: TestClient) -> None:
    """Test metrics overview and history endpoints with product and service filtering."""
    login_client(client, "viewer", DEMO_VIEWER_PASS)

    # Overview with product filter
    resp = client.get("/metrics/overview?range=1h&product=website")
    assert resp.status_code == 200
    assert resp.json()["product_filter"] == "website"

    # History with service filter
    resp = client.get("/metrics/history?range=1h&service_id=auth")
    assert resp.status_code == 200
    assert resp.json()["service_id"] == "auth"
    assert len(resp.json()["points"]) == 60

    # History with non-existent service ID
    resp = client.get("/metrics/history?range=1h&service_id=nonexistent")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_incidents_detail_and_filtering(client: TestClient) -> None:
    """Test incident filtering, timeline inspection, and 404 handling."""
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO incidents (
                service_id, type, status, summary, opened_at, created_at, updated_at
            ) VALUES (
                'catalog', 'error_rate', 'open', 'Catalog 500 spike',
                '2026-10-07T12:00:00Z', '2026-10-07T12:00:00Z', '2026-10-07T12:00:00Z'
            );
            """
        )
        inc_id = cursor.lastrowid
        conn.execute(
            """
            INSERT INTO incident_events (
                incident_id, event_type, from_status, to_status, actor, message, created_at
            ) VALUES (
                ?, 'opened', NULL, 'open', 'system', 'Breach triggered', '2026-10-07T12:00:00Z'
            );
            """,
            (inc_id,),
        )

    login_client(client, "viewer", DEMO_VIEWER_PASS)

    # Filter incidents by status
    resp = client.get("/incidents?status=open")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert any(item["id"] == inc_id for item in items)

    # Detail with timeline
    detail_resp = client.get(f"/incidents/{inc_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["incident"]["id"] == inc_id
    assert len(detail["timeline"]) >= 1

    # Nonexistent incident
    not_found_resp = client.get("/incidents/99999")
    assert not_found_resp.status_code == 404
    assert not_found_resp.json()["error"]["code"] == "NOT_FOUND"


def test_csv_exports_with_filters(client: TestClient) -> None:
    """Test CSV export endpoints with product and status filters."""
    login_client(client, "viewer", DEMO_VIEWER_PASS)

    # Metrics CSV with product filter
    resp = client.get("/export/metrics.csv?range=1h&product=website")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert "service_id" in resp.text

    # Incidents CSV with status filter
    resp = client.get("/export/incidents.csv?status=open")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert "summary" in resp.text


def test_services_list_filtering(client: TestClient) -> None:
    """Test filtering services by status and product."""
    login_client(client, "viewer", DEMO_VIEWER_PASS)

    resp = client.get("/services?status=green")
    assert resp.status_code == 200
    for s in resp.json()["items"]:
        assert s["status"] == "green"

    resp = client.get("/services?product=website")
    assert resp.status_code == 200
    for s in resp.json()["items"]:
        assert s["product"] == "website"
