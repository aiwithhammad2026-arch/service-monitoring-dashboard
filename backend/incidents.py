"""Incident state machine, deduplication engine, and lifecycle management."""

import sqlite3
from datetime import UTC, datetime
from typing import Any

from backend.audit import write as audit_write
from backend.errors import ConflictError, NotFoundError
from backend.status import get_service_thresholds

INCIDENT_TYPES = ("error_rate", "latency", "stale")
ACTIVE_STATUSES = ("open", "acknowledged", "recovered")


def get_active_incident(
    conn: sqlite3.Connection,
    service_id: str,
    incident_type: str,
) -> sqlite3.Row | None:
    """Find the current active (non-resolved) incident for a service and breach type."""
    return conn.execute(
        """
        SELECT id, service_id, type, status, healthy_streak, last_bucket,
               summary, opened_at, acknowledged_at, recovered_at, resolved_at,
               created_at, updated_at
        FROM incidents
        WHERE service_id = ? AND type = ? AND status != 'resolved'
        LIMIT 1;
        """,
        (service_id, incident_type),
    ).fetchone()


def get_incident(conn: sqlite3.Connection, incident_id: int) -> sqlite3.Row | None:
    """Retrieve an incident by primary key."""
    return conn.execute(
        """
        SELECT id, service_id, type, status, healthy_streak, last_bucket,
               summary, opened_at, acknowledged_at, recovered_at, resolved_at,
               created_at, updated_at
        FROM incidents
        WHERE id = ?;
        """,
        (incident_id,),
    ).fetchone()


def add_timeline_event(
    conn: sqlite3.Connection,
    incident_id: int,
    event_type: str,
    from_status: str | None,
    to_status: str | None,
    actor: str,
    message: str,
    created_at: str | None = None,
) -> int:
    """Insert a single chronological event into the incident timeline."""
    ts = created_at or datetime.now(UTC).isoformat()
    cursor = conn.execute(
        """
        INSERT INTO incident_events (
            incident_id, event_type, from_status, to_status, actor, message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
        """,
        (incident_id, event_type, from_status, to_status, actor, message, ts),
    )
    return cursor.lastrowid or 0


def _evaluate_bucket_breach(
    bucket_row: sqlite3.Row | None,
    thresholds: dict[str, Any],
    eval_now: datetime,
    breach_type: str,
) -> tuple[bool, str]:
    """Check if the latest telemetry bucket constitutes a breach for breach_type.

    Returns (is_breached, summary_message).
    """
    max_error_pct = thresholds.get("max_error_pct", 5.0)
    max_p95_ms = thresholds.get("max_p95_ms", 800.0)
    stale_after_s = thresholds.get("stale_after_s", 180)

    if bucket_row is None:
        if breach_type == "stale":
            return (
                True,
                f"Telemetry is stale (no buckets found; limit {stale_after_s}s)",
            )
        return False, ""

    bucket_start = bucket_row["bucket_start"]
    b_dt = datetime.fromisoformat(bucket_start)
    if b_dt.tzinfo is None:
        b_dt = b_dt.replace(tzinfo=UTC)

    age_seconds = (eval_now - b_dt).total_seconds()

    if breach_type == "stale":
        if age_seconds > stale_after_s:
            return (
                True,
                f"Telemetry is stale (newest is {int(age_seconds)}s old; limit {stale_after_s}s)",
            )
        return False, ""

    # If data is stale, error_rate / latency do not process fresh metrics
    if age_seconds > stale_after_s:
        return False, ""

    reqs = bucket_row["requests"]
    errs = bucket_row["errors"]
    p95 = bucket_row["latency_p95"]

    if breach_type == "error_rate":
        if reqs > 0:
            error_pct = (errs / reqs) * 100.0
            if error_pct > max_error_pct:
                return True, f"Error rate {error_pct:.1f}% exceeded threshold {max_error_pct:.1f}%"
        return False, ""

    if breach_type == "latency":
        if p95 is not None and p95 > max_p95_ms:
            return True, f"p95 latency {p95:.1f}ms exceeded threshold {max_p95_ms:.1f}ms"
        return False, ""

    return False, ""


