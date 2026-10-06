"""Database seed script for demo data, services, users, and telemetry buckets."""

import json
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

from backend.db import get_db, run_migrations

# Precomputed bcrypt cost-12 hashes for demo accounts (no plaintext passwords stored here)
ADMIN_HASH = "$2b$12$DZ1AlQs9qYk/o.qU.1sT9.RwyTFRlCqVrNIbXGvBzzsFbUhhT2oBu"
VIEWER_HASH = "$2b$12$7vS9lse0ZN4gsbqQlSiUEeKq1LTu2BHX6Qa9.wYI5HijwnvS3qCvO"

# 10 monitored services distributed across the three platform products
SERVICES_CATALOG = [
    ("web-frontend", "Web Frontend", "website", "Customer-facing web client and landing pages"),
    ("web-cdn", "Web CDN Gateway", "website", "Static asset caching and edge distribution"),
    ("auth", "Authentication Service", "app", "Identity provider, session tokens and OAuth flows"),
    ("search", "Catalog Search", "website", "Product indexing, full-text search and filtering"),
    ("catalog", "Product Catalog", "website", "Product metadata, categories and inventory status"),
    ("payments", "Payment Gateway", "app", "Payment processing, billing and transaction ledger"),
    ("app-api", "Mobile App Core API", "app", "RESTful API backend for mobile application clients"),
    ("app-sync", "Offline Data Sync", "app", "Background sync for offline client state"),
    (
        "notifications",
        "Notification Dispatcher",
        "admin_console",
        "Push notifications, alert fan-out and SMS dispatch",
    ),
    (
        "admin-api",
        "Admin Console API",
        "admin_console",
        "Internal administrative APIs and reporting endpoints",
    ),
]

# Standard fixed-edge latency bins (18 buckets) as specified in the metric architecture
HIST_BIN_COUNT = 18


