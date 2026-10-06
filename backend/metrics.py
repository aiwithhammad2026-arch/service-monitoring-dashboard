"""Metrics engine: histogram merging, percentiles, aggregations, and telemetry queries."""

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Any

from backend.config import settings

# 18 fixed latency bins (17 finite edges + inf)
LATENCY_BUCKET_EDGES: list[float] = [
    5.0,
    10.0,
    25.0,
    50.0,
    75.0,
    100.0,
    150.0,
    200.0,
    300.0,
    400.0,
    600.0,
    800.0,
    1000.0,
    1500.0,
    2000.0,
    3000.0,
    5000.0,
    float("inf"),
]

HIST_BIN_COUNT = len(LATENCY_BUCKET_EDGES)


def floor_to_minute(dt: datetime) -> datetime:
    """Normalize datetime to UTC with second and microsecond zeroed."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    else:
        dt = dt.astimezone(UTC)
    return dt.replace(second=0, microsecond=0)


def merge_hists(hists: list[list[int]]) -> list[int]:
    """Merge multiple minute histograms bin-wise (exact sum per bin)."""
    if not hists:
        return [0] * HIST_BIN_COUNT
    result = [0] * HIST_BIN_COUNT
    for h in hists:
        for i in range(min(len(h), HIST_BIN_COUNT)):
            result[i] += h[i]
    return result


def percentile(hist: list[int], p: float) -> float | None:
    """Compute interpolated percentile from a latency histogram.

    Finds the bin containing target rank (p / 100 * total) and linearly
    interpolates within [lower, upper]. The +inf bin is capped at 5000ms.
    Returns None if total requests == 0.
    """
    total = sum(hist)
    if total <= 0:
        return None

    if p <= 0:
        return 0.0

    rank = (p / 100.0) * total
    cum = 0

    for i in range(HIST_BIN_COUNT):
        count = hist[i]
        if count == 0:
            continue

        prev_cum = cum
        cum += count

        if rank <= cum:
            # Reached target bin
            if i == 0:
                lower = 0.0
                upper = LATENCY_BUCKET_EDGES[0]
            elif i == HIST_BIN_COUNT - 1:
                # +inf bin capped at the final finite threshold (5000ms)
                return 5000.0
            else:
                lower = LATENCY_BUCKET_EDGES[i - 1]
                upper = LATENCY_BUCKET_EDGES[i]

            # Linear interpolation fraction inside this bin
            fraction = (rank - prev_cum) / count
            val = lower + fraction * (upper - lower)
            return round(val, 1)

    return 5000.0


def approx_raw_latency_sum(hist: list[int]) -> float:
    """Approximate the sum of all latencies using midpoints of histogram bins."""
    total_ms = 0.0
    for i in range(HIST_BIN_COUNT):
        count = hist[i]
        if count <= 0:
            continue
        if i == 0:
            mid = 2.5
        elif i == HIST_BIN_COUNT - 1:
            mid = 5000.0
        else:
            lower = LATENCY_BUCKET_EDGES[i - 1]
            upper = LATENCY_BUCKET_EDGES[i]
            mid = (lower + upper) / 2.0
        total_ms += count * mid
    return total_ms


def summarize(rows: list[Any], total_minutes: int) -> dict[str, Any]:
    """Aggregate a list of metric_buckets rows into dashboard KPI metrics."""
    if total_minutes <= 0:
        total_minutes = 1

    total_requests = 0
    total_errors = 0
    hists_to_merge: list[list[int]] = []

    for r in rows:
        req = r["requests"] if isinstance(r, dict) else r["requests"]
        err = r["errors"] if isinstance(r, dict) else r["errors"]
        total_requests += req
        total_errors += err

        raw_hist = r["latency_hist"] if isinstance(r, dict) else r["latency_hist"]
        if raw_hist:
            try:
                parsed = json.loads(raw_hist) if isinstance(raw_hist, str) else raw_hist
                if isinstance(parsed, list):
                    hists_to_merge.append(parsed)
            except Exception:
                pass

    if total_requests == 0:
        return {
            "requests": 0,
            "errors": 0,
            "rpm": 0.0,
            "success_pct": None,
            "error_pct": None,
            "avg_latency": None,
            "p50": None,
            "p95": None,
        }

    merged = merge_hists(hists_to_merge)
    success_pct = round(((total_requests - total_errors) / total_requests) * 100.0, 2)
    error_pct = round((total_errors / total_requests) * 100.0, 2)
    rpm = round(total_requests / total_minutes, 2)
    avg_latency = round(approx_raw_latency_sum(merged) / total_requests, 1)
    p50 = percentile(merged, 50.0)
    p95 = percentile(merged, 95.0)

    return {
        "requests": total_requests,
        "errors": total_errors,
        "rpm": rpm,
        "success_pct": success_pct,
        "error_pct": error_pct,
        "avg_latency": avg_latency,
        "p50": p50,
        "p95": p95,
    }


def overview(
    conn: sqlite3.Connection,
    minutes: int = 60,
    product: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Generate high-level operations dashboard KPI cards and telemetry overview."""
    eval_now = floor_to_minute(now or datetime.now(UTC))
    start_dt = eval_now - timedelta(minutes=minutes - 1)
    active_window_start = eval_now - timedelta(minutes=settings.active_user_window_m)

    # 1. Registered and Active Users
    user_query = "SELECT COUNT(*) as total FROM app_users WHERE 1=1"
    active_query = "SELECT COUNT(*) as active FROM app_users WHERE last_seen_at >= ?"
    user_params: list[Any] = []
    active_params: list[Any] = [active_window_start.isoformat()]

    if product:
        user_query += " AND product = ?"
        user_params.append(product)
        active_query += " AND product = ?"
        active_params.append(product)

    reg_row = conn.execute(user_query, tuple(user_params)).fetchone()
    registered_users = reg_row["total"] if reg_row else 0

    active_row = conn.execute(active_query, tuple(active_params)).fetchone()
    active_users = active_row["active"] if active_row else 0

    # 2. Telemetry metrics aggregation across services in window
    metric_query = """
        SELECT mb.requests, mb.errors, mb.latency_hist
        FROM metric_buckets mb
        JOIN services s ON s.id = mb.service_id
        WHERE mb.bucket_start >= ? AND mb.bucket_start <= ?
    """
    metric_params: list[Any] = [start_dt.isoformat(), eval_now.isoformat()]

    if product:
        metric_query += " AND s.product = ?"
        metric_params.append(product)

    rows = conn.execute(metric_query, tuple(metric_params)).fetchall()
    summary = summarize(rows, total_minutes=minutes)

    return {
        "registered_users": registered_users,
        "active_users": active_users,
        "time_window_minutes": minutes,
        "product_filter": product,
        **summary,
    }


