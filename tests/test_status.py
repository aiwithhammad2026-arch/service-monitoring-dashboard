"""Tests for service health status engine.

Tests health checks, stale detection, and threshold precedence.
"""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from backend.db import get_connection
from backend.metrics import HIST_BIN_COUNT
from backend.seed import seed
from backend.status import breaches, evaluate_service_status, get_service_thresholds


def test_status_fresh_within_thresholds_is_green_healthy(tmp_path: Path) -> None:
    """Fresh minute buckets within thresholds evaluate to green (Healthy)."""
    db_file = tmp_path / "test_status.db"
    seed(db_file)

    t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
    h_normal = [0] * HIST_BIN_COUNT
    h_normal[5] = 100  # 75-100ms latency, well below 800ms threshold

    with get_connection(db_file) as conn:
        for i in range(3):
            bucket_time = t0 - timedelta(minutes=i)
            conn.execute(
                """
                INSERT INTO metric_buckets (
                    service_id, bucket_start, requests, errors, latency_hist, created_at
                )
                VALUES ('payments', ?, 100, 1, ?, ?);
                """,
                (bucket_time.isoformat(), json.dumps(h_normal), bucket_time.isoformat()),
            )

        # Fresh evaluation at t0 + 30s (< stale_after_s 180s)
        eval_now = t0 + timedelta(seconds=30)
        result = evaluate_service_status(conn, "payments", now=eval_now)

        assert result["status"] == "green"
        assert result["label"] == "Healthy"
        assert result["error_pct"] == 1.0
        assert result["p95"] is not None and result["p95"] < 200.0


def test_status_fake_clock_past_stale_after_s_is_gray_stale(tmp_path: Path) -> None:
    """Advancing clock past stale_after_s turns service status to gray (Stale)."""
    db_file = tmp_path / "test_status.db"
    seed(db_file)

    t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
    h = [0] * HIST_BIN_COUNT
    h[5] = 100

    with get_connection(db_file) as conn:
        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors, latency_hist, created_at
            )
            VALUES ('payments', ?, 100, 1, ?, ?);
            """,
            (t0.isoformat(), json.dumps(h), t0.isoformat()),
        )

        thresholds = get_service_thresholds(conn, "payments")
        stale_limit = thresholds["stale_after_s"]  # default 180s

        # 1. Fresh clock: 60s elapsed (< 180s) -> green Healthy
        res_fresh = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=60))
        assert res_fresh["status"] == "green"
        assert res_fresh["label"] == "Healthy"

        # 2. Stale clock: 181s elapsed (> 180s) -> gray Stale
        res_stale = evaluate_service_status(
            conn, "payments", now=t0 + timedelta(seconds=stale_limit + 1)
        )
        assert res_stale["status"] == "gray"
        assert res_stale["label"] == "Stale"
        assert f"limit {stale_limit}s" in res_stale["reason"]


def test_status_zero_traffic_across_window_is_gray_no_data(tmp_path: Path) -> None:
    """Service reporting zero requests across last 3 buckets evaluates to gray (No data)."""
    db_file = tmp_path / "test_status.db"
    seed(db_file)

    t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
    empty_h = [0] * HIST_BIN_COUNT

    with get_connection(db_file) as conn:
        for i in range(3):
            bucket_time = t0 - timedelta(minutes=i)
            conn.execute(
                """
                INSERT INTO metric_buckets (
                    service_id, bucket_start, requests, errors, latency_hist, created_at
                )
                VALUES ('payments', ?, 0, 0, ?, ?);
                """,
                (bucket_time.isoformat(), json.dumps(empty_h), bucket_time.isoformat()),
            )

        res = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=10))
        assert res["status"] == "gray"
        assert res["label"] == "No data"
        assert res["error_pct"] is None
        assert res["p95"] is None


def test_status_error_rate_breach_is_red_failing(tmp_path: Path) -> None:
    """Error percentage exceeding max_error_pct turns service status to red (Failing)."""
    db_file = tmp_path / "test_status.db"
    seed(db_file)

    t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
    h = [0] * HIST_BIN_COUNT
    h[5] = 100

    with get_connection(db_file) as conn:
        # 40 errors out of 100 requests = 40.0% error rate (threshold is 5.0%)
        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors, latency_hist, created_at
            )
            VALUES ('payments', ?, 100, 40, ?, ?);
            """,
            (t0.isoformat(), json.dumps(h), t0.isoformat()),
        )

        res = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=10))
        assert res["status"] == "red"
        assert res["label"] == "Failing"
        assert res["error_pct"] == 40.0
        assert "Error rate" in res["reason"]


def test_status_latency_breach_is_red_slow(tmp_path: Path) -> None:
    """p95 latency exceeding max_p95_ms turns service status to red (Slow)."""
    db_file = tmp_path / "test_status.db"
    seed(db_file)

    t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
    h_slow = [0] * HIST_BIN_COUNT
    h_slow[14] = 100  # 1500-2000ms latency, breaches 800ms threshold

    with get_connection(db_file) as conn:
        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors, latency_hist, created_at
            )
            VALUES ('payments', ?, 100, 1, ?, ?);
            """,
            (t0.isoformat(), json.dumps(h_slow), t0.isoformat()),
        )

        res = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=10))
        assert res["status"] == "red"
        assert res["label"] == "Slow"
        assert res["p95"] is not None and res["p95"] > 1500.0
        assert "p95 latency" in res["reason"]


def test_status_precedence_failing_beats_slow_when_both_breached(tmp_path: Path) -> None:
    """When both error rate and latency are breached, Failing takes precedence over Slow."""
    db_file = tmp_path / "test_status.db"
    seed(db_file)

    t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
    h_slow = [0] * HIST_BIN_COUNT
    h_slow[14] = 100

    with get_connection(db_file) as conn:
        # Both 40% errors and 1600ms latency
        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors, latency_hist, created_at
            )
            VALUES ('payments', ?, 100, 40, ?, ?);
            """,
            (t0.isoformat(), json.dumps(h_slow), t0.isoformat()),
        )

        res = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=10))
        assert res["status"] == "red"
        assert res["label"] == "Failing"

        # breaches() helper reports both active breach conditions
        active_breaches = breaches(conn, "payments", now=t0 + timedelta(seconds=10))
        assert "error_rate" in active_breaches
        assert "latency" in active_breaches


def test_status_strict_threshold_boundaries_are_healthy(tmp_path: Path) -> None:
    """Comparisons are strictly greater than (>): exact equality remains Healthy."""
    db_file = tmp_path / "test_status.db"
    seed(db_file)

    t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
    h = [0] * HIST_BIN_COUNT
    h[5] = 100

    with get_connection(db_file) as conn:
        # Set threshold to exact 5.0% and insert exactly 5 errors / 100 requests = 5.0%
        conn.execute(
            "UPDATE thresholds SET max_error_pct = 5.0 WHERE service_id = 'payments';"
        )
        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors, latency_hist, created_at
            )
            VALUES ('payments', ?, 100, 5, ?, ?);
            """,
            (t0.isoformat(), json.dumps(h), t0.isoformat()),
        )

        res = evaluate_service_status(conn, "payments", now=t0 + timedelta(seconds=10))
        assert res["status"] == "green"
        assert res["label"] == "Healthy"
