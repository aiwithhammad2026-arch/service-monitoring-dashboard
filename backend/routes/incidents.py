"""Incidents API endpoints: list, detail with timeline, and lifecycle transitions."""

from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from backend.auth import get_client_ip, get_current_user, require_role
from backend.db import get_db
from backend.errors import NotFoundError, ValidationError
from backend.incidents import acknowledge_incident, get_incident, resolve_incident

router = APIRouter()

ALLOWED_STATUSES = {"all", "open", "acknowledged", "recovered", "resolved"}


@router.get("")
async def list_incidents(
    status: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1),
    user: dict[str, Any] = Depends(get_current_user),  # noqa: ARG008
) -> dict[str, Any]:
    """Retrieve paginated incidents filtered by status."""
    if status not in ALLOWED_STATUSES:
        allowed_str = ", ".join(sorted(ALLOWED_STATUSES))
        raise ValidationError(
            f"Invalid incident status '{status}'. Allowed statuses: {allowed_str}"
        )

    effective_page_size = min(page_size, 100)

    with get_db() as conn:
        count_sql = "SELECT COUNT(*) as total FROM incidents WHERE 1=1"
        data_sql = """
            SELECT id, service_id, type, status, healthy_streak, last_bucket,
                   summary, opened_at, acknowledged_at, recovered_at, resolved_at,
                   created_at, updated_at
            FROM incidents
            WHERE 1=1
        """
        params: list[Any] = []

        if status != "all":
            count_sql += " AND status = ?"
            data_sql += " AND status = ?"
            params.append(status)

        total = conn.execute(count_sql, tuple(params)).fetchone()["total"]

        data_sql += " ORDER BY opened_at DESC LIMIT ? OFFSET ?;"
        offset = (page - 1) * effective_page_size
        rows = conn.execute(data_sql, (*params, effective_page_size, offset)).fetchall()

        pages = (total + effective_page_size - 1) // effective_page_size if total > 0 else 1

        return {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": effective_page_size,
            "pages": pages,
        }


@router.get("/{incident_id}")
async def get_incident_detail(
    incident_id: int,
    user: dict[str, Any] = Depends(get_current_user),  # noqa: ARG008
) -> dict[str, Any]:
    """Retrieve full incident details and its chronological event timeline."""
    with get_db() as conn:
        inc = get_incident(conn, incident_id)
        if not inc:
            raise NotFoundError(f"Incident {incident_id} not found")

        events = conn.execute(
            """
            SELECT id, incident_id, event_type, from_status, to_status,
                   actor, message, created_at
            FROM incident_events
            WHERE incident_id = ?
            ORDER BY id ASC;
            """,
            (incident_id,),
        ).fetchall()

        return {
            "incident": dict(inc),
            "timeline": [dict(e) for e in events],
        }


@router.post("/{incident_id}/ack")
async def ack_incident(
    incident_id: int,
    request: Request,
    admin: dict[str, Any] = Depends(require_role("admin")),
) -> dict[str, Any]:
    """Acknowledge an open incident (admin action)."""
    client_ip = get_client_ip(request)

    with get_db() as conn:
        updated = acknowledge_incident(
            conn,
            incident_id=incident_id,
            actor=admin["username"],
            ip=client_ip,
        )
        return {"status": "ok", "incident": updated}


@router.post("/{incident_id}/resolve")
async def resolve_existing_incident(
    incident_id: int,
    request: Request,
    admin: dict[str, Any] = Depends(require_role("admin")),
) -> dict[str, Any]:
    """Resolve an incident (admin action from open, acknowledged, or recovered)."""
    client_ip = get_client_ip(request)

    with get_db() as conn:
        updated = resolve_incident(
            conn,
            incident_id=incident_id,
            actor=admin["username"],
            ip=client_ip,
        )
        return {"status": "ok", "incident": updated}
