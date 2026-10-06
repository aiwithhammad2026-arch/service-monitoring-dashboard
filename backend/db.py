"""SQLite database connection, configuration, and migration management."""

import logging
import sqlite3
import sys
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from backend.config import settings

logger = logging.getLogger("backend.db")

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def get_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Create a configured SQLite database connection.

    Enforces WAL journal mode, active foreign keys, busy timeout, and row factory.
    """
    target_path = Path(db_path) if db_path is not None else settings.db_path

    # Ensure parent directory exists for file-based databases
    if str(target_path) != ":memory:" and target_path.parent:
        target_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(target_path))
    conn.row_factory = sqlite3.Row

    # Performance and integrity pragmas (WAL mode, foreign keys, busy timeout)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    conn.execute("PRAGMA synchronous = NORMAL;")

    return conn


@contextmanager
def get_db(db_path: Path | str | None = None) -> Generator[sqlite3.Connection, None, None]:
    """Context manager for database connections with transaction commit/rollback."""
    conn = get_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def run_migrations(db_path: Path | str | None = None) -> list[str]:
    """Apply all pending migration files in order, recording applied versions.

    Returns the list of applied migration filenames.
    """
    applied: list[str] = []

    with get_db(db_path) as conn:
        # 1. Ensure the migration tracking table exists
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            """
        )

        # 2. Query already applied migrations
        rows = conn.execute("SELECT version FROM schema_migrations;").fetchall()
        applied_versions = {row["version"] for row in rows}

        # 3. Discover and sort migration files
        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

        # 4. Apply each pending migration in order inside the transaction
        for file_path in migration_files:
            version_name = file_path.name
            if version_name not in applied_versions:
                logger.info("Applying migration: %s", version_name)
                sql_content = file_path.read_text(encoding="utf-8")
                conn.executescript(sql_content)

                now_utc = datetime.now(UTC).isoformat()
                conn.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?);",
                    (version_name, now_utc),
                )
                applied.append(version_name)

    return applied


def migrate(db_path: Path | str | None = None) -> list[str]:
    """Run migrations and print results to stdout (used by CLI)."""
    applied = run_migrations(db_path)
    if applied:
        for version in applied:
            print(f"Applied migration: {version}")
    else:
        print("Database is up to date. No pending migrations.")
    return applied


if __name__ == "__main__":
    # Support: python -m backend.db migrate OR python -m backend.db
    command = sys.argv[1] if len(sys.argv) > 1 else "migrate"
    if command == "migrate":
        migrate()
    else:
        print(f"Unknown command '{command}'. Supported commands: migrate")
        sys.exit(1)
