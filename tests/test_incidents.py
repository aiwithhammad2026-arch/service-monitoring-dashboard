"""Tests for the incident engine, state machine, deduplication, and audit logging (Task 06).

All tests use a fake clock, temp DB, and direct tick() calls. No wall-clock sleep.
Status and event strings are asserted with exact documented values.
"""

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.audit import redact_data
from backend.audit import write as audit_write
from backend.config import settings
from backend.errors import ConflictError, NotFoundError
from backend.incidents import (
    acknowledge_incident,
    add_incident_note,
    evaluate,
    get_active_incident,
    get_incident,
    resolve_incident,
)
from backend.seed import seed
from backend.simulator import tick, tick_and_evaluate

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def inc_db(tmp_path: Path):
    """Open, seeded SQLite connection with WAL + FK enabled."""
    db_file = tmp_path / "inc_test.db"
    orig_db = settings.db_path
    orig_rounds = settings.bcrypt_rounds
    settings.db_path = db_file
    settings.bcrypt_rounds = 4
    seed(db_file)
    conn = sqlite3.connect(str(db_file))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    yield conn
    conn.close()
    settings.db_path = orig_db
    settings.bcrypt_rounds = orig_rounds


@pytest.fixture()
def fixed_now() -> datetime:
    """Stable UTC datetime anchor for deterministic incident tests."""
    return datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC)


def _first_svc(conn: sqlite3.Connection) -> str:
    return conn.execute("SELECT service_id FROM sim_state LIMIT 1").fetchone()["service_id"]


def _set_service_mode(
    conn: sqlite3.Connection,
    svc_id: str,
    mode: str,
    mode_since: datetime,
    paused: int = 0,
    reporting_paused: int = 0,
) -> None:
    conn.execute(
        """
        UPDATE sim_state
        SET mode = ?, paused = ?, reporting_paused = ?, mode_since = ?, updated_at = ?
        WHERE service_id = ?;
        """,
        (mode, paused, reporting_paused, mode_since.isoformat(), mode_since.isoformat(), svc_id),
    )
    conn.commit()


# ===========================================================================
# 1. DEDUPLICATION: 10 ticks in failing mode produce exactly 1 incident & event
# ===========================================================================


def test_failing_mode_deduplication_single_incident(inc_db, fixed_now):
    """10 ticks of failing mode over multiple minutes and sub-minute ticks -> 1 incident."""
    svc_id = _first_svc(inc_db)
    inc_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    inc_db.commit()

    _set_service_mode(inc_db, svc_id, "failing", mode_since=fixed_now)

    # 10 ticks: 2 ticks per minute for 5 minutes
    for minute in range(5):
        for sub_tick in (0, 30):
            t = fixed_now + timedelta(minutes=minute, seconds=sub_tick)
            tick(inc_db, now=t, seed=42)
            inc_db.commit()
            evaluate(inc_db, now=t)
            inc_db.commit()

    incidents = inc_db.execute(
        "SELECT * FROM incidents WHERE service_id=? AND type='error_rate'",
        (svc_id,),
    ).fetchall()
    assert len(incidents) == 1, f"Expected exactly 1 incident row, got {len(incidents)}"

    inc = incidents[0]
    assert inc["status"] == "open"
    assert inc["type"] == "error_rate"
    assert inc["healthy_streak"] == 0

    events = inc_db.execute(
        "SELECT * FROM incident_events WHERE incident_id=? ORDER BY id",
        (inc["id"],),
    ).fetchall()
    assert len(events) == 1, f"Expected exactly 1 timeline event, got {len(events)}"
    assert events[0]["event_type"] == "opened"
    assert events[0]["from_status"] is None
    assert events[0]["to_status"] == "open"
    assert events[0]["actor"] == "system"


# ===========================================================================
# 2. INTEGRITY ERROR SAFETY NET (Partial Unique Index)
# ===========================================================================


