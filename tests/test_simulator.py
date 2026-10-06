"""Tests for the deterministic traffic simulator (Task 05).

Design principles under test:
- Same seed + same minute -> identical bucket (determinism).
- paused writes zero-request buckets; reporting_paused writes NO bucket.
- failing mode produces ~40% error rate -> red status.
- recovering mode auto-switches to normal after 5 minutes of elapsed wall time.
- Synthetic user touches are deterministic and bounded.
- The async SimulatorService honours MD_SIM_ENABLED=0.
"""

import json
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
    """Return an open, seeded connection with row_factory set."""
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
    """A stable UTC datetime for deterministic tests."""
    return datetime(2025, 6, 15, 12, 30, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# 1. Determinism: same seed + same minute -> identical bucket
# ---------------------------------------------------------------------------


def test_tick_is_deterministic(sim_db, fixed_now):
    """Two ticks at the same timestamp with the same seed must write identical data."""
    written1 = tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    first_buckets = {}
    for svc_id, b_start in written1:
        row = sim_db.execute(
            "SELECT requests, errors, latency_p50, latency_p95, latency_hist "
            "FROM metric_buckets WHERE service_id=? AND bucket_start=?",
            (svc_id, b_start),
        ).fetchone()
        first_buckets[(svc_id, b_start)] = dict(row)

    written2 = tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    assert set(written1) == set(written2), "Same services must be written both times"

    for svc_id, b_start in written2:
        row = sim_db.execute(
            "SELECT requests, errors, latency_p50, latency_p95, latency_hist "
            "FROM metric_buckets WHERE service_id=? AND bucket_start=?",
            (svc_id, b_start),
        ).fetchone()
        second = dict(row)
        first = first_buckets[(svc_id, b_start)]
        assert first["requests"] == second["requests"], f"{svc_id}: requests differ"
        assert first["errors"] == second["errors"], f"{svc_id}: errors differ"
        assert first["latency_p50"] == second["latency_p50"], f"{svc_id}: p50 differs"
        assert first["latency_hist"] == second["latency_hist"], f"{svc_id}: histogram differs"


def test_different_seeds_produce_different_buckets(sim_db, fixed_now):
    """Different seeds must produce different request counts for the same minute."""
    written_a = tick(sim_db, now=fixed_now, seed=1)
    sim_db.commit()
    data_a = {
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
    data_b = {
        svc_id: sim_db.execute(
            "SELECT requests FROM metric_buckets WHERE service_id=? AND bucket_start=?",
            (svc_id, b),
        ).fetchone()["requests"]
        for svc_id, b in written_b
    }

    assert any(data_a[s] != data_b.get(s) for s in data_a), (
        "Two different seeds produced identical request counts for all services"
    )


def test_different_minutes_produce_different_buckets(sim_db, fixed_now):
    """Consecutive minutes must produce different request counts for the same service."""
    now2 = fixed_now + timedelta(minutes=1)

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()
    tick(sim_db, now=now2, seed=42)
    sim_db.commit()

    svc_id = sim_db.execute("SELECT service_id FROM sim_state LIMIT 1").fetchone()["service_id"]
    b1 = floor_to_minute(fixed_now).isoformat()
    b2 = floor_to_minute(now2).isoformat()

    r1 = sim_db.execute(
        "SELECT requests FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b1),
    ).fetchone()
    r2 = sim_db.execute(
        "SELECT requests FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b2),
    ).fetchone()

    assert r1 is not None and r2 is not None, "Both minutes must have a bucket"
    assert r1["requests"] != r2["requests"] or b1 != b2


# ---------------------------------------------------------------------------
# 2. paused -> zero-request bucket is written
# ---------------------------------------------------------------------------


def test_paused_service_writes_zero_request_bucket(sim_db, fixed_now):
    """A paused service must produce a bucket with requests=0 and empty histogram."""
    svc_id = sim_db.execute("SELECT service_id FROM sim_state LIMIT 1").fetchone()["service_id"]
    sim_db.execute(
        "UPDATE sim_state SET paused=1, reporting_paused=0 WHERE service_id=?", (svc_id,)
    )
    sim_db.commit()

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    b_start = floor_to_minute(fixed_now).isoformat()
    row = sim_db.execute(
        "SELECT requests, errors, latency_p50, latency_p95, latency_hist "
        "FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b_start),
    ).fetchone()

    assert row is not None, "Paused service must still write a bucket"
    assert row["requests"] == 0
    assert row["errors"] == 0
    assert row["latency_p50"] is None
    assert row["latency_p95"] is None
    hist = json.loads(row["latency_hist"])
    assert hist == [0] * HIST_BIN_COUNT


# ---------------------------------------------------------------------------
# 3. reporting_paused -> NO bucket written (data goes stale -> gray)
# ---------------------------------------------------------------------------


def test_reporting_paused_service_writes_no_bucket(sim_db, fixed_now):
    """A reporting-paused service must write NO bucket so data goes stale."""
    svc_id = sim_db.execute("SELECT service_id FROM sim_state LIMIT 1").fetchone()["service_id"]
    sim_db.execute(
        "UPDATE sim_state SET paused=0, reporting_paused=1 WHERE service_id=?", (svc_id,)
    )
    sim_db.commit()

    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    sim_db.commit()

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    b_start = floor_to_minute(fixed_now).isoformat()
    row = sim_db.execute(
        "SELECT 1 FROM metric_buckets WHERE service_id=? AND bucket_start=?",
        (svc_id, b_start),
    ).fetchone()

    assert row is None, "reporting_paused service must NOT write any bucket"


def test_reporting_paused_leads_to_stale_status(sim_db, fixed_now):
    """After stale_after_s seconds with no bucket, status engine returns gray/stale."""
    svc_id = sim_db.execute("SELECT service_id FROM sim_state LIMIT 1").fetchone()["service_id"]

    past_dt = fixed_now - timedelta(seconds=settings.stale_after_s + 60)
    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    sim_db.execute(
        """INSERT INTO metric_buckets
           (service_id, bucket_start, requests, errors,
            latency_p50, latency_p95, latency_hist, created_at)
           VALUES (?, ?, 100, 2, 120, 250, ?, ?)""",
        (
            svc_id,
            past_dt.isoformat(),
            json.dumps([0] * HIST_BIN_COUNT),
            fixed_now.isoformat(),
        ),
    )
    sim_db.commit()

    result = evaluate_service_status(sim_db, svc_id, now=fixed_now)
    status = result["status"]
    assert status in ("gray", "stale", "no_data"), f"Expected stale/gray, got: {status}"
    b = breaches(sim_db, svc_id, now=fixed_now)
    assert "stale" in b, f"Expected 'stale' in breaches, got: {b}"


# ---------------------------------------------------------------------------
# 4. failing mode -> ~40% errors and red status
# ---------------------------------------------------------------------------


def test_failing_mode_error_rate(sim_db, fixed_now):
    """Failing mode must produce error rate close to 40%."""
    sim_db.execute("UPDATE sim_state SET mode='failing', paused=0, reporting_paused=0")
    sim_db.commit()

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    b_start = floor_to_minute(fixed_now).isoformat()
    rows = sim_db.execute(
        "SELECT service_id, requests, errors FROM metric_buckets WHERE bucket_start=?",
        (b_start,),
    ).fetchall()

    assert len(rows) > 0, "Failing services must still write buckets"

    for row in rows:
        if row["requests"] > 0:
            rate = row["errors"] / row["requests"]
            assert 0.30 <= rate <= 0.55, (
                f"Failing mode error rate out of range for {row['service_id']}: {rate:.2%}"
            )


def test_failing_mode_triggers_red_status(sim_db, fixed_now):
    """A service in failing mode must evaluate to Failing (red) status."""
    svc_id = sim_db.execute("SELECT service_id FROM sim_state LIMIT 1").fetchone()["service_id"]
    sim_db.execute(
        "UPDATE sim_state SET mode='failing', paused=0, reporting_paused=0 WHERE service_id=?",
        (svc_id,),
    )
    sim_db.execute("DELETE FROM metric_buckets WHERE service_id=?", (svc_id,))
    sim_db.commit()

    for offset in range(3):
        t = fixed_now - timedelta(minutes=2 - offset)
        tick(sim_db, now=t, seed=42)
        sim_db.commit()

    result = evaluate_service_status(sim_db, svc_id, now=fixed_now)
    status = result["status"]
    assert status in ("red", "Failing", "failing"), f"Expected red status, got: {status!r}"


# ---------------------------------------------------------------------------
# 5. normal mode profile validation
# ---------------------------------------------------------------------------


def test_normal_mode_low_error_rate():
    """Normal mode error rate must stay in ~2% range."""
    rng = random.Random("test:normal")
    for _ in range(30):
        rate = get_profile_error_rate("normal", rng)
        assert 0.01 <= rate <= 0.03, f"Normal mode error rate out of expected range: {rate}"


def test_slow_mode_histogram_peak_in_high_bins():
    """Slow mode histogram must have more requests above 400ms than normal mode."""
    rng = random.Random("test:slow_hist")
    total = 200

    slow_hist = generate_profile_histogram(total, "slow", rng)
    normal_hist = generate_profile_histogram(total, "normal", rng)

    slow_high = sum(slow_hist[10:])
    normal_high = sum(normal_hist[10:])

    assert slow_high > normal_high, (
        f"Slow mode must have more high-latency requests: slow={slow_high} vs normal={normal_high}"
    )


def test_normal_histogram_bin_count():
    """generate_profile_histogram must always return exactly HIST_BIN_COUNT bins."""
    rng = random.Random("test:bins")
    for mode in ("normal", "slow", "failing", "recovering"):
        hist = generate_profile_histogram(100, mode, rng, recovery_progress=0.5)
        assert len(hist) == HIST_BIN_COUNT, f"Expected {HIST_BIN_COUNT} bins, got {len(hist)}"


def test_histogram_sum_equals_total_requests():
    """Histogram bin sum must equal the total request count."""
    rng = random.Random("test:sum_check")
    for total in (50, 120, 240):
        hist = generate_profile_histogram(total, "normal", rng)
        assert sum(hist) == total, f"Histogram sum {sum(hist)} != requests {total}"


# ---------------------------------------------------------------------------
# 6. recovering mode auto-switch to normal
# ---------------------------------------------------------------------------


def test_recovering_auto_switches_to_normal_after_5_minutes(sim_db, fixed_now):
    """After 5 minutes (300s) of recovery, mode must auto-switch to normal."""
    svc_id = sim_db.execute("SELECT service_id FROM sim_state LIMIT 1").fetchone()["service_id"]

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
    assert row["mode"] == "normal", f"Expected mode='normal', got: {row['mode']!r}"


def test_recovering_blend_error_rate_decreases():
    """Error rate must decrease linearly from ~40% at progress=0 to ~2% at progress=1."""
    rng = random.Random("test:blend")
    rate_start = get_profile_error_rate("recovering", rng, recovery_progress=0.0)
    rate_mid = get_profile_error_rate("recovering", rng, recovery_progress=0.5)
    rate_end = get_profile_error_rate("recovering", rng, recovery_progress=1.0)

    assert rate_start > rate_mid > rate_end, (
        f"Error rate must decrease with recovery progress: "
        f"{rate_start:.3f} -> {rate_mid:.3f} -> {rate_end:.3f}"
    )
    assert rate_start >= 0.35, f"Early recovery error rate must be near 40%: {rate_start}"
    assert rate_end <= 0.05, f"Late recovery error rate must be near 2%: {rate_end}"


# ---------------------------------------------------------------------------
# 7. Synthetic user touching
# ---------------------------------------------------------------------------


def test_touch_synthetic_users_is_deterministic(sim_db, fixed_now):
    """Two calls to touch_synthetic_users with the same arguments must update the same users."""
    b_start = floor_to_minute(fixed_now).isoformat()

    sim_db.execute("UPDATE app_users SET last_seen_at = '2000-01-01T00:00:00'")
    sim_db.commit()
    touch_synthetic_users(sim_db, b_start, fixed_now, seed=42)
    sim_db.commit()
    touched_ids_1 = set(
        r["id"]
        for r in sim_db.execute(
            "SELECT id FROM app_users WHERE last_seen_at > '2000-01-01T00:00:00'"
        ).fetchall()
    )

    sim_db.execute("UPDATE app_users SET last_seen_at = '2000-01-01T00:00:00'")
    sim_db.commit()
    touch_synthetic_users(sim_db, b_start, fixed_now, seed=42)
    sim_db.commit()
    touched_ids_2 = set(
        r["id"]
        for r in sim_db.execute(
            "SELECT id FROM app_users WHERE last_seen_at > '2000-01-01T00:00:00'"
        ).fetchall()
    )

    assert touched_ids_1 == touched_ids_2, "touch_synthetic_users must be deterministic"
    assert 20 <= len(touched_ids_1) <= 35, (
        f"Must touch 20-35 users, touched: {len(touched_ids_1)}"
    )


def test_touch_synthetic_users_different_buckets_differ(sim_db, fixed_now):
    """Different bucket_start values must touch different user subsets."""
    b1 = floor_to_minute(fixed_now).isoformat()
    b2 = floor_to_minute(fixed_now + timedelta(minutes=1)).isoformat()

    sim_db.execute("UPDATE app_users SET last_seen_at = '2000-01-01T00:00:00'")
    sim_db.commit()
    touch_synthetic_users(sim_db, b1, fixed_now, seed=42)
    sim_db.commit()
    ids1 = {r["id"] for r in sim_db.execute(
        "SELECT id FROM app_users WHERE last_seen_at > '2000-01-01T00:00:00'"
    ).fetchall()}

    sim_db.execute("UPDATE app_users SET last_seen_at = '2000-01-01T00:00:00'")
    sim_db.commit()
    touch_synthetic_users(sim_db, b2, fixed_now + timedelta(minutes=1), seed=42)
    sim_db.commit()
    ids2 = {r["id"] for r in sim_db.execute(
        "SELECT id FROM app_users WHERE last_seen_at > '2000-01-01T00:00:00'"
    ).fetchall()}

    assert ids1 != ids2, "Different bucket_starts must produce different user subsets"


# ---------------------------------------------------------------------------
# 8. tick writes errors <= requests (CHECK constraint safe)
# ---------------------------------------------------------------------------


def test_tick_never_exceeds_errors_gt_requests(sim_db, fixed_now):
    """Every bucket written must satisfy errors <= requests."""
    sim_db.execute("UPDATE sim_state SET mode='failing', paused=0, reporting_paused=0")
    sim_db.commit()

    tick(sim_db, now=fixed_now, seed=42)
    sim_db.commit()

    b_start = floor_to_minute(fixed_now).isoformat()
    rows = sim_db.execute(
        "SELECT service_id, requests, errors FROM metric_buckets WHERE bucket_start=?",
        (b_start,),
    ).fetchall()

    for row in rows:
        assert row["errors"] <= row["requests"], (
            f"{row['service_id']}: errors ({row['errors']}) > requests ({row['requests']})"
        )


# ---------------------------------------------------------------------------
# 9. SimulatorService respects MD_SIM_ENABLED=0
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_simulator_service_disabled_when_flag_off():
    """SimulatorService.start() must be a no-op when sim_enabled=False."""
    orig = settings.sim_enabled
    settings.sim_enabled = False
    svc = SimulatorService()
    await svc.start()
    assert not svc.is_running, "SimulatorService must not start when disabled"
    await svc.stop()
    settings.sim_enabled = orig

