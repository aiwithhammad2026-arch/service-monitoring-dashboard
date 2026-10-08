"""Vercel Serverless Function entrypoint for FastAPI Service Monitoring Dashboard."""

import os
import sys
from pathlib import Path

# Ensure project root is on Python sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# On Vercel serverless environment, ensure writable DB path in /tmp
if os.getenv("VERCEL") or os.getenv("VERCEL_ENV"):
    if not os.getenv("MD_DB_PATH"):
        os.environ["MD_DB_PATH"] = "/tmp/monitoring.db"

from backend.config import settings  # noqa: E402
from backend.db import get_db, run_migrations  # noqa: E402
from backend.main import app  # noqa: E402
from backend.seed import seed_database  # noqa: E402

# Auto-migrate and seed database on serverless cold-start
try:
    run_migrations()
    with get_db() as conn:
        row = conn.execute("SELECT COUNT(*) FROM services;").fetchone()
        count = row[0] if row else 0
        if count == 0:
            seed_database()
except Exception:
    pass

# Export ASGI app for Vercel
__all__ = ["app"]
