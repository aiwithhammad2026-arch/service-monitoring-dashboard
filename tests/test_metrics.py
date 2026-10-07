"""Tests for metrics engine: histogram percentiles, summaries, and status engine."""

import json
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from backend.db import get_connection, get_db
from backend.metrics import (
    HIST_BIN_COUNT,
    history,
    merge_hists,
    overview,
    percentile,
    summarize,
)
from backend.seed import seed
from backend.status import breaches, evaluate_service_status


def test_percentile_empty_histogram_returns_none() -> None:
    """Empty histogram (zero requests) must return None for any percentile."""
    empty_hist = [0] * HIST_BIN_COUNT
    assert percentile(empty_hist, 50) is None
    assert percentile(empty_hist, 95) is None


def test_percentile_single_bin_interpolation() -> None:
    """Samples located in a single bin interpolate linearly inside that bin."""
    # 100 requests in bin 6 (100ms - 150ms)
    hist = [0] * HIST_BIN_COUNT
    hist[6] = 100

    p50 = percentile(hist, 50)
    p95 = percentile(hist, 95)

    assert p50 is not None
    assert p95 is not None
    # Bin 6: lower=100, upper=150, width=50. p50 rank=50 -> 100 + 0.5 * 50 = 125.0
    assert pytest.approx(p50, 0.1) == 125.0
    # p95 rank=95 -> 100 + 0.95 * 50 = 147.5
    assert pytest.approx(p95, 0.1) == 147.5


def test_merge_hists_combines_bin_counts() -> None:
    """merge_hists performs exact bin-wise summation across multiple histograms."""
    h1 = [0] * HIST_BIN_COUNT
    h1[0] = 10
    h1[4] = 20

    h2 = [0] * HIST_BIN_COUNT
    h2[0] = 5
    h2[4] = 30

    merged = merge_hists([h1, h2])
    assert merged[0] == 15
    assert merged[4] == 50
    assert sum(merged) == 65


def test_averaging_percentiles_is_mathematically_wrong_compared_to_merging() -> None:
    """Proves why we must merge histograms: averaging percentiles distorts weighted volume.

    Minute 1: 10 requests at ~50ms (bin 4: 50-75ms, p50=62.5ms)
    Minute 2: 1000 requests at ~500ms (bin 10: 400-600ms, p50=500.0ms)

    Naive average: (62.5 + 500.0) / 2 = 281.25 ms.
    Merged true p50: Rank 505 of 1010 falls inside bin 10, true p50 ~ 499.0 ms!
    """
    h_small = [0] * HIST_BIN_COUNT
    h_small[4] = 10  # 50-75ms

    h_large = [0] * HIST_BIN_COUNT
    h_large[10] = 1000  # 400-600ms

    p50_small = percentile(h_small, 50)
    p50_large = percentile(h_large, 50)
    assert p50_small is not None and p50_large is not None

    naive_avg_p50 = (p50_small + p50_large) / 2.0

    merged = merge_hists([h_small, h_large])
    true_p50 = percentile(merged, 50)
    assert true_p50 is not None

    # Naive average gives ~281 ms; True merged p50 is ~499 ms
    assert abs(naive_avg_p50 - true_p50) > 150.0
    assert true_p50 > 480.0


def test_hand_computed_summary_on_known_buckets() -> None:
    """Validate hand-computed metric formulas against the summarize engine output.

    Hand Calculation Walkthrough:
      Bucket 1: 100 requests, 2 errors, 100 requests in bin 6 [100, 150ms]
      Bucket 2: 200 requests, 4 errors, 200 requests in bin 7 [150, 200ms]
      Bucket 3: 100 requests, 2 errors, 100 requests in bin 8 [200, 300ms]
      Total Window Minutes: 4 minutes

      Total Requests: 100 + 200 + 100 = 400
      Total Errors:   2 + 4 + 2 = 8
      RPM:            400 / 4 = 100.0 rpm
      Success %:      (400 - 8) / 400 * 100 = 392 / 400 * 100 = 98.00 %
      Error %:        8 / 400 * 100 = 2.00 %

      Merged Histogram:
        Bin 6 [100, 150ms]: 100
        Bin 7 [150, 200ms]: 200
        Bin 8 [200, 300ms]: 100
        Total: 400

      p50 Calculation:
        Target rank: 0.50 * 400 = 200
        Cumulative before Bin 7: 100 (from Bin 6)
        Target falls in Bin 7: count = 200, lower = 150, upper = 200
        Interpolation fraction: (200 - 100) / 200 = 100 / 200 = 0.5
        p50 = 150 + 0.5 * (200 - 150) = 175.0 ms

      p95 Calculation:
        Target rank: 0.95 * 400 = 380
        Cumulative before Bin 8: 300 (100 from Bin 6 + 200 from Bin 7)
        Target falls in Bin 8: count = 100, lower = 200, upper = 300
        Interpolation fraction: (380 - 300) / 100 = 80 / 100 = 0.8
        p95 = 200 + 0.8 * (300 - 200) = 280.0 ms
    """
    h1 = [0] * HIST_BIN_COUNT
    h1[6] = 100
    h2 = [0] * HIST_BIN_COUNT
    h2[7] = 200
    h3 = [0] * HIST_BIN_COUNT
    h3[8] = 100

    rows = [
        {"requests": 100, "errors": 2, "latency_hist": json.dumps(h1)},
        {"requests": 200, "errors": 4, "latency_hist": json.dumps(h2)},
        {"requests": 100, "errors": 2, "latency_hist": json.dumps(h3)},
    ]

    summary = summarize(rows, total_minutes=4)

    assert summary["requests"] == 400
    assert summary["errors"] == 8
    assert summary["rpm"] == 100.0
    assert summary["success_pct"] == 98.0
    assert summary["error_pct"] == 2.0
    assert summary["p50"] == 175.0
    assert summary["p95"] == 280.0