def history(
    conn: sqlite3.Connection,
    minutes: int = 60,
    service_id: str | None = None,
    product: str | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Return a continuous minute-by-minute time series for charts, emitting nulls for gaps."""
    eval_now = floor_to_minute(now or datetime.now(UTC))
    start_dt = eval_now - timedelta(minutes=minutes - 1)

    query = """
        SELECT mb.bucket_start, mb.requests, mb.errors, mb.latency_hist
        FROM metric_buckets mb
        JOIN services s ON s.id = mb.service_id
        WHERE mb.bucket_start >= ? AND mb.bucket_start <= ?
    """
    params: list[Any] = [start_dt.isoformat(), eval_now.isoformat()]

    if service_id:
        query += " AND mb.service_id = ?"
        params.append(service_id)
    elif product:
        query += " AND s.product = ?"
        params.append(product)

    rows = conn.execute(query, tuple(params)).fetchall()

    # Index rows by bucket_start
    bucket_map: dict[str, list[Any]] = {}
    for r in rows:
        b_start = r["bucket_start"]
        bucket_map.setdefault(b_start, []).append(r)

    # Generate complete timeline without missing minutes
    points: list[dict[str, Any]] = []
    for i in range(minutes):
        current_dt = start_dt + timedelta(minutes=i)
        key = current_dt.isoformat()
        items = bucket_map.get(key, [])

        if not items:
            points.append(
                {
                    "timestamp": key,
                    "requests": 0,
                    "errors": 0,
                    "success_pct": None,
                    "error_pct": None,
                    "p50": None,
                    "p95": None,
                }
            )
        else:
            minute_summary = summarize(items, total_minutes=1)
            points.append(
                {
                    "timestamp": key,
                    "requests": minute_summary["requests"],
                    "errors": minute_summary["errors"],
                    "success_pct": minute_summary["success_pct"],
                    "error_pct": minute_summary["error_pct"],
                    "p50": minute_summary["p50"],
                    "p95": minute_summary["p95"],
                }
            )

    return points
