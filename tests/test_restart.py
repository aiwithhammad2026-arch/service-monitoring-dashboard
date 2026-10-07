"""Tests for server restart recovery.

Tests persistence of incidents, simulator state, and deduplication across app instances.
"""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from backend.config import settings
from backend.db import get_connection
from backend.incidents import get_active_incident
from backend.main import create_app
from backend.seed import seed
from backend.simulator import tick_and_evaluate

DEMO_ADMIN_PASS = "Admin#2026!"


def test_incident_and_sim_state_persist_across_app_restart(tmp_path: Path) -> None:
    """Opening an incident and restarting the FastAPI application preserves state and deduplication.

    Steps:
      1. Seed an isolated SQLite database file.
      2. Set service 'payments' to failing mode and run simulation ticks -> incident opens.
      3. Simulate full app restart: create a new FastAPI instance pointing to the same DB file.
      4. Verify API routes retrieve the persisted incident, event timeline, and sim state.
      5. Run subsequent simulation ticks on the restarted database -> verify no duplicate incidents.
    """
    db_file = tmp_path / "test_restart.db"
    orig_db = settings.db_path
    orig_rounds = settings.bcrypt_rounds

    settings.db_path = db_file
    settings.bcrypt_rounds = 4

    try:
        seed(db_file)

        t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)

        # 1. Trigger failure mode and run tick on the database
        with get_connection(db_file) as conn:
            conn.execute(
                """
                UPDATE sim_state
                SET mode = 'failing', mode_since = ?, updated_at = ?
                WHERE service_id = 'payments';
                """,
                (t0.isoformat(), t0.isoformat()),
            )
            # Tick 1: creates failing metric bucket and opens incident #1
            tick_and_evaluate(conn, now=t0, seed=42)

            active_inc = get_active_incident(conn, "payments", "error_rate")
            assert active_inc is not None
            assert active_inc["status"] == "open"
            incident_id = active_inc["id"]

        # 2. Simulate Server Restart: create a completely new FastAPI app instance on same DB
        restarted_app = create_app(use_lifespan=False)

        with TestClient(restarted_app) as client:
            # Login as admin on the restarted application instance
            login_resp = client.post(
                "/auth/login",
                json={"username": "admin", "password": DEMO_ADMIN_PASS},
                headers={"X-Requested-With": "XMLHttpRequest"},
            )
            assert login_resp.status_code == 200

            # Verify /incidents list retains the open incident across restart
            inc_list_resp = client.get("/incidents?status=open")
            assert inc_list_resp.status_code == 200
            inc_items = inc_list_resp.json()["items"]
            assert any(
                item["id"] == incident_id and item["service_id"] == "payments"
                for item in inc_items
            )

            # Verify /incidents/{id} retains full timeline and summary
            inc_detail_resp = client.get(f"/incidents/{incident_id}")
            assert inc_detail_resp.status_code == 200
            inc_detail = inc_detail_resp.json()
            assert inc_detail["incident"]["id"] == incident_id
            assert inc_detail["incident"]["status"] == "open"
            assert len(inc_detail["timeline"]) >= 1
            assert inc_detail["timeline"][0]["event_type"] == "opened"

            # Verify /services/payments retains simulator state ('failing')
            svc_resp = client.get("/services/payments")
            assert svc_resp.status_code == 200
            svc_data = svc_resp.json()
            assert svc_data["sim_state"]["mode"] == "failing"

        # 3. Subsequent simulation ticks on restarted DB must NOT create duplicate active incidents
        t1 = t0 + timedelta(minutes=1)
        t2 = t0 + timedelta(minutes=2)

        with get_connection(db_file) as conn:
            tick_and_evaluate(conn, now=t1, seed=42)
            tick_and_evaluate(conn, now=t2, seed=42)

            # Assert deduplication: still exactly 1 active incident
            active_after = get_active_incident(conn, "payments", "error_rate")
            assert active_after is not None
            assert active_after["id"] == incident_id

            # Verify total active incident rows in table for payments is exactly 1
            total_active = conn.execute(
                """
                SELECT COUNT(*) as c FROM incidents
                WHERE service_id = 'payments' AND status != 'resolved';
                """
            ).fetchone()["c"]
            assert total_active == 1

            # Verify opened timeline events is still exactly 1 (no duplicate 'opened' events)
            opened_events = conn.execute(
                "SELECT * FROM incident_events WHERE incident_id = ? AND event_type = 'opened';",
                (incident_id,),
            ).fetchall()
            assert len(opened_events) == 1

    finally:
        settings.db_path = orig_db
        settings.bcrypt_rounds = orig_rounds
