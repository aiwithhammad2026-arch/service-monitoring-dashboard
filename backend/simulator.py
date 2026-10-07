"""Deterministic traffic simulator generating metric buckets and active user telemetry."""

import asyncio
import json
import logging
import random
import sqlite3
from datetime import UTC, datetime

from backend.config import settings
from backend.db import get_db
from backend.metrics import HIST_BIN_COUNT, floor_to_minute, percentile

logger = logging.getLogger("backend.simulator")

# Normal latency weights (centers around bin 6: 100-150ms; p50 ~120ms, p95 ~270ms)
NORMAL_WEIGHTS = [
    0.01,  # <= 5ms
    0.02,  # 5-10ms
    0.04,  # 10-25ms
    0.08,  # 25-50ms
    0.15,  # 50-75ms
    0.25,  # 75-100ms
    0.28,  # 100-150ms
    0.12,  # 150-200ms
    0.03,  # 200-300ms
    0.01,  # 300-400ms
    0.005,  # 400-600ms
    0.003,  # 600-800ms
    0.001,  # 800-1000ms
    0.001,  # 1000-1500ms
    0.000,
    0.000,
    0.000,
    0.000,
]

# Slow latency weights (latency x 6: peak in bins 11-13; p50 ~720ms, p95 ~1600ms > 800ms)
SLOW_WEIGHTS = [
    0.000,  # <= 5ms
    0.000,  # 5-10ms
    0.001,  # 10-25ms
    0.005,  # 25-50ms
    0.010,  # 50-75ms
    0.020,  # 75-100ms
    0.030,  # 100-150ms
    0.050,  # 150-200ms
    0.080,  # 200-300ms
    0.120,  # 300-400ms
    0.180,  # 400-600ms
    0.220,  # 600-800ms
    0.150,  # 800-1000ms
    0.100,  # 1000-1500ms
    0.030,  # 1500-2000ms
    0.004,  # 2000-3000ms
    0.000,  # 3000-5000ms
    0.000,  # > 5000ms
]


def generate_profile_histogram(
    total_requests: int,
    mode: str,
    rng: random.Random,
    recovery_progress: float = 0.0,
) -> list[int]:
    """Generate a 18-bin latency histogram corresponding to the active mode profile."""
    if total_requests <= 0:
        return [0] * HIST_BIN_COUNT

    if mode == "slow":
        target_weights = SLOW_WEIGHTS
    elif mode == "recovering":
        # Linear blend between slow and normal profiles if returning from slow
        blend = min(1.0, max(0.0, recovery_progress))
        target_weights = [
            (1.0 - blend) * SLOW_WEIGHTS[i] + blend * NORMAL_WEIGHTS[i]
            for i in range(HIST_BIN_COUNT)
        ]
    else:
        # Normal and failing use standard latency distribution
        target_weights = NORMAL_WEIGHTS

    w_sum = sum(target_weights)
    norm_w = [w / w_sum for w in target_weights]

    counts = [0] * HIST_BIN_COUNT
    remaining = total_requests

    for i in range(HIST_BIN_COUNT - 1):
        jitter = rng.uniform(0.92, 1.08)
        allocated = int(round(total_requests * norm_w[i] * jitter))
        allocated = min(allocated, remaining)
        counts[i] = allocated
        remaining -= allocated

    # Place residual requests into primary mode peak bin
    peak_idx = 11 if mode == "slow" else 6
    counts[peak_idx] += remaining
    return counts


def get_profile_error_rate(
    mode: str,
    rng: random.Random,
    recovery_progress: float = 0.0,
) -> float:
    """Calculate error percentage based on service mode and recovery progress."""
    if mode == "failing":
        # ~40% errors (red Failing)
        return rng.uniform(0.38, 0.42)
    if mode == "recovering":
        # Linear blend from ~40% back to ~2% over recovery progress
        blend = min(1.0, max(0.0, recovery_progress))
        base_rate = (1.0 - blend) * 0.40 + blend * 0.02
        return max(0.01, min(0.50, base_rate + rng.uniform(-0.005, 0.005)))
    # Normal and Slow: ~2% errors
    return rng.uniform(0.015, 0.025)


def touch_synthetic_users(
    conn: sqlite3.Connection,
    bucket_start: str,
    now: datetime,
    seed: int,
) -> None:
    """Touch a deterministic subset of synthetic app_users so active users dynamically moves."""
    user_rng = random.Random(f"{seed}:users:{bucket_start}")
    # Choose 20 to 35 random user IDs from the 200 seeded accounts
    sample_size = user_rng.randint(20, 35)
    active_ids = user_rng.sample(range(1, 201), k=sample_size)

    now_str = now.isoformat()
    placeholders = ",".join("?" for _ in active_ids)
    conn.execute(
        f"UPDATE app_users SET last_seen_at = ? WHERE id IN ({placeholders});",
        [now_str, *active_ids],
    )