def test_integrity_error_safety_net_does_not_crash(inc_db, fixed_now):
    """If pre-check is bypassed (returns None), partial unique index catches it safely."""
    svc_id = _first_svc(inc_db)
    inc_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    inc_db.commit()

    _set_service_mode(inc_db, svc_id, "failing", mode_since=fixed_now)

    # First tick creates the open incident
    tick(inc_db, now=fixed_now, seed=42)
    inc_db.commit()
    evaluate(inc_db, now=fixed_now)
    inc_db.commit()

    # Verify incident exists
    active = get_active_incident(inc_db, svc_id, "error_rate")
    assert active is not None
    assert active["status"] == "open"

    # Second tick: monkeypatch get_active_incident to return None once to force INSERT attempt
    real_get_active = get_active_incident
    bypassed = False

    def fake_get_active(conn, sid, itype):
        nonlocal bypassed
        if sid == svc_id and itype == "error_rate" and not bypassed:
            bypassed = True
            return None
        return real_get_active(conn, sid, itype)

    with patch("backend.incidents.get_active_incident", side_effect=fake_get_active):
        t2 = fixed_now + timedelta(minutes=1)
        tick(inc_db, now=t2, seed=42)
        inc_db.commit()
        # evaluate() must catch sqlite3.IntegrityError and continue cleanly
        evaluate(inc_db, now=t2)
        inc_db.commit()

    # Still exactly 1 incident row in the DB
    count = inc_db.execute(
        "SELECT COUNT(*) as c FROM incidents WHERE service_id=? AND type='error_rate'",
        (svc_id,),
    ).fetchone()["c"]
    assert count == 1, f"Partial unique index must prevent duplicate, got count={count}"


# ===========================================================================
# 3. FULL LIFECYCLE: open -> ack -> recovered (3 new buckets) -> resolved
# ===========================================================================


def test_full_incident_lifecycle(inc_db, fixed_now):
    """Full lifecycle: open -> ack -> 3 new healthy buckets -> recovered -> resolved."""
    svc_id = _first_svc(inc_db)
    inc_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    inc_db.commit()

    base_t = fixed_now

    # 1. Failing ticks -> Incident opens
    _set_service_mode(inc_db, svc_id, "failing", mode_since=base_t)
    for minute in range(3):
        t = base_t + timedelta(minutes=minute)
        tick_and_evaluate(inc_db, now=t, seed=42)
        inc_db.commit()

    inc = get_active_incident(inc_db, svc_id, "error_rate")
    assert inc is not None
    assert inc["status"] == "open"
    inc_id = inc["id"]

    # 2. Admin acknowledges the incident
    ack_res = acknowledge_incident(inc_db, inc_id, actor="admin_alice", ip="127.0.0.1")
    inc_db.commit()
    assert ack_res["status"] == "acknowledged"

    # 3. Switch service to normal mode (healthy)
    norm_start = base_t + timedelta(minutes=3)
    _set_service_mode(inc_db, svc_id, "normal", mode_since=norm_start)

    # 3a. Tick twice at minute 3 (same minute bucket): streak should be 1, NOT 2
    t3 = base_t + timedelta(minutes=3)
    tick_and_evaluate(inc_db, now=t3, seed=42)
    inc_db.commit()
    t3_sub = base_t + timedelta(minutes=3, seconds=30)
    tick_and_evaluate(inc_db, now=t3_sub, seed=42)
    inc_db.commit()

    inc = get_incident(inc_db, inc_id)
    assert inc["status"] == "acknowledged", "Should still be acknowledged inside minute 3"
    assert inc["healthy_streak"] == 1, (
        f"Streak must count new bucket once, got {inc['healthy_streak']}"
    )

    # 3b. Advance to minute 4 (2nd new bucket)
    t4 = base_t + timedelta(minutes=4)
    tick_and_evaluate(inc_db, now=t4, seed=42)
    inc_db.commit()

    inc = get_incident(inc_db, inc_id)
    assert inc["status"] == "acknowledged"
    assert inc["healthy_streak"] == 2

    # 3c. Advance to minute 5 (3rd new bucket) -> auto-recovers!
    t5 = base_t + timedelta(minutes=5)
    tick_and_evaluate(inc_db, now=t5, seed=42)
    inc_db.commit()

    inc = get_incident(inc_db, inc_id)
    assert inc["status"] == "recovered"
    assert inc["recovered_at"] is not None

    # 4. Admin resolves the incident
    res_res = resolve_incident(inc_db, inc_id, actor="admin_bob", ip="127.0.0.1")
    inc_db.commit()
    assert res_res["status"] == "resolved"
    assert res_res["resolved_at"] is not None

    # 5. Verify complete timeline sequence
    events = inc_db.execute(
        "SELECT event_type, from_status, to_status, actor "
        "FROM incident_events WHERE incident_id=? ORDER BY id",
        (inc_id,),
    ).fetchall()

    assert len(events) == 4
    assert events[0]["event_type"] == "opened"
    assert events[0]["to_status"] == "open"
    assert events[0]["actor"] == "system"

    assert events[1]["event_type"] == "acknowledged"
    assert events[1]["from_status"] == "open"
    assert events[1]["to_status"] == "acknowledged"
    assert events[1]["actor"] == "admin_alice"

    assert events[2]["event_type"] == "recovered"
    assert events[2]["from_status"] == "acknowledged"
    assert events[2]["to_status"] == "recovered"
    assert events[2]["actor"] == "system"

    assert events[3]["event_type"] == "resolved"
    assert events[3]["from_status"] == "recovered"
    assert events[3]["to_status"] == "resolved"
    assert events[3]["actor"] == "admin_bob"


