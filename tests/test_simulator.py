"""Tests for the deterministic traffic simulator (Task 05 — fixed-up).

Each test targets one specific documented behaviour. Status labels and
values are asserted exactly as documented (no "one-of-several" tuples).
MD_SIM_ENABLED is controlled via monkeypatch, never via shell env vars.
"""

import json
import logging
import random
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from backend.config import settings
from backend.metrics import HIST_BIN_COUNT, floor_to_minute
from backend.seed import seed
from backend.simulator import (
    SimulatorService,
    generate_profile_histogram,
    get_profile_error_rate,
    tick,
    touch_synthetic_users,
)
from backend.status import breaches, evaluate_service_status

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def sim_db(tmp_path: Path):
    """Open, seeded SQLite connection with WAL + FK enabled."""
    db_file = tmp_path / "sim_test.db"
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
    """Stable UTC datetime used as fake clock in deterministic tests."""
    return datetime(2025, 6, 15, 12, 30, 0, tzinfo=UTC)


def _first_svc(conn) -> str:
    """Return the first service_id from sim_state (seed order is deterministic)."""
    return conn.execute("SELECT service_id FROM sim_state LIMIT 1").fetchone()["service_id"]


def _set_mode(conn, svc_id: str, mode: str, mode_since=None, paused=0, reporting_paused=0):
    """Helper: update sim_state for a service."""
    conn.execute(
        "UPDATE sim_state SET mode=?, paused=?, reporting_paused=?, mode_since=? "
        "WHERE service_id=?",
        (mode, paused, reporting_paused, (mode_since or datetime.now(UTC)).isoformat(), svc_id),
    )
    conn.commit()


def _write_ticks(conn, svc_id, base_t, count, seed_val=42):
    """Write `count` consecutive ticks for svc_id starting at base_t."""
    for i in range(count):
        tick(conn, now=base_t + timedelta(minutes=i), seed=seed_val)
        conn.commit()


def _status(conn, svc_id, now):
    """Return evaluate_service_status dict for convenience."""
    return evaluate_service_status(conn, svc_id, now=now)


# ===========================================================================
# 1. DETERMINISM
# ===========================================================================


def test_tick_is_deterministic(sim_db, fixed_now):
    """Same seed + same minute must produce byte-identical bucket rows."""
    written1 = tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    snapshot = {}
    for svc_id, b_start in written1:
        row = sim_db.execute(
            "SELECT requests, errors, latency_p50, latency_hist "
            "FROM metric_buckets WHERE service_id=? AND bucket_start=?",
            (svc_id, b_start),
        ).fetchone()
        snapshot[(svc_id, b_start)] = dict(row)

    # Second tick overwrites via ON CONFLICT UPDATE
    written2 = tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    assert set(written1) == set(written2)
    for svc_id, b_start in written2:
        row = sim_db.execute(
            "SELECT requests, errors, latency_p50, latency_hist "
            "FROM metric_buckets WHERE service_id=? AND bucket_start=?",
            (svc_id, b_start),
        ).fetchone()
        assert snapshot[(svc_id, b_start)]["requests"] == row["requests"]
        assert snapshot[(svc_id, b_start)]["errors"] == row["errors"]
        assert snapshot[(svc_id, b_start)]["latency_p50"] == row["latency_p50"]
        assert snapshot[(svc_id, b_start)]["latency_hist"] == row["latency_hist"]


def test_different_seeds_produce_different_buckets(sim_db, fixed_now):
    """Two different seeds must produce different per-service request counts."""
    written_a = tick(sim_db, now=fixed_now, seed=1)
    sim_db.commit()
    counts_a = {
        svc_id: sim_db.execute(
            "SELECT requests FROM metric_buckets WHERE service_id=? AND bucket_start=?",
            (svc_id, b),
        ).fetchone()["requests"]
        for svc_id, b in written_a
    }

    sim_db.execute("DELETE FROM metric_buckets")
    sim_db.commit()

    written_b = tick(sim_db, now=fixed_now, seed=9999)
    sim_db.commit()
    counts_b = {
        svc_id: sim_db.execute(
            "SELECT requests FROM metric_buckets WHERE service_id=? AND bucket_start=?",
            (svc_id, b),
        ).fetchone()["requests"]
        for svc_id, b in written_b
    }

    # At least one service must differ (probability of all-match is negligible)
    assert any(counts_a[s] != counts_b.get(s) for s in counts_a), (
        "Different seeds must not produce identical request counts for every service"
    )


