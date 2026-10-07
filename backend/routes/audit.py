"""Audit log API endpoint: paginated administrative activity inspection."""

import json
from typing import Any

from fastapi import APIRouter, Depends, Query

from backend.auth import require_role
from backend.db import get_db

router = APIRouter()


@router.get("")
async def get_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1),
    admin: dict[str, Any] = Depends(require_role("admin")),  # noqa: ARG008
) -> dict[str, Any]:
    """Retrieve paginated audit log entries (admin only)."""
    effective_page_size = min(page_size, 100)

    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) as total FROM audit_log;").fetchone()["total"]

        offset = (page - 1) * effective_page_size
        rows = conn.execute(
            """
            SELECT id, actor, action, target_type, target_id, details, created_at
            FROM audit_log
            ORDER BY id DESC
            LIMIT ? OFFSET ?;
            """,
            (effective_page_size, offset),
        ).fetchall()

        items: list[dict[str, Any]] = []
        for r in rows:
            entry = dict(r)
            raw_details = entry.get("details")
            if isinstance(raw_details, str):
                try:
                    entry["details"] = json.loads(raw_details)
                except Exception:
                    pass
            items.append(entry)

        pages = (total + effective_page_size - 1) // effective_page_size if total > 0 else 1

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": effective_page_size,
            "pages": pages,
        }