# ===========================================================================
# 4. REOPEN: recovered incident breaches again -> reopened with same id
# ===========================================================================


def test_recovered_incident_reopens_on_new_breach(inc_db, fixed_now):
    """A recovered incident transitions back to open on a new breach without creating a new row."""
    svc_id = _first_svc(inc_db)
    inc_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    inc_db.commit()

    base_t = fixed_now

    # 1. Open incident in failing mode
    _set_service_mode(inc_db, svc_id, "failing", mode_since=base_t)
    tick_and_evaluate(inc_db, now=base_t, seed=42)
    inc_db.commit()

    inc = get_active_incident(inc_db, svc_id, "error_rate")
    assert inc is not None
    orig_inc_id = inc["id"]

    # 2. Transition to normal mode and tick 3 new buckets to reach recovered
    _set_service_mode(inc_db, svc_id, "normal", mode_since=base_t + timedelta(minutes=1))
    for m in (1, 2, 3):
        tick_and_evaluate(inc_db, now=base_t + timedelta(minutes=m), seed=42)
        inc_db.commit()

    inc = get_incident(inc_db, orig_inc_id)
    assert inc["status"] == "recovered"

    # 3. Breach again at minute 4 (failing mode)
    _set_service_mode(inc_db, svc_id, "failing", mode_since=base_t + timedelta(minutes=4))
    tick_and_evaluate(inc_db, now=base_t + timedelta(minutes=4), seed=42)
    inc_db.commit()

    # Verify same incident reopened
    inc_after = get_incident(inc_db, orig_inc_id)
    assert inc_after["status"] == "open"
    assert inc_after["healthy_streak"] == 0

    # Total rows in incidents table is still 1
    total_incidents = inc_db.execute(
        "SELECT COUNT(*) as c FROM incidents WHERE service_id=? AND type='error_rate'",
        (svc_id,),
    ).fetchone()["c"]
    assert total_incidents == 1

    # Verify timeline event 'reopened'
    last_event = inc_db.execute(
        "SELECT * FROM incident_events WHERE incident_id=? ORDER BY id DESC LIMIT 1",
        (orig_inc_id,),
    ).fetchone()
    assert last_event["event_type"] == "reopened"
    assert last_event["from_status"] == "recovered"
    assert last_event["to_status"] == "open"


# ===========================================================================
# 5. INVALID TRANSITIONS -> 409 ConflictError
# ===========================================================================