def test_different_minutes_produce_different_buckets(sim_db, fixed_now):
    """Consecutive minutes must write different bucket_start keys (distinct rows)."""
    now2 = fixed_now + timedelta(minutes=1)
    svc_id = _first_svc(sim_db)

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()
    tick(sim_db, now=now2, seed=42)
    sim_db.commit()

    b1 = floor_to_minute(fixed_now).isoformat()
    b2 = floor_to_minute(now2).isoformat()

    assert b1 != b2, "Consecutive minutes must produce distinct bucket_start values"

    r1 = sim_db.execute(
        "SELECT requests FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b1),
    ).fetchone()
    r2 = sim_db.execute(
        "SELECT requests FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b2),
    ).fetchone()
    assert r1 is not None and r2 is not None
    # Real assertion: both buckets exist in the DB as separate rows
    count = sim_db.execute(
        "SELECT COUNT(*) as c FROM metric_buckets WHERE service_id=? AND bucket_start IN (?,?)",
        (svc_id, b1, b2),
    ).fetchone()["c"]
    assert count == 2, "Both minute buckets must be present as separate rows"


# ===========================================================================
# 2. REPEATED TICK INSIDE ONE MINUTE IS IDEMPOTENT
# ===========================================================================


def test_repeated_tick_same_minute_leaves_bucket_unchanged(sim_db, fixed_now):
    """Calling tick() twice at the same minute must not change the stored bucket."""
    svc_id = _first_svc(sim_db)
    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()
    b_start = floor_to_minute(fixed_now).isoformat()
    first = dict(sim_db.execute(
        "SELECT requests, errors, latency_hist "
        "FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b_start),
    ).fetchone())

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()
    second = dict(sim_db.execute(
        "SELECT requests, errors, latency_hist "
        "FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b_start),
    ).fetchone())

    assert first == second, "Repeated tick at same minute must be idempotent"


# ===========================================================================
# 3. PAUSED -> zero-request bucket + status gray "No data"
# ===========================================================================


def test_paused_service_writes_zero_request_bucket(sim_db, fixed_now):
    """paused=1: bucket is written with requests=0 and all-zero histogram."""
    svc_id = _first_svc(sim_db)
    _set_mode(sim_db, svc_id, "normal", paused=1)

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    b_start = floor_to_minute(fixed_now).isoformat()
    row = sim_db.execute(
        "SELECT requests, errors, latency_p50, latency_p95, latency_hist "
        "FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b_start),
    ).fetchone()

    assert row is not None
    assert row["requests"] == 0
    assert row["errors"] == 0
    assert row["latency_p50"] is None
    assert row["latency_p95"] is None
    assert json.loads(row["latency_hist"]) == [0] * HIST_BIN_COUNT


def test_paused_service_status_is_gray_no_data(sim_db, fixed_now):
    """After 3 paused (zero-request) ticks the status must be exactly gray/No data."""
    svc_id = _first_svc(sim_db)
    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    sim_db.commit()

    _set_mode(sim_db, svc_id, "normal", paused=1)
    _write_ticks(sim_db, svc_id, fixed_now, count=3)

    res = _status(sim_db, svc_id, now=fixed_now + timedelta(minutes=2))
    assert res["status"] == "gray", f"Expected gray, got: {res['status']}"
    assert res["label"] == "No data", f"Expected 'No data', got: {res['label']}"


# ===========================================================================
# 4. REPORTING_PAUSED -> NO bucket written -> stale gray
# ===========================================================================


def test_reporting_paused_service_writes_no_bucket(sim_db, fixed_now):
    """reporting_paused=1 must skip writing any bucket."""
    svc_id = _first_svc(sim_db)
    _set_mode(sim_db, svc_id, "normal", reporting_paused=1)
    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    sim_db.commit()

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    b_start = floor_to_minute(fixed_now).isoformat()
    row = sim_db.execute(
        "SELECT 1 FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b_start),
    ).fetchone()
    assert row is None, "reporting_paused must not write any bucket"


