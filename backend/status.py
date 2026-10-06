"""Service status evaluation engine: health checks, stale detection, and active breaches."""

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from backend.metrics import merge_hists, percentile


def get_service_thresholds(conn: sqlite3.Connection, service_id: str) -> dict[str, Any]:
    """Retrieve configured monitoring thresholds for a given service."""
    row = conn.execute(
        """
        SELECT max_error_pct, max_p95_ms, stale_after_s
        FROM thresholds
        WHERE service_id = ?;
        """,
        (service_id,),
    ).fetchone()

    if row:
        return {
            "max_error_pct": float(row["max_error_pct"]),
            "max_p95_ms": float(row["max_p95_ms"]),
            "stale_after_s": int(row["stale_after_s"]),
        }
    return {
        "max_error_pct": 5.0,
        "max_p95_ms": 800.0,
        "stale_after_s": 180,
    }


def evaluate_service_status(
    conn: sqlite3.Connection,
    service_id: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Evaluate service health status in strict priority order with clock injection.

    Order:
      1. No buckets or newest bucket > stale_after_s -> gray ("No data" / "Stale")
      2. Last 3 buckets have zero total requests -> gray ("No data")
      3. Error % > max_error_pct -> red ("Failing")
      4. p95 > max_p95_ms -> red ("Slow")
      5. Otherwise -> green ("Healthy")
    """
    eval_now = now or datetime.now(UTC)
    thresholds = get_service_thresholds(conn, service_id)
    max_error_pct = thresholds["max_error_pct"]
    max_p95_ms = thresholds["max_p95_ms"]
    stale_after_s = thresholds["stale_after_s"]

    # Query the newest 3 minute buckets up to evaluation time
    rows = conn.execute(
        """
        SELECT bucket_start, requests, errors, latency_hist
        FROM metric_buckets
        WHERE service_id = ? AND bucket_start <= ?
        ORDER BY bucket_start DESC
        LIMIT 3;
        """,
        (service_id, eval_now.isoformat()),
    ).fetchall()

    # Rule 1: No telemetry buckets exist
    if not rows:
        return {
            "status": "gray",
            "label": "No data",
            "reason": "No telemetry buckets reported",
            "error_pct": None,
            "p95": None,
            "requests": 0,
            "newest_bucket": None,
        }

    # Rule 1 (cont): Check freshness of the newest sample
    newest_bucket_str = rows[0]["bucket_start"]
    newest_dt = datetime.fromisoformat(newest_bucket_str)
    if newest_dt.tzinfo is None:
        newest_dt = newest_dt.replace(tzinfo=UTC)

    age_seconds = (eval_now - newest_dt).total_seconds()
    if age_seconds > stale_after_s:
        return {
            "status": "gray",
            "label": "Stale",
            "reason": f"Newest sample is {int(age_seconds)}s old (limit {stale_after_s}s)",
            "error_pct": None,
            "p95": None,
            "requests": sum(r["requests"] for r in rows),
            "newest_bucket": newest_bucket_str,
        }

    # Rule 2: Zero requests across the last 3 buckets
    total_requests = sum(r["requests"] for r in rows)
    total_errors = sum(r["errors"] for r in rows)

    if total_requests == 0:
        return {
            "status": "gray",
            "label": "No data",
            "reason": "Zero traffic in recent evaluation window",
            "error_pct": None,
            "p95": None,
            "requests": 0,
            "newest_bucket": newest_bucket_str,
        }

    # Merge histograms and evaluate metrics across recent window
    error_pct = round((total_errors / total_requests) * 100.0, 2)

    hists = []
    for r in rows:
        raw_hist = r["latency_hist"]
        if raw_hist:
            try:
                parsed = json.loads(raw_hist) if isinstance(raw_hist, str) else raw_hist
                if isinstance(parsed, list):
                    hists.append(parsed)
            except Exception:
                pass

    merged = merge_hists(hists)
    p95 = percentile(merged, 95.0)

    # Rule 3: Error % strictly exceeds threshold (Failing)
    if error_pct > max_error_pct:
        return {
            "status": "red",
            "label": "Failing",
            "reason": f"Error rate {error_pct:.2f}% exceeds threshold {max_error_pct:.2f}%",
            "error_pct": error_pct,
            "p95": p95,
            "requests": total_requests,
            "newest_bucket": newest_bucket_str,
        }

    # Rule 4: p95 latency strictly exceeds threshold (Slow)
    if p95 is not None and p95 > max_p95_ms:
        return {
            "status": "red",
            "label": "Slow",
            "reason": f"p95 latency {p95:.1f}ms exceeds threshold {max_p95_ms:.1f}ms",
            "error_pct": error_pct,
            "p95": p95,
            "requests": total_requests,
            "newest_bucket": newest_bucket_str,
        }

    # Rule 5: Healthy
    return {
        "status": "green",
        "label": "Healthy",
        "reason": "Operating within thresholds",
        "error_pct": error_pct,
        "p95": p95,
        "requests": total_requests,
        "newest_bucket": newest_bucket_str,
    }


def breaches(
    conn: sqlite3.Connection,
    service_id: str,
    now: datetime | None = None,
) -> list[str]:
    """Return all active breach types for a service: 'error_rate', 'latency', 'stale'."""
    eval_now = now or datetime.now(UTC)
    thresholds = get_service_thresholds(conn, service_id)
    max_error_pct = thresholds["max_error_pct"]
    max_p95_ms = thresholds["max_p95_ms"]
    stale_after_s = thresholds["stale_after_s"]

    rows = conn.execute(
        """
        SELECT bucket_start, requests, errors, latency_hist
        FROM metric_buckets
        WHERE service_id = ? AND bucket_start <= ?
        ORDER BY bucket_start DESC
        LIMIT 3;
        """,
        (service_id, eval_now.isoformat()),
    ).fetchall()

    if not rows:
        return ["stale"]

    newest_bucket_str = rows[0]["bucket_start"]
    newest_dt = datetime.fromisoformat(newest_bucket_str)
    if newest_dt.tzinfo is None:
        newest_dt = newest_dt.replace(tzinfo=UTC)

    if (eval_now - newest_dt).total_seconds() > stale_after_s:
        return ["stale"]

    total_requests = sum(r["requests"] for r in rows)
    if total_requests == 0:
        return []

    active_breaches: list[str] = []
    total_errors = sum(r["errors"] for r in rows)
    error_pct = (total_errors / total_requests) * 100.0

    if error_pct > max_error_pct:
        active_breaches.append("error_rate")

    hists = []
    for r in rows:
        raw_hist = r["latency_hist"]
        if raw_hist:
            try:
                parsed = json.loads(raw_hist) if isinstance(raw_hist, str) else raw_hist
                if isinstance(parsed, list):
                    hists.append(parsed)
            except Exception:
                pass

    merged = merge_hists(hists)
    p95 = percentile(merged, 95.0)

    if p95 is not None and p95 > max_p95_ms:
        active_breaches.append("latency")

    return active_breaches