def test_zero_traffic_nulls() -> None:
    """Zero requests in evaluation window must return None for percentiles and rates."""
    empty_rows = [{"requests": 0, "errors": 0, "latency_hist": json.dumps([0] * HIST_BIN_COUNT)}]
    summary = summarize(empty_rows, total_minutes=15)

    assert summary["requests"] == 0
    assert summary["errors"] == 0
    assert summary["rpm"] == 0.0
    assert summary["success_pct"] is None
    assert summary["error_pct"] is None
    assert summary["avg_latency"] is None
    assert summary["p50"] is None
    assert summary["p95"] is None


def test_histogram_percentile_vs_raw_sample_percentile() -> None:
    """Histogram interpolation must approximate empirical raw percentiles within small tolerance."""
    rng = random.Random(1234)
    # Generate 500 samples in [100, 150ms]
    samples = [rng.uniform(100.0, 150.0) for _ in range(500)]
    samples.sort()

    raw_p50 = samples[250]
    raw_p95 = samples[475]

    hist = [0] * HIST_BIN_COUNT
    hist[6] = 500  # Bin 6 is [100, 150ms]

    hist_p50 = percentile(hist, 50.0)
    hist_p95 = percentile(hist, 95.0)

    assert hist_p50 is not None and hist_p95 is not None
    # Maximum difference within bin resolution (less than 3ms difference)
    assert abs(hist_p50 - raw_p50) < 3.0
    assert abs(hist_p95 - raw_p95) < 3.0


def test_status_stale_detection(tmp_path: Path) -> None:
    """Stale detection flips to gray when newest sample age exceeds stale_after_s."""
    db_file = tmp_path / "test_status.db"
    seed(db_file)
    t0 = datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC)

    with get_db(db_file) as conn:
        conn.execute("DELETE FROM metric_buckets WHERE service_id = 'payments';")
        hist = [0] * HIST_BIN_COUNT
        hist[6] = 100
        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors,
                latency_p50, latency_p95, latency_hist, created_at
            ) VALUES ('payments', ?, 100, 1, 120.0, 250.0, ?, ?);
            """,
            (t0.isoformat(), json.dumps(hist), t0.isoformat()),
        )

        # Fresh evaluation: 60s after t0 (< stale_after_s of 180s) -> green Healthy
        st_fresh = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=60))
        assert st_fresh["status"] == "green"
        assert st_fresh["label"] == "Healthy"

        # Stale evaluation: 181s after t0 (> stale_after_s of 180s) -> gray Stale
        st_stale = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=181))
        assert st_stale["status"] == "gray"
        assert st_stale["label"] == "Stale"

        # Breaches helper reports stale
        assert breaches(conn, "payments", now=t0 + timedelta(seconds=181)) == ["stale"]


def test_status_failing_slow_healthy_and_precedence(tmp_path: Path) -> None:
    """Verify threshold evaluation and precedence: Failing beats Slow."""
    db_file = tmp_path / "test_status_rules.db"
    seed(db_file)
    t0 = datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC)

    with get_db(db_file) as conn:
        conn.execute("DELETE FROM metric_buckets WHERE service_id = 'payments';")

        # 1. Error rate breach: 20 errors / 100 requests = 20% (> 5% max_error_pct) -> red Failing
        h_normal = [0] * HIST_BIN_COUNT
        h_normal[6] = 100
        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors, latency_hist, created_at
            ) VALUES ('payments', ?, 100, 20, ?, ?);
            """,
            (t0.isoformat(), json.dumps(h_normal), t0.isoformat()),
        )
        st_fail = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=10))
        assert st_fail["status"] == "red"
        assert st_fail["label"] == "Failing"

        # 2. Latency breach: 0 errors, latencies in bin 13 [1000-1500ms] (> 800ms) -> red Slow
        conn.execute("DELETE FROM metric_buckets WHERE service_id = 'payments';")
        h_slow = [0] * HIST_BIN_COUNT
        h_slow[13] = 100
        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors, latency_hist, created_at
            ) VALUES ('payments', ?, 100, 0, ?, ?);
            """,
            (t0.isoformat(), json.dumps(h_slow), t0.isoformat()),
        )
        st_slow = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=10))
        assert st_slow["status"] == "red"
        assert st_slow["label"] == "Slow"

        # 3. Dual breach: 20% errors AND p95 > 800ms -> red Failing (Failing takes precedence)
        conn.execute("DELETE FROM metric_buckets WHERE service_id = 'payments';")
        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors, latency_hist, created_at
            ) VALUES ('payments', ?, 100, 20, ?, ?);
            """,
            (t0.isoformat(), json.dumps(h_slow), t0.isoformat()),
        )
        st_dual = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=10))
        assert st_dual["status"] == "red"
        assert st_dual["label"] == "Failing"
        # breaches() helper returns both active breaches
        active = breaches(conn, "payments", now=t0 + timedelta(seconds=10))
        assert "error_rate" in active
        assert "latency" in active