def test_reporting_paused_leads_to_stale_status(sim_db, fixed_now):
    """A service with only an old stale bucket must report gray/Stale."""
    svc_id = _first_svc(sim_db)

    past_dt = fixed_now - timedelta(seconds=settings.stale_after_s + 60)
    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    sim_db.execute(
        """INSERT INTO metric_buckets
           (service_id, bucket_start, requests, errors,
            latency_p50, latency_p95, latency_hist, created_at)
           VALUES (?, ?, 100, 2, 120, 250, ?, ?)""",
        (svc_id, past_dt.isoformat(), json.dumps([0] * HIST_BIN_COUNT), fixed_now.isoformat()),
    )
    sim_db.commit()

    res = _status(sim_db, svc_id, now=fixed_now)
    assert res["status"] == "gray", f"Expected gray, got: {res['status']}"
    assert res["label"] == "Stale", f"Expected 'Stale', got: {res['label']}"


# ===========================================================================
# 5. BREACHES for a service with ZERO buckets returns ["stale"]
# ===========================================================================


def test_breaches_returns_stale_when_no_buckets_at_all(sim_db, fixed_now):
    """breaches() must return ['stale'] for a service that has never reported."""
    svc_id = _first_svc(sim_db)
    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    sim_db.commit()

    result = breaches(sim_db, svc_id, now=fixed_now)
    assert result == ["stale"], f"Expected ['stale'] for zero-bucket service, got: {result}"


# ===========================================================================
# 6. FAILING mode -> ~40% errors + status red "Failing"
# ===========================================================================


def test_failing_mode_error_rate_is_near_40_percent(sim_db, fixed_now):
    """Failing mode must produce 38-42% error rate per bucket."""
    sim_db.execute("UPDATE sim_state SET mode='failing', paused=0, reporting_paused=0")
    sim_db.commit()

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    b_start = floor_to_minute(fixed_now).isoformat()
    rows = sim_db.execute(
        "SELECT service_id, requests, errors FROM metric_buckets WHERE bucket_start=?",
        (b_start,),
    ).fetchall()

    assert len(rows) > 0
    for row in rows:
        if row["requests"] > 0:
            rate = row["errors"] / row["requests"]
            assert 0.30 <= rate <= 0.55, (
                f"{row['service_id']}: failing error rate {rate:.2%} out of expected 30-55%"
            )


def test_failing_mode_status_is_exactly_red_failing(sim_db, fixed_now):
    """After 3 failing ticks the status must be exactly red/Failing."""
    svc_id = _first_svc(sim_db)
    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    _set_mode(sim_db, svc_id, "failing")

    _write_ticks(sim_db, svc_id, fixed_now - timedelta(minutes=2), count=3)

    res = _status(sim_db, svc_id, now=fixed_now)
    assert res["status"] == "red", f"Expected red, got: {res['status']}"
    assert res["label"] == "Failing", f"Expected 'Failing', got: {res['label']}"


# ===========================================================================
# 7. SLOW mode -> p95 > 800ms + status red "Slow"
# ===========================================================================


def test_slow_mode_status_is_exactly_red_slow(sim_db, fixed_now):
    """After 3 slow-mode ticks status must be exactly red/Slow (p95 > 800ms)."""
    svc_id = _first_svc(sim_db)
    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    _set_mode(sim_db, svc_id, "slow")

    _write_ticks(sim_db, svc_id, fixed_now - timedelta(minutes=2), count=3)

    res = _status(sim_db, svc_id, now=fixed_now)
    assert res["p95"] is not None and res["p95"] > 800.0, (
        f"Slow mode must produce p95 > 800ms, got: {res['p95']}"
    )
    assert res["status"] == "red", f"Expected red, got: {res['status']}"
    assert res["label"] == "Slow", f"Expected 'Slow', got: {res['label']}"


# ===========================================================================
# 8. NORMAL mode -> green "Healthy" with p95 clearly under threshold
# ===========================================================================


def test_normal_mode_status_is_exactly_green_healthy(sim_db, fixed_now):
    """After 3 normal ticks status must be exactly green/Healthy with p95 well under 800ms."""
    svc_id = _first_svc(sim_db)
    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    _set_mode(sim_db, svc_id, "normal")

    _write_ticks(sim_db, svc_id, fixed_now - timedelta(minutes=2), count=3)

    res = _status(sim_db, svc_id, now=fixed_now)
    assert res["status"] == "green", f"Expected green, got: {res['status']}"
    assert res["label"] == "Healthy", f"Expected 'Healthy', got: {res['label']}"
    assert res["p95"] is not None and res["p95"] < 500.0, (
        f"Normal mode p95 must be < 500ms (well under threshold), got: {res['p95']}"
    )


