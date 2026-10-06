"""Audit logging module for recording administrative and authentication actions."""

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

# Sensitive keys that must always be masked before writing to the database
SENSITIVE_KEYWORDS = {
    "password",
    "token",
    "secret",
    "cookie",
    "session",
    "authorization",
    "auth",
}


def redact_data(obj: Any) -> Any:
    """Recursively mask sensitive values in dicts, lists, and strings."""
    if isinstance(obj, dict):
        cleaned = {}
        for key, val in obj.items():
            key_str = str(key).lower()
            if any(sensitive in key_str for sensitive in SENSITIVE_KEYWORDS):
                cleaned[key] = "[REDACTED]"
            else:
                cleaned[key] = redact_data(val)
        return cleaned
    if isinstance(obj, list):
        return [redact_data(item) for item in obj]
    return obj


def write(
    conn: sqlite3.Connection,
    actor: str,
    action: str,
    target_type: str,
    target_id: str = "",
    old: Any = None,
    new: Any = None,
    ip: str | None = None,
) -> int:
    """Record an action in audit_log with automatic redaction of sensitive credentials.

    Returns the inserted row ID.
    """
    details_payload = {
        "old": redact_data(old),
        "new": redact_data(new),
        "ip": ip,
    }

    now_utc = datetime.now(UTC).isoformat()
    cursor = conn.execute(
        """
        INSERT INTO audit_log (actor, action, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?);
        """,
        (actor, action, target_type, target_id, json.dumps(details_payload), now_utc),
    )
    return cursor.lastrowid or 0