def test_strict_threshold_boundary_equal_is_not_a_breach(tmp_path: Path) -> None:
    """Strict boundaries: error rate of exactly 5.0% or p95 of exactly 800.0ms is NOT a breach."""
    db_file = tmp_path / "test_boundary.db"
    seed(db_file)
    t0 = datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC)

    with get_db(db_file) as conn:
        conn.execute("DELETE FROM metric_buckets WHERE service_id = 'payments';")
        # Exactly 5 errors on 100 requests = 5.0% error rate (threshold is 5.0%)
        # Latencies in bin 6 [100-150ms]
        h = [0] * HIST_BIN_COUNT
        h[6] = 100
        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors, latency_hist, created_at
            ) VALUES ('payments', ?, 100, 5, ?, ?);
            """,
            (t0.isoformat(), json.dumps(h), t0.isoformat()),
        )

        st = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=10))
        assert st["status"] == "green"
        assert st["label"] == "Healthy"
        assert breaches(conn, "payments", now=t0 + timedelta(seconds=10)) == []


def test_history_emits_nulls_for_missing_minutes(tmp_path: Path) -> None:
    """Time-series history returns continuous minute points with nulls for empty minutes."""
    db_file = tmp_path / "test_hist_gaps.db"
    seed(db_file)
    now = datetime(2026, 10, 6, 12, 15, 0, tzinfo=UTC)

    conn = get_connection(db_file)
    try:
        # Delete data for payments to test empty timeline
        conn.execute("DELETE FROM metric_buckets WHERE service_id = 'payments';")
        h_data = history(conn, minutes=15, service_id="payments", now=now)

        assert len(h_data) == 15
        for pt in h_data:
            assert pt["requests"] == 0
            assert pt["p50"] is None
            assert pt["p95"] is None
            assert pt["success_pct"] is None
    finally:
        conn.close()


def test_product_filter_on_overview_and_history(tmp_path: Path) -> None:
    """Overview and history filter by product ('website', 'app', 'admin_console')."""
    db_file = tmp_path / "test_product_filter.db"
    seed(db_file)
    now = datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC)

    conn = get_connection(db_file)
    try:
        ov_all = overview(conn, minutes=60, now=now)
        ov_app = overview(conn, minutes=60, product="app", now=now)

        assert ov_all["registered_users"] == 200
        assert ov_app["registered_users"] < 200
        assert ov_app["registered_users"] > 0
        assert ov_app["product_filter"] == "app"
    finally:
        conn.close()


def test_active_user_window_setting(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Active user count reflects settings.active_user_window_m."""
    from backend.config import settings

    db_file = tmp_path / "test_active_window.db"
    seed(db_file)
    now = datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC)
    twelve_m_ago = (now - timedelta(minutes=12)).isoformat()

    conn = get_connection(db_file)
    try:
        # Clear all user last_seen_at and insert users seen 12 minutes ago
        conn.execute("UPDATE app_users SET last_seen_at = ?", (twelve_m_ago,))
        conn.commit()

        # Window = 15m -> 12 minutes ago is active
        monkeypatch.setattr(settings, "active_user_window_m", 15)
        ov_15 = overview(conn, minutes=60, now=now)
        assert ov_15["active_users"] == 200

        # Window = 10m -> 12 minutes ago is inactive (0 active)
        monkeypatch.setattr(settings, "active_user_window_m", 10)
        ov_10 = overview(conn, minutes=60, now=now)
        assert ov_10["active_users"] == 0
    finally:
        conn.close()
