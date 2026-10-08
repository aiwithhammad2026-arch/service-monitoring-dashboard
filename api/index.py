"""Vercel Serverless Function entrypoint for FastAPI Service Monitoring Dashboard."""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

# Ensure project root is on Python sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# On Vercel serverless environment, ensure writable DB path in /tmp
if os.getenv("VERCEL") or os.getenv("VERCEL_ENV") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
    if not os.getenv("MD_DB_PATH"):
        os.environ["MD_DB_PATH"] = "/tmp/monitoring.db"
    os.environ["MD_SIM_ENABLED"] = "0"

from backend.db import get_db, run_migrations  # noqa: E402
from backend.main import create_app  # noqa: E402
from backend.seed import seed  # noqa: E402

logger = logging.getLogger("api.index")

# Auto-migrate and seed database on serverless cold-start
try:
    run_migrations()
    with get_db() as conn:
        svc_row = conn.execute("SELECT COUNT(*) FROM services;").fetchone()
        audit_row = conn.execute("SELECT COUNT(*) FROM audit_log;").fetchone()
        svc_count = svc_row[0] if svc_row else 0
        audit_count = audit_row[0] if audit_row else 0
        if svc_count == 0 or audit_count == 0:
            seed()
except Exception as exc:
    logger.warning("Cold-start migration/seed warning: %s", exc)


# Export ASGI app instance configured for Serverless (use_lifespan=False)
app = create_app(use_lifespan=False)

__all__ = ["app"]

