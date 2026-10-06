"""Tests for database connections, SQL migrations, seed idempotence, and constraints."""

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import bcrypt
import pytest

from backend.db import get_connection, get_db, run_migrations
from backend.seed import ADMIN_HASH, VIEWER_HASH, seed


@pytest.fixture
def temp_db_path(tmp_path: Path) -> Path:
    """Provide a temporary database file path for isolated testing."""
    return tmp_path / "test_monitoring.db"


def test_migrate_twice_applies_nothing_second_time(temp_db_path: Path) -> None:
    """Running migrate twice applies migrations the first time and nothing the second time."""
    # First migration run
    applied_first = run_migrations(temp_db_path)
    assert len(applied_first) == 2
    assert "001_init.sql" in applied_first
    assert "002_indexes.sql" in applied_first

    # Second migration run
    applied_second = run_migrations(temp_db_path)
    assert applied_second == []

    # Verify tracking table in SQLite
    with get_db(temp_db_path) as conn:
        rows = conn.execute("SELECT version FROM schema_migrations ORDER BY version;").fetchall()
        versions = [row["version"] for row in rows]
        assert versions == ["001_init.sql", "002_indexes.sql"]


def test_seed_twice_does_not_duplicate_rows(temp_db_path: Path) -> None:
    """Running seed twice yields identical table row counts and no duplicates."""
    counts_first = seed(temp_db_path)
    assert counts_first["accounts"] == 2
    assert counts_first["services"] == 10
    assert counts_first["thresholds"] == 10
    assert counts_first["sim_state"] == 10
    assert counts_first["app_users"] == 200
    assert counts_first["metric_buckets"] == 600

    # Run seed a second time
    counts_second = seed(temp_db_path)
    assert counts_second == counts_first


def test_inserting_errors_greater_than_requests_fails_check_constraint(temp_db_path: Path) -> None:
    """Inserting errors > requests must fail at the database level with IntegrityError."""
    seed(temp_db_path)
    now_str = datetime.now(UTC).isoformat()

    with get_db(temp_db_path) as conn:
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
            conn.execute(
                """
                INSERT INTO metric_buckets (
                    service_id, bucket_start, requests, errors,
                    latency_p50, latency_p95, latency_hist, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """,
                ("auth", "2026-10-06T12:00:00Z", 100, 105, 120.0, 250.0, "[]", now_str),
            )


def test_second_active_incident_rejected_by_partial_unique_index(temp_db_path: Path) -> None:
    """Enforce one active incident per (service, type) via the partial unique index.

    A second active incident for the same service and type must raise IntegrityError.
    Once the active incident is resolved, a new incident can be opened.
    """
    seed(temp_db_path)
    now_str = datetime.now(UTC).isoformat()

    with get_db(temp_db_path) as conn:
        # First active incident: status = 'open'
        conn.execute(
            """
            INSERT INTO incidents (
                service_id, type, status, healthy_streak, summary,
                opened_at, created_at, updated_at
            ) VALUES (?, ?, 'open', 0, 'Error rate spike', ?, ?, ?);
            """,
            ("payments", "error_rate", now_str, now_str, now_str),
        )

        # Attempting a second active incident for the same (service, type) must fail
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE constraint failed"):
            conn.execute(
                """
                INSERT INTO incidents (
                    service_id, type, status, healthy_streak, summary,
                    opened_at, created_at, updated_at
                ) VALUES (?, ?, 'open', 0, 'Duplicate incident', ?, ?, ?);
                """,
                ("payments", "error_rate", now_str, now_str, now_str),
            )

        # Transition the first incident to 'resolved'
        conn.execute(
            """
            UPDATE incidents
            SET status = 'resolved', resolved_at = ?
            WHERE service_id = ? AND type = ?;
            """,
            (now_str, "payments", "error_rate"),
        )

        # Now opening a new incident for ('payments', 'error_rate') must succeed
        conn.execute(
            """
            INSERT INTO incidents (
                service_id, type, status, healthy_streak, summary,
                opened_at, created_at, updated_at
            ) VALUES (?, ?, 'open', 0, 'Subsequent incident after resolution', ?, ?, ?);
            """,
            ("payments", "error_rate", now_str, now_str, now_str),
        )

        active_count = conn.execute(
            """
            SELECT COUNT(*) as cnt FROM incidents
            WHERE service_id = 'payments' AND type = 'error_rate';
            """
        ).fetchone()["cnt"]
        assert active_count == 2


def test_sqlite_pragmas_and_foreign_keys(temp_db_path: Path) -> None:
    """Verify WAL mode, busy timeout, and foreign key enforcement."""
    run_migrations(temp_db_path)
    conn = get_connection(temp_db_path)
    try:
        journal_mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        assert journal_mode.lower() == "wal"

        foreign_keys = conn.execute("PRAGMA foreign_keys;").fetchone()[0]
        assert foreign_keys == 1

        busy_timeout = conn.execute("PRAGMA busy_timeout;").fetchone()[0]
        assert busy_timeout >= 5000

        # Foreign key violation check
        now_str = datetime.now(UTC).isoformat()
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO thresholds (
                    service_id, max_error_pct, max_p95_ms, stale_after_s, updated_at
                ) VALUES ('non-existent-service', 5.0, 800.0, 180, ?);
                """,
                (now_str,),
            )
    finally:
        conn.close()


def test_demo_password_hashes_cost_12() -> None:
    """Verify demo password hashes use bcrypt cost 12 and match the expected passwords."""
    assert ADMIN_HASH.startswith("$2b$12$")
    assert VIEWER_HASH.startswith("$2b$12$")
    assert bcrypt.checkpw(b"Admin#2026!", ADMIN_HASH.encode()) is True
    assert bcrypt.checkpw(b"Viewer#2026!", VIEWER_HASH.encode()) is True