def tick(
    conn: sqlite3.Connection,
    now: datetime | None = None,
    seed: int | None = None,
) -> list[tuple[str, str]]:
    """Synchronous simulation step generating telemetry buckets for the current minute.

    Returns the list of (service_id, bucket_start) tuples written during this tick.
    """
    eval_now = now or datetime.now(UTC)
    bucket_dt = floor_to_minute(eval_now)
    bucket_start = bucket_dt.isoformat()
    effective_seed = seed if seed is not None else settings.sim_seed
    now_str = eval_now.isoformat()

    # Load all service simulation controls
    rows = conn.execute(
        """
        SELECT service_id, mode, paused, reporting_paused, mode_since
        FROM sim_state;
        """
    ).fetchall()

    written_buckets: list[tuple[str, str]] = []

    for r in rows:
        svc_id = r["service_id"]
        mode = r["mode"]
        paused = int(r["paused"])
        reporting_paused = int(r["reporting_paused"])
        mode_since = r["mode_since"]

        # Rule 1: reporting_paused writes NO bucket (data goes stale)
        if reporting_paused == 1:
            continue

        # Rule 2: paused writes zero-request buckets
        if paused == 1:
            empty_hist = json.dumps([0] * HIST_BIN_COUNT)
            conn.execute(
                """
                INSERT INTO metric_buckets (
                    service_id, bucket_start, requests, errors,
                    latency_p50, latency_p95, latency_hist, created_at
                ) VALUES (?, ?, 0, 0, NULL, NULL, ?, ?)
                ON CONFLICT(service_id, bucket_start) DO UPDATE SET
                    requests = 0,
                    errors = 0,
                    latency_p50 = NULL,
                    latency_p95 = NULL,
                    latency_hist = excluded.latency_hist;
                """,
                (svc_id, bucket_start, empty_hist, now_str),
            )
            written_buckets.append((svc_id, bucket_start))
            continue

        # Rule 3: Active traffic generation
        recovery_progress = 0.0
        if mode == "recovering":
            mode_since_dt = datetime.fromisoformat(mode_since)
            if mode_since_dt.tzinfo is None:
                mode_since_dt = mode_since_dt.replace(tzinfo=UTC)
            elapsed_s = (eval_now - mode_since_dt).total_seconds()
            recovery_progress = min(1.0, max(0.0, elapsed_s / 300.0))

            # Auto-switch to normal after 5 minutes (300 seconds)
            if recovery_progress >= 1.0:
                mode = "normal"
                conn.execute(
                    """
                    UPDATE sim_state
                    SET mode = 'normal', mode_since = ?, updated_at = ?
                    WHERE service_id = ?;
                    """,
                    (now_str, now_str, svc_id),
                )
                recovery_progress = 0.0

        # Deterministic random generator keyed by seed, service, and bucket_start
        rng = random.Random(f"{effective_seed}:{svc_id}:{bucket_start}")
        requests = rng.randint(120, 240)

        error_rate = get_profile_error_rate(mode, rng, recovery_progress)
        errors = int(round(requests * error_rate))
        errors = min(errors, requests)  # Enforce CHECK (errors <= requests)

        hist = generate_profile_histogram(requests, mode, rng, recovery_progress)
        p50 = percentile(hist, 50.0)
        p95 = percentile(hist, 95.0)

        conn.execute(
            """
            INSERT INTO metric_buckets (
                service_id, bucket_start, requests, errors,
                latency_p50, latency_p95, latency_hist, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(service_id, bucket_start) DO UPDATE SET
                requests = excluded.requests,
                errors = excluded.errors,
                latency_p50 = excluded.latency_p50,
                latency_p95 = excluded.latency_p95,
                latency_hist = excluded.latency_hist;
            """,
            (svc_id, bucket_start, requests, errors, p50, p95, json.dumps(hist), now_str),
        )
        written_buckets.append((svc_id, bucket_start))

    # Touch synthetic users deterministically
    touch_synthetic_users(conn, bucket_start, eval_now, effective_seed)

    # --------------------------------------------------------------------------
    # TASK 06 HOOK POINT: Incident engine will evaluate newly written buckets here
    # --------------------------------------------------------------------------

    return written_buckets


def tick_and_evaluate(
    conn: sqlite3.Connection,
    now: datetime | None = None,
    seed: int | None = None,
) -> tuple[list[tuple[str, str]], list[dict]]:
    """Run tick() and incident evaluate() sequentially within the same transaction."""
    from backend.incidents import evaluate

    written = tick(conn, now=now, seed=seed)
    events = evaluate(conn, now=now, written_buckets=written)
    return written, events


class SimulatorService:
    """Async background worker running deterministic simulation ticks on an interval."""

    def __init__(self) -> None:
        self.is_running: bool = False
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start background loop if simulator is enabled via MD_SIM_ENABLED."""
        if not settings.sim_enabled:
            logger.info("Simulator disabled (MD_SIM_ENABLED=0).")
            return
        self.is_running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Simulator background service started (tick: %ss).", settings.sim_tick)

    async def stop(self) -> None:
        """Gracefully terminate background simulator loop."""
        self.is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Simulator background service stopped.")

    async def _loop(self) -> None:
        """Internal asynchronous polling loop."""
        while self.is_running:
            try:
                await asyncio.to_thread(self._run_tick)
            except Exception as err:
                logger.error("Simulator tick encountered an error: %s", err, exc_info=True)
            await asyncio.sleep(settings.sim_tick)

    def _run_tick(self) -> list[tuple[str, str]]:
        """Run single synchronous tick + incident evaluation inside a short transaction."""
        from backend.incidents import evaluate

        with get_db() as conn:
            written = tick(conn)
            evaluate(conn, written_buckets=written)
            return written


# Global singleton simulator service
simulator = SimulatorService()