def test_invalid_transitions_raise_conflict_error(inc_db, fixed_now):
    """Invalid transitions raise ConflictError with HTTP 409 status code."""
    svc_id = _first_svc(inc_db)
    inc_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    inc_db.commit()

    _set_service_mode(inc_db, svc_id, "failing", mode_since=fixed_now)
    tick_and_evaluate(inc_db, now=fixed_now, seed=42)
    inc_db.commit()

    inc = get_active_incident(inc_db, svc_id, "error_rate")
    inc_id = inc["id"]

    # 1. Acknowledge -> OK
    acknowledge_incident(inc_db, inc_id, actor="admin")
    inc_db.commit()

    # 2. Acknowledge again on acknowledged -> ConflictError (409)
    with pytest.raises(ConflictError) as exc_ack:
        acknowledge_incident(inc_db, inc_id, actor="admin")
    assert exc_ack.value.status_code == 409
    assert exc_ack.value.code == "CONFLICT"

    # 3. Resolve -> OK
    resolve_incident(inc_db, inc_id, actor="admin")
    inc_db.commit()

    # 4. Resolve again on resolved -> ConflictError (409)
    with pytest.raises(ConflictError) as exc_res:
        resolve_incident(inc_db, inc_id, actor="admin")
    assert exc_res.value.status_code == 409
    assert exc_res.value.code == "CONFLICT"

    # 5. Acknowledge on resolved -> ConflictError (409)
    with pytest.raises(ConflictError) as exc_ack_res:
        acknowledge_incident(inc_db, inc_id, actor="admin")
    assert exc_ack_res.value.status_code == 409

    # 6. Action on non-existent incident -> NotFoundError (404)
    with pytest.raises(NotFoundError) as exc_nf:
        acknowledge_incident(inc_db, 99999, actor="admin")
    assert exc_nf.value.status_code == 404


# ===========================================================================
# 6. CONCURRENT INCIDENTS: error_rate and latency on same service
# ===========================================================================