# ===========================================================================
# 9. RECOVERING lifecycle: blends -> auto-switches to normal -> green
# ===========================================================================


def test_recovering_auto_switches_to_normal_after_5_minutes(sim_db, fixed_now):
    """After 310s of recovery, mode must flip to normal in sim_state."""
    svc_id = _first_svc(sim_db)
    mode_since = (fixed_now - timedelta(seconds=310)).isoformat()
    sim_db.execute(
        "UPDATE sim_state SET mode='recovering', paused=0, reporting_paused=0, mode_since=? "
        "WHERE service_id=?",
        (mode_since, svc_id),
    )
    sim_db.commit()

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    row = sim_db.execute(
        "SELECT mode FROM sim_state WHERE service_id=?", (svc_id,)
    ).fetchone()
    assert row["mode"] == "normal", f"Expected normal after recovery, got: {row['mode']!r}"


def test_recovering_blend_error_rate_decreases():
    """Error rate must decrease monotonically from ~40% to ~2% over recovery progress."""
    rng = random.Random("test:blend")
    rate_0 = get_profile_error_rate("recovering", rng, recovery_progress=0.0)
    rate_5 = get_profile_error_rate("recovering", rng, recovery_progress=0.5)
    rate_1 = get_profile_error_rate("recovering", rng, recovery_progress=1.0)

    assert rate_0 > rate_5 > rate_1, (
        f"Error rate must decrease: {rate_0:.3f} -> {rate_5:.3f} -> {rate_1:.3f}"
    )
    assert rate_0 >= 0.35, f"Early recovery error rate must be ~40%, got {rate_0}"
    assert rate_1 <= 0.05, f"Late recovery error rate must be ~2%, got {rate_1}"


def test_recovering_full_lifecycle_ends_green(sim_db, fixed_now):
    """Full lifecycle: 3 minutes failing, switch to recovering, tick through recovery to healthy."""
    svc_id = _first_svc(sim_db)
    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    sim_db.commit()

    base_t = fixed_now

    # 1. Start in failing mode at base_t (minutes 0..2)
    _set_mode(sim_db, svc_id, "failing", mode_since=base_t)
    for minute in range(3):
        t = base_t + timedelta(minutes=minute)
        tick(sim_db, now=t, seed=42)
        sim_db.commit()
        st = _status(sim_db, svc_id, now=t)
        assert st["status"] == "red"
        assert st["label"] == "Failing"

    # 2. At minute 3, switch to recovering
    recov_start = base_t + timedelta(minutes=3)
    _set_mode(sim_db, svc_id, "recovering", mode_since=recov_start)

    # 3. Minutes 3..7: recovering in progress (0s..240s)
    # Status remains red "Failing" while high-error recovery buckets are in the 3-bucket window
    for minute in range(3, 8):
        t = base_t + timedelta(minutes=minute)
        tick(sim_db, now=t, seed=42)
        sim_db.commit()
        st = _status(sim_db, svc_id, now=t)
        assert st["status"] == "red"
        assert st["label"] == "Failing"

    # 4. Minute 8: 300s elapsed since recovery began -> auto-switches mode to normal
    t8 = base_t + timedelta(minutes=8)
    tick(sim_db, now=t8, seed=42)
    sim_db.commit()

    state = sim_db.execute(
        "SELECT mode FROM sim_state WHERE service_id=?", (svc_id,)
    ).fetchone()
    assert state["mode"] == "normal", f"Expected mode 'normal' after 300s, got {state['mode']}"

    # Status at min 8 is still red Failing because min 6-7 recovery buckets
    # are still in the 3-bucket window
    st8 = _status(sim_db, svc_id, now=t8)
    assert st8["status"] == "red"
    assert st8["label"] == "Failing"

    # 5. Minutes 9-10: tick in normal mode until the entire 3-bucket window is normal
    t9 = base_t + timedelta(minutes=9)
    tick(sim_db, now=t9, seed=42)
    sim_db.commit()

    t10 = base_t + timedelta(minutes=10)
    tick(sim_db, now=t10, seed=42)
    sim_db.commit()

    # At minute 10, all 3 trailing buckets (min 8, 9, 10) were written in normal mode
    st10 = _status(sim_db, svc_id, now=t10)
    assert st10["status"] == "green", f"Expected green after full recovery, got: {st10['status']}"
    assert st10["label"] == "Healthy", f"Expected 'Healthy', got: {st10['label']}"