def evaluate(
    conn: sqlite3.Connection,
    now: datetime | None = None,
    written_buckets: list[tuple[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """Evaluate health across all services, managing incident lifecycle and deduplication.

    Runs after simulator ticks inside the same database transaction.
    """
    eval_now = now or datetime.now(UTC)
    now_str = eval_now.isoformat()
    services = conn.execute("SELECT id FROM services ORDER BY id").fetchall()

    processed_events: list[dict[str, Any]] = []

    for svc_row in services:
        svc_id = svc_row["id"]
        thresholds = get_service_thresholds(conn, svc_id)

        # Get newest bucket start for tracking unique bucket progression
        newest_row = conn.execute(
            """
            SELECT bucket_start, requests, errors, latency_p95
            FROM metric_buckets
            WHERE service_id = ? AND bucket_start <= ?
            ORDER BY bucket_start DESC
            LIMIT 1;
            """,
            (svc_id, now_str),
        ).fetchone()
        current_bucket = newest_row["bucket_start"] if newest_row else None

        for b_type in INCIDENT_TYPES:
            is_breached, summary = _evaluate_bucket_breach(newest_row, thresholds, eval_now, b_type)
            active = get_active_incident(conn, svc_id, b_type)

            if is_breached:
                if active is None:
                    # Layer 1: Check in DB. Layer 2: Safety net on unique partial index
                    try:
                        cursor = conn.execute(
                            """
                            INSERT INTO incidents (
                                service_id, type, status, healthy_streak, last_bucket,
                                summary, opened_at, created_at, updated_at
                            ) VALUES (?, ?, 'open', 0, ?, ?, ?, ?, ?);
                            """,
                            (
                                svc_id,
                                b_type,
                                current_bucket,
                                summary,
                                now_str,
                                now_str,
                                now_str,
                            ),
                        )
                        inc_id = cursor.lastrowid
                        if inc_id:
                            add_timeline_event(
                                conn,
                                inc_id,
                                event_type="opened",
                                from_status=None,
                                to_status="open",
                                actor="system",
                                message=summary,
                                created_at=now_str,
                            )
                            processed_events.append({
                                "incident_id": inc_id,
                                "event": "opened",
                                "service_id": svc_id,
                                "type": b_type,
                            })
                    except sqlite3.IntegrityError:
                        # Safety net: Concurrent insert caught by partial unique index
                        active = get_active_incident(conn, svc_id, b_type)
                        if active:
                            conn.execute(
                                """
                                UPDATE incidents
                                SET healthy_streak = 0, last_bucket = ?, updated_at = ?
                                WHERE id = ?
                                """,
                                (current_bucket, now_str, active["id"]),
                            )

                elif active["status"] == "recovered":
                    # Breach recurring on a recovered incident -> reopen same incident
                    conn.execute(
                        """
                        UPDATE incidents
                        SET status = 'open', healthy_streak = 0, last_bucket = ?, updated_at = ?
                        WHERE id = ?;
                        """,
                        (current_bucket, now_str, active["id"]),
                    )
                    add_timeline_event(
                        conn,
                        active["id"],
                        event_type="reopened",
                        from_status="recovered",
                        to_status="open",
                        actor="system",
                        message=f"Breach recurred: {summary}",
                        created_at=now_str,
                    )
                    processed_events.append({
                        "incident_id": active["id"],
                        "event": "reopened",
                        "service_id": svc_id,
                        "type": b_type,
                    })
                else:
                    # Ongoing breach on open/acknowledged incident -> reset streak, no new events
                    conn.execute(
                        """
                        UPDATE incidents
                        SET healthy_streak = 0, last_bucket = ?, updated_at = ?
                        WHERE id = ?;
                        """,
                        (current_bucket, now_str, active["id"]),
                    )

            else:
                # Metric is healthy
                if active and active["status"] in ("open", "acknowledged"):
                    # Only advance streak when a NEW minute bucket has arrived
                    if current_bucket is not None and current_bucket != active["last_bucket"]:
                        new_streak = active["healthy_streak"] + 1
                        if new_streak >= 3:
                            # 3 consecutive healthy new buckets -> recovered
                            old_status = active["status"]
                            conn.execute(
                                """
                                UPDATE incidents
                                SET status = 'recovered', healthy_streak = ?, last_bucket = ?,
                                    recovered_at = ?, updated_at = ?
                                WHERE id = ?;
                                """,
                                (new_streak, current_bucket, now_str, now_str, active["id"]),
                            )
                            add_timeline_event(
                                conn,
                                active["id"],
                                event_type="recovered",
                                from_status=old_status,
                                to_status="recovered",
                                actor="system",
                                message="Recovered after 3 consecutive healthy telemetry buckets",
                                created_at=now_str,
                            )
                            processed_events.append({
                                "incident_id": active["id"],
                                "event": "recovered",
                                "service_id": svc_id,
                                "type": b_type,
                            })
                        else:
                            conn.execute(
                                """
                                UPDATE incidents
                                SET healthy_streak = ?, last_bucket = ?, updated_at = ?
                                WHERE id = ?;
                                """,
                                (new_streak, current_bucket, now_str, active["id"]),
                            )

    return processed_events


def acknowledge_incident(
    conn: sqlite3.Connection,
    incident_id: int,
    actor: str,
    ip: str | None = None,
) -> dict[str, Any]:
    """Acknowledge an open incident (admin action)."""
    inc = get_incident(conn, incident_id)
    if not inc:
        raise NotFoundError(f"Incident {incident_id} not found")

    if inc["status"] != "open":
        raise ConflictError(
            f"Cannot acknowledge incident {incident_id} with status '{inc['status']}'. "
            "Only 'open' incidents can be acknowledged."
        )

    now_str = datetime.now(UTC).isoformat()
    conn.execute(
        """
        UPDATE incidents
        SET status = 'acknowledged', acknowledged_at = ?, updated_at = ?
        WHERE id = ?;
        """,
        (now_str, now_str, incident_id),
    )

    add_timeline_event(
        conn,
        incident_id,
        event_type="acknowledged",
        from_status="open",
        to_status="acknowledged",
        actor=actor,
        message=f"Incident acknowledged by {actor}",
        created_at=now_str,
    )

    audit_write(
        conn,
        actor=actor,
        action="incident_acknowledge",
        target_type="incident",
        target_id=str(incident_id),
        old={"status": "open"},
        new={"status": "acknowledged"},
        ip=ip,
    )

    return dict(get_incident(conn, incident_id))  # type: ignore[arg-type]


def resolve_incident(
    conn: sqlite3.Connection,
    incident_id: int,
    actor: str,
    ip: str | None = None,
) -> dict[str, Any]:
    """Resolve an incident (admin action from open, acknowledged, or recovered)."""
    inc = get_incident(conn, incident_id)
    if not inc:
        raise NotFoundError(f"Incident {incident_id} not found")

    if inc["status"] == "resolved":
        raise ConflictError(f"Incident {incident_id} is already resolved.")

    if inc["status"] not in ("open", "acknowledged", "recovered"):
        raise ConflictError(
            f"Cannot resolve incident {incident_id} with status '{inc['status']}'."
        )

    old_status = inc["status"]
    now_str = datetime.now(UTC).isoformat()
    conn.execute(
        """
        UPDATE incidents
        SET status = 'resolved', resolved_at = ?, updated_at = ?
        WHERE id = ?;
        """,
        (now_str, now_str, incident_id),
    )

    add_timeline_event(
        conn,
        incident_id,
        event_type="resolved",
        from_status=old_status,
        to_status="resolved",
        actor=actor,
        message=f"Incident resolved by {actor}",
        created_at=now_str,
    )

    audit_write(
        conn,
        actor=actor,
        action="incident_resolve",
        target_type="incident",
        target_id=str(incident_id),
        old={"status": old_status},
        new={"status": "resolved"},
        ip=ip,
    )

    return dict(get_incident(conn, incident_id))  # type: ignore[arg-type]


def add_incident_note(
    conn: sqlite3.Connection,
    incident_id: int,
    actor: str,
    message: str,
    ip: str | None = None,
) -> dict[str, Any]:
    """Add a timeline note to an incident."""
    inc = get_incident(conn, incident_id)
    if not inc:
        raise NotFoundError(f"Incident {incident_id} not found")

    now_str = datetime.now(UTC).isoformat()
    add_timeline_event(
        conn,
        incident_id,
        event_type="note",
        from_status=inc["status"],
        to_status=inc["status"],
        actor=actor,
        message=message,
        created_at=now_str,
    )

    audit_write(
        conn,
        actor=actor,
        action="incident_note",
        target_type="incident",
        target_id=str(incident_id),
        old=None,
        new={"note": message},
        ip=ip,
    )

    return {"status": "ok", "incident_id": incident_id, "message": message}