def generate_normal_histogram(total_requests: int, rng: random.Random) -> list[int]:
    """Generate a realistic normal-profile latency histogram summing exactly to total_requests.

    Normal profile centers around 100-150ms:
    Bins 4 (50-75ms), 5 (75-100ms), 6 (100-150ms), 7 (150-200ms), 8 (200-300ms).
    """
    if total_requests <= 0:
        return [0] * HIST_BIN_COUNT

    weights = [
        0.01,  # <= 5ms
        0.02,  # 5-10ms
        0.04,  # 10-25ms
        0.08,  # 25-50ms
        0.15,  # 50-75ms
        0.25,  # 75-100ms
        0.28,  # 100-150ms (peak mode)
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
    weight_sum = sum(weights)
    norm_weights = [w / weight_sum for w in weights]

    counts = [0] * HIST_BIN_COUNT
    remaining = total_requests

    for i in range(HIST_BIN_COUNT - 1):
        jitter = rng.uniform(0.9, 1.1)
        allocated = int(round(total_requests * norm_weights[i] * jitter))
        allocated = min(allocated, remaining)
        counts[i] = allocated
        remaining -= allocated

    # Put remaining into peak bin (bin 6: 100-150ms)
    counts[6] += remaining
    return counts


def get_table_counts(conn) -> dict[str, int]:
    """Query current row counts for all application tables."""
    tables = [
        "accounts",
        "services",
        "thresholds",
        "sim_state",
        "app_users",
        "metric_buckets",
        "incidents",
        "incident_events",
        "audit_log",
        "sim_meta",
    ]
    counts = {}
    for table in tables:
        row = conn.execute(f"SELECT COUNT(*) as cnt FROM {table};").fetchone()
        counts[table] = row["cnt"] if row else 0
    return counts


def seed(db_path: Path | str | None = None) -> dict[str, int]:
    """Seed the database deterministically and idempotently."""
    # Ensure migrations are applied first
    run_migrations(db_path)

    with get_db(db_path) as conn:
        now_utc = datetime.now(UTC).replace(second=0, microsecond=0)
        now_str = now_utc.isoformat()

        # 1. Deterministic anchor timestamp saved in sim_meta so repeated runs are identical
        meta_row = conn.execute(
            "SELECT value FROM sim_meta WHERE key = 'seed_anchor';"
        ).fetchone()
        if meta_row:
            anchor_dt = datetime.fromisoformat(meta_row["value"])
        else:
            anchor_dt = now_utc
            conn.execute(
                "INSERT INTO sim_meta (key, value, updated_at) VALUES ('seed_anchor', ?, ?);",
                (anchor_dt.isoformat(), now_str),
            )

        # 2. Seed Accounts (admin and viewer with bcrypt cost 12 hashes)
        conn.execute(
            """
            INSERT OR IGNORE INTO accounts (username, password_hash, role, created_at)
            VALUES ('admin', ?, 'admin', ?);
            """,
            (ADMIN_HASH, now_str),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO accounts (username, password_hash, role, created_at)
            VALUES ('viewer', ?, 'viewer', ?);
            """,
            (VIEWER_HASH, now_str),
        )

        # 3. Seed 10 Services
        for svc_id, svc_name, product, desc in SERVICES_CATALOG:
            conn.execute(
                """
                INSERT OR IGNORE INTO services (id, name, product, description, created_at)
                VALUES (?, ?, ?, ?, ?);
                """,
                (svc_id, svc_name, product, desc, now_str),
            )

        # 4. Seed Default Thresholds
        for svc_id, _, _, _ in SERVICES_CATALOG:
            conn.execute(
                """
                INSERT OR IGNORE INTO thresholds (
                    service_id, max_error_pct, max_p95_ms, stale_after_s, updated_at
                ) VALUES (?, 5.0, 800.0, 180, ?);
                """,
                (svc_id, now_str),
            )

        # 5. Seed Initial Simulator State
        for svc_id, _, _, _ in SERVICES_CATALOG:
            conn.execute(
                """
                INSERT OR IGNORE INTO sim_state (
                    service_id, mode, paused, reporting_paused, mode_since, updated_at
                ) VALUES (?, 'normal', 0, 0, ?, ?);
                """,
                (svc_id, now_str, now_str),
            )

        # 6. Seed 200 Synthetic App Users
        products = ["website", "app", "admin_console"]
        user_rng = random.Random(42)
        for i in range(1, 201):
            username = f"user_{i:03d}@example.com"
            product = products[(i - 1) % len(products)]
            # Deterministic account creation 1 to 30 days prior to anchor
            days = user_rng.randint(1, 30)
            minutes = user_rng.randint(0, 1440)
            created_offset = timedelta(days=days, minutes=minutes)
            user_created_at = (anchor_dt - created_offset).isoformat()

            # Active user calculation rule: active if last_seen_at is within 15 minutes
            # Make ~45 users active (< 15m), and ~155 users inactive (> 15m)
            if i <= 45:
                # Active within 1-14 minutes
                active_min = user_rng.randint(1, 14)
                active_sec = user_rng.randint(0, 59)
                last_seen_dt = anchor_dt - timedelta(minutes=active_min, seconds=active_sec)
            else:
                # Inactive (16 minutes to 48 hours ago)
                inactive_min = user_rng.randint(16, 2880)
                last_seen_dt = anchor_dt - timedelta(minutes=inactive_min)

            conn.execute(
                """
                INSERT OR IGNORE INTO app_users (username, product, created_at, last_seen_at)
                VALUES (?, ?, ?, ?);
                """,
                (username, product, user_created_at, last_seen_dt.isoformat()),
            )

        # 7. Seed 60 minutes of back-filled normal telemetry buckets (10 svc * 60 mins = 600)
        for minute_offset in range(59, -1, -1):
            bucket_dt = anchor_dt - timedelta(minutes=minute_offset)
            bucket_start = bucket_dt.isoformat()

            for svc_id, _, _, _ in SERVICES_CATALOG:
                # Deterministic seed per service and minute
                rng = random.Random(f"42:{svc_id}:{bucket_start}")
                requests = rng.randint(120, 240)
                # Normal profile: ~1.5% to 2.5% errors
                error_rate = rng.uniform(0.012, 0.025)
                errors = int(round(requests * error_rate))
                # Ensure CHECK constraint: errors <= requests
                errors = min(errors, requests)

                hist_counts = generate_normal_histogram(requests, rng)
                # Realistic normal p50 ~ 115-125ms, p95 ~ 260-290ms
                latency_p50 = round(rng.uniform(112.0, 126.0), 1)
                latency_p95 = round(rng.uniform(255.0, 285.0), 1)

                conn.execute(
                    """
                    INSERT OR IGNORE INTO metric_buckets (
                        service_id, bucket_start, requests, errors,
                        latency_p50, latency_p95, latency_hist, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        svc_id,
                        bucket_start,
                        requests,
                        errors,
                        latency_p50,
                        latency_p95,
                        json.dumps(hist_counts),
                        now_str,
                    ),
                )

        counts = get_table_counts(conn)
        return counts


if __name__ == "__main__":
    print("Seeding database...")
    result_counts = seed()
    print("Database seed complete.")
    print("Row counts by table:")
    for tbl, count in sorted(result_counts.items()):
        print(f"  {tbl:<18}: {count}")