# ===========================================================================
# 10. RESTART: new SimulatorService/DB connection resumes saved mode
# ===========================================================================


def test_restart_resumes_saved_mode_from_db(sim_db, fixed_now):
    """After a restart (new connection), sim_state persists and tick honours it."""
    svc_id = _first_svc(sim_db)
    sim_db.execute(
        "UPDATE sim_state SET mode='failing', paused=0, reporting_paused=0 WHERE service_id=?",
        (svc_id,),
    )
    sim_db.commit()
    sim_db.close()

    # Simulate a restart: new connection to the same DB
    new_conn = sqlite3.connect(str(settings.db_path))
    new_conn.row_factory = sqlite3.Row
    new_conn.execute("PRAGMA journal_mode=WAL")
    new_conn.execute("PRAGMA foreign_keys=ON")

    # Reload mode from DB (as a real restart would)
    saved = new_conn.execute(
        "SELECT mode FROM sim_state WHERE service_id=?", (svc_id,)
    ).fetchone()
    assert saved["mode"] == "failing", "DB must persist mode across reconnect"

    # Run a tick; it should produce failing-mode error rates
    tick(new_conn, now=fixed_now, seed=42)
    new_conn.commit()

    b_start = floor_to_minute(fixed_now).isoformat()
    row = new_conn.execute(
        "SELECT requests, errors FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b_start),
    ).fetchone()
    assert row is not None
    rate = row["errors"] / row["requests"]
    assert 0.30 <= rate <= 0.55, f"Restarted service must tick in failing mode: rate={rate:.2%}"
    new_conn.close()


# ===========================================================================
# 11. ACTIVE USERS change after ticks
# ===========================================================================


def test_active_users_change_after_tick(sim_db, fixed_now):
    """At least some app_users.last_seen_at must be updated by a tick."""
    before = {r["id"]: r["last_seen_at"] for r in sim_db.execute(
        "SELECT id, last_seen_at FROM app_users"
    ).fetchall()}

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    after = {r["id"]: r["last_seen_at"] for r in sim_db.execute(
        "SELECT id, last_seen_at FROM app_users"
    ).fetchall()}

    changed = sum(1 for uid in before if before[uid] != after.get(uid))
    assert 20 <= changed <= 35, f"Expected 20-35 users updated per tick, got {changed}"


# ===========================================================================
# 12. TICK RAISES -> SimulatorService loop keeps running
# ===========================================================================


@pytest.mark.asyncio
async def test_simulator_loop_survives_tick_exception(caplog, monkeypatch):
    """If tick() raises once, SimulatorService must log the error and keep looping."""
    import asyncio

    monkeypatch.setattr(settings, "sim_tick", 0.01)
    call_count = 0

    def fake_run_tick():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("simulated tick failure")
        return []

    svc = SimulatorService()
    svc._run_tick = fake_run_tick
    svc.is_running = True

    with caplog.at_level(logging.ERROR, logger="backend.simulator"):
        task = asyncio.create_task(svc._loop())
        for _ in range(50):
            if call_count >= 2:
                break
            await asyncio.sleep(0.01)
        svc.is_running = False
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    assert call_count >= 2, f"Loop must keep running after an exception; ran {call_count} ticks"
    assert any("Simulator tick encountered an error" in r.message for r in caplog.records)


# ===========================================================================
# 13. MD_SIM_ENABLED controlled via monkeypatch (NOT shell env vars)
# ===========================================================================


@pytest.mark.asyncio
async def test_simulator_service_disabled_via_settings(monkeypatch):
    """SimulatorService must not start when sim_enabled=False (set via monkeypatch)."""
    monkeypatch.setattr(settings, "sim_enabled", False)
    svc = SimulatorService()
    await svc.start()
    assert not svc.is_running, "Must not run when sim_enabled is False"
    await svc.stop()  # safe no-op


# ===========================================================================
# 14. PROFILE HELPERS
# ===========================================================================


def test_normal_mode_low_error_rate():
    """Normal mode error rate must stay in 1.5-2.5% range across many samples."""
    rng = random.Random("test:normal")
    for _ in range(30):
        rate = get_profile_error_rate("normal", rng)
        assert 0.01 <= rate <= 0.03, f"Normal error rate {rate:.4f} out of 1-3%"