def test_concurrent_different_incident_types_on_same_service(inc_db, fixed_now):
    """error_rate and latency incidents can be active simultaneously on the same service."""
    svc_id = _first_svc(inc_db)
    inc_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    inc_db.commit()

    now_str = fixed_now.isoformat()
    # Insert custom buckets that breach BOTH error_pct (>5%) and latency_p95 (>800ms)
    for m in range(3):
        t = (fixed_now + timedelta(minutes=m)).isoformat()
        # hist with counts in high bins (>800ms)
        high_hist = [0] * 12 + [50] * 6
        inc_db.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors,
                latency_p50, latency_p95, latency_hist, created_at
            ) VALUES (?, ?, 100, 40, 500.0, 950.0, ?, ?);
            """,
            (svc_id, t, json.dumps(high_hist), now_str),
        )
    inc_db.commit()

    evaluate(inc_db, now=fixed_now + timedelta(minutes=2))
    inc_db.commit()

    active_err = get_active_incident(inc_db, svc_id, "error_rate")
    active_lat = get_active_incident(inc_db, svc_id, "latency")

    assert active_err is not None, "error_rate incident must be opened"
    assert active_lat is not None, "latency incident must be opened"
    assert active_err["id"] != active_lat["id"], "Must be distinct incident rows"
    assert active_err["status"] == "open"
    assert active_lat["status"] == "open"


# ===========================================================================
# 7. STALE DATA INCIDENT LIFECYCLE
# ===========================================================================


def test_stale_data_incident_lifecycle(inc_db, fixed_now):
    """Reporting paused creates stale incident after stale_after_s; resumes -> recovers."""
    svc_id = _first_svc(inc_db)
    inc_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    inc_db.commit()

    # 1. Normal reporting initially
    _set_service_mode(inc_db, svc_id, "normal", mode_since=fixed_now)
    tick_and_evaluate(inc_db, now=fixed_now, seed=42)
    inc_db.commit()

    # No incident opened under normal mode
    assert get_active_incident(inc_db, svc_id, "stale") is None

    # 2. Service pauses reporting (no buckets written)
    _set_service_mode(inc_db, svc_id, "normal", mode_since=fixed_now, reporting_paused=1)

    # Tick at +60s (within stale threshold of 180s) -> no stale incident yet
    t_fresh = fixed_now + timedelta(seconds=60)
    tick_and_evaluate(inc_db, now=t_fresh, seed=42)
    inc_db.commit()
    assert get_active_incident(inc_db, svc_id, "stale") is None

    # Tick at +250s (> 180s threshold) -> Stale incident opens!
    t_stale = fixed_now + timedelta(seconds=250)
    tick_and_evaluate(inc_db, now=t_stale, seed=42)
    inc_db.commit()

    stale_inc = get_active_incident(inc_db, svc_id, "stale")
    assert stale_inc is not None, "Stale incident must open when data is aged > stale_after_s"
    assert stale_inc["status"] == "open"
    assert stale_inc["type"] == "stale"

    # 3. Resume reporting
    _set_service_mode(inc_db, svc_id, "normal", mode_since=t_stale, reporting_paused=0)

    # 3 new fresh buckets resume
    for m in (1, 2, 3):
        t_resume = t_stale + timedelta(minutes=m)
        tick_and_evaluate(inc_db, now=t_resume, seed=42)
        inc_db.commit()

    # Stale incident recovers after 3 fresh buckets
    stale_inc_after = get_incident(inc_db, stale_inc["id"])
    assert stale_inc_after["status"] == "recovered"


# ===========================================================================
# 8. RESTART SAFETY: State continues from DB with no duplicate
# ===========================================================================


def test_restart_resumes_incident_state_from_db(inc_db, fixed_now):
    """After closing connection and reopening, state continues seamlessly from DB."""
    svc_id = _first_svc(inc_db)
    inc_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    inc_db.commit()

    # Open incident and advance 1 healthy bucket
    _set_service_mode(inc_db, svc_id, "failing", mode_since=fixed_now)
    tick_and_evaluate(inc_db, now=fixed_now, seed=42)
    inc_db.commit()

    inc = get_active_incident(inc_db, svc_id, "error_rate")
    inc_id = inc["id"]

    # Switch to normal and tick 1 bucket
    t1 = fixed_now + timedelta(minutes=1)
    _set_service_mode(inc_db, svc_id, "normal", mode_since=t1)
    tick_and_evaluate(inc_db, now=t1, seed=42)
    inc_db.commit()

    inc_before = get_incident(inc_db, inc_id)
    assert inc_before["healthy_streak"] == 1

    # SIMULATE RESTART: close db connection, open brand new connection to same DB file
    inc_db.close()

    new_conn = sqlite3.connect(str(settings.db_path))
    new_conn.row_factory = sqlite3.Row
    new_conn.execute("PRAGMA journal_mode=WAL")
    new_conn.execute("PRAGMA foreign_keys=ON")

    # Tick 2nd healthy bucket on new connection
    t2 = fixed_now + timedelta(minutes=2)
    tick_and_evaluate(new_conn, now=t2, seed=42)
    new_conn.commit()

    inc_after_t2 = get_incident(new_conn, inc_id)
    assert inc_after_t2["healthy_streak"] == 2

    # Tick 3rd healthy bucket on new connection -> reaches recovered
    t3 = fixed_now + timedelta(minutes=3)
    tick_and_evaluate(new_conn, now=t3, seed=42)
    new_conn.commit()

    inc_after_t3 = get_incident(new_conn, inc_id)
    assert inc_after_t3["status"] == "recovered"

    # Verify no duplicate incident rows created across restart
    total = new_conn.execute(
        "SELECT COUNT(*) as c FROM incidents WHERE service_id=? AND type='error_rate'",
        (svc_id,),
    ).fetchone()["c"]
    assert total == 1
    new_conn.close()


# ===========================================================================
# 9. AUDIT LOGGING & NESTED REDACTION
# ===========================================================================


def test_audit_logging_and_nested_credential_redaction(inc_db):
    """Admin transitions write audit entries; secret keys in nested data are masked."""
    # 1. Direct unit test on recursive redaction
    raw_payload = {
        "user": "admin",
        "password": "SuperSecretPassword123!",
        "auth_token": "bearer-xyz",
        "nested": {
            "api_key": "raw-key",
            "session_cookie": "sess-abc",
            "safe_field": 42,
            "list_data": [
                {"secret_pass": "hidden1"},
                {"public_info": "visible"},
            ],
        },
    }

    cleaned = redact_data(raw_payload)
    assert cleaned["user"] == "admin"
    assert cleaned["password"] == "[REDACTED]"
    assert cleaned["auth_token"] == "[REDACTED]"
    assert cleaned["nested"]["session_cookie"] == "[REDACTED]"
    assert cleaned["nested"]["safe_field"] == 42
    assert cleaned["nested"]["list_data"][0]["secret_pass"] == "[REDACTED]"
    assert cleaned["nested"]["list_data"][1]["public_info"] == "visible"

    # 2. Test audit_write helper directly
    row_id = audit_write(
        inc_db,
        actor="admin",
        action="test_action",
        target_type="service",
        target_id="auth-api",
        old={"token": "old-secret"},
        new={"token": "new-secret", "status": "active"},
        ip="192.168.1.100",
    )
    inc_db.commit()
    assert row_id > 0

    audit_row = inc_db.execute("SELECT * FROM audit_log WHERE id=?", (row_id,)).fetchone()
    assert audit_row["actor"] == "admin"
    assert audit_row["action"] == "test_action"
    assert audit_row["target_type"] == "service"
    assert audit_row["target_id"] == "auth-api"

    details = json.loads(audit_row["details"])
    assert details["old"]["token"] == "[REDACTED]"
    assert details["new"]["token"] == "[REDACTED]"
    assert details["new"]["status"] == "active"
    assert details["ip"] == "192.168.1.100"


# ===========================================================================
# 10. PAUSED SERVICE (Zero Requests) DOES NOT OPEN INCIDENT
# ===========================================================================


def test_paused_service_does_not_open_incident(inc_db, fixed_now):
    """A paused service (zero requests within stale_after_s) does not open an incident."""
    svc_id = _first_svc(inc_db)
    inc_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    inc_db.commit()

    _set_service_mode(inc_db, svc_id, "normal", mode_since=fixed_now, paused=1)

    for m in range(3):
        t = fixed_now + timedelta(minutes=m)
        tick_and_evaluate(inc_db, now=t, seed=42)
        inc_db.commit()

    # No incidents of any type should be opened
    incidents = inc_db.execute(
        "SELECT * FROM incidents WHERE service_id=?", (svc_id,)
    ).fetchall()
    assert len(incidents) == 0, f"Paused service must not open incidents, got {len(incidents)}"


# ===========================================================================
# 11. TIMELINE NOTES: add_incident_note
# ===========================================================================


def test_add_incident_note(inc_db, fixed_now):
    """Adding a note records a timeline event and an audit entry."""
    svc_id = _first_svc(inc_db)
    _set_service_mode(inc_db, svc_id, "failing", mode_since=fixed_now)
    tick_and_evaluate(inc_db, now=fixed_now, seed=42)
    inc_db.commit()

    inc = get_active_incident(inc_db, svc_id, "error_rate")
    inc_id = inc["id"]

    res = add_incident_note(
        inc_db,
        incident_id=inc_id,
        actor="admin_carol",
        message="Investigating upstream database connection pool.",
        ip="10.0.0.1",
    )
    inc_db.commit()
    assert res["status"] == "ok"

    # Timeline event
    last_event = inc_db.execute(
        "SELECT * FROM incident_events WHERE incident_id=? ORDER BY id DESC LIMIT 1",
        (inc_id,),
    ).fetchone()
    assert last_event["event_type"] == "note"
    assert last_event["actor"] == "admin_carol"
    assert "Investigating upstream" in last_event["message"]

    # Audit log entry
    last_audit = inc_db.execute(
        "SELECT * FROM audit_log WHERE target_type='incident' AND target_id=? "
        "ORDER BY id DESC LIMIT 1",
        (str(inc_id),),
    ).fetchone()
    assert last_audit["action"] == "incident_note"
    assert last_audit["actor"] == "admin_carol"