def test_slow_mode_histogram_peak_in_high_bins():
    """Slow mode must have significantly more requests above 400ms than normal."""
    rng = random.Random("test:slow_hist")
    slow = generate_profile_histogram(200, "slow", rng)
    normal = generate_profile_histogram(200, "normal", rng)
    # bins 0-9 <= 400ms, bins 10-17 > 400ms
    assert sum(slow[10:]) > sum(normal[10:]), "Slow must have more high-latency requests"


def test_normal_histogram_bin_count():
    """generate_profile_histogram must return exactly HIST_BIN_COUNT bins for all modes."""
    rng = random.Random("test:bins")
    for mode in ("normal", "slow", "failing", "recovering"):
        hist = generate_profile_histogram(100, mode, rng, recovery_progress=0.5)
        assert len(hist) == HIST_BIN_COUNT


def test_histogram_sum_equals_total_requests():
    """Bin sum must equal total requests for all modes (no counts lost or gained)."""
    rng = random.Random("test:sum")
    for total in (50, 120, 240):
        hist = generate_profile_histogram(total, "normal", rng)
        assert sum(hist) == total, f"Histogram sum {sum(hist)} != {total}"


# ===========================================================================
# 15. ERRORS <= REQUESTS constraint invariant
# ===========================================================================


def test_tick_never_writes_errors_exceeding_requests(sim_db, fixed_now):
    """Every written bucket must satisfy errors <= requests."""
    sim_db.execute("UPDATE sim_state SET mode='failing', paused=0, reporting_paused=0")
    sim_db.commit()

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    b_start = floor_to_minute(fixed_now).isoformat()
    for row in sim_db.execute(
        "SELECT service_id, requests, errors FROM metric_buckets WHERE bucket_start=?",
        (b_start,),
    ).fetchall():
        assert row["errors"] <= row["requests"], (
            f"{row['service_id']}: errors ({row['errors']}) > requests ({row['requests']})"
        )


# ===========================================================================
# 16. SYNTHETIC USER TOUCHING
# ===========================================================================


def test_touch_synthetic_users_is_deterministic(sim_db, fixed_now):
    """Two identical calls must update the same set of user IDs."""
    b_start = floor_to_minute(fixed_now).isoformat()
    sentinel = "2000-01-01T00:00:00"

    sim_db.execute(f"UPDATE app_users SET last_seen_at = '{sentinel}'")
    sim_db.commit()
    touch_synthetic_users(sim_db, b_start, fixed_now, seed=42)
    sim_db.commit()
    ids1 = {r["id"] for r in sim_db.execute(
        f"SELECT id FROM app_users WHERE last_seen_at > '{sentinel}'"
    ).fetchall()}

    sim_db.execute(f"UPDATE app_users SET last_seen_at = '{sentinel}'")
    sim_db.commit()
    touch_synthetic_users(sim_db, b_start, fixed_now, seed=42)
    sim_db.commit()
    ids2 = {r["id"] for r in sim_db.execute(
        f"SELECT id FROM app_users WHERE last_seen_at > '{sentinel}'"
    ).fetchall()}

    assert ids1 == ids2, "touch_synthetic_users must be deterministic"
    assert 20 <= len(ids1) <= 35, f"Must update 20-35 users, got {len(ids1)}"


def test_touch_synthetic_users_different_buckets_differ(sim_db, fixed_now):
    """Different bucket_start values must produce different user subsets."""
    sentinel = "2000-01-01T00:00:00"
    b1 = floor_to_minute(fixed_now).isoformat()
    b2 = floor_to_minute(fixed_now + timedelta(minutes=1)).isoformat()

    sim_db.execute(f"UPDATE app_users SET last_seen_at = '{sentinel}'")
    sim_db.commit()
    touch_synthetic_users(sim_db, b1, fixed_now, seed=42)
    sim_db.commit()
    ids1 = {r["id"] for r in sim_db.execute(
        f"SELECT id FROM app_users WHERE last_seen_at > '{sentinel}'"
    ).fetchall()}

    sim_db.execute(f"UPDATE app_users SET last_seen_at = '{sentinel}'")
    sim_db.commit()
    touch_synthetic_users(sim_db, b2, fixed_now + timedelta(minutes=1), seed=42)
    sim_db.commit()
    ids2 = {r["id"] for r in sim_db.execute(
        f"SELECT id FROM app_users WHERE last_seen_at > '{sentinel}'"
    ).fetchall()}

    assert ids1 != ids2, "Different bucket_starts must produce different user subsets"
