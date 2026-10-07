"""Simulator control API endpoints: mode switches, traffic pausing, and reporting pause."""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from backend import audit
from backend.auth import get_client_ip, require_role
from backend.db import get_db
from backend.errors import NotFoundError, ValidationError

router = APIRouter()

ALLOWED_MODES = {"normal", "slow", "failing", "recovering"}


class SimModeRequest(BaseModel):
    """Payload for changing simulator service traffic generation mode."""

    mode: str = Field(..., min_length=1)


class SimPauseRequest(BaseModel):
    """Payload for pausing or resuming service traffic generation."""

    paused: bool


class SimReportingRequest(BaseModel):
    """Payload for pausing or resuming telemetry bucket reporting."""

    reporting_paused: bool


@router.post("/{service_id}/mode")
async def update_sim_mode(
    service_id: str,
    req: SimModeRequest,
    request: Request,
    admin: dict[str, Any] = Depends(require_role("admin")),
) -> dict[str, Any]:
    """Change simulator mode for a service, updating mode_since for recovery calculation."""
    if req.mode not in ALLOWED_MODES:
        allowed_str = ", ".join(sorted(ALLOWED_MODES))
        raise ValidationError(f"Invalid simulator mode '{req.mode}'. Allowed modes: {allowed_str}")

    client_ip = get_client_ip(request)

    with get_db() as conn:
        svc_row = conn.execute(
            "SELECT id FROM services WHERE id = ?;",
            (service_id,),
        ).fetchone()
        if not svc_row:
            raise NotFoundError(f"Service '{service_id}' not found")

        sim_row = conn.execute(
            "SELECT mode, paused, reporting_paused FROM sim_state WHERE service_id = ?;",
            (service_id,),
        ).fetchone()

        old_mode = sim_row["mode"] if sim_row else "normal"
        now_str = datetime.now(UTC).isoformat()

        conn.execute(
            """
            INSERT INTO sim_state (
                service_id, mode, paused, reporting_paused, mode_since, updated_at
            ) VALUES (?, ?, 0, 0, ?, ?)
            ON CONFLICT(service_id) DO UPDATE SET
                mode = excluded.mode,
                mode_since = excluded.mode_since,
                updated_at = excluded.updated_at;
            """,
            (service_id, req.mode, now_str, now_str),
        )

        audit.write(
            conn,
            actor=admin["username"],
            action="sim_mode_change",
            target_type="service",
            target_id=service_id,
            old={"mode": old_mode},
            new={"mode": req.mode, "mode_since": now_str},
            ip=client_ip,
        )

        return {
            "status": "ok",
            "service_id": service_id,
            "mode": req.mode,
            "mode_since": now_str,
        }


@router.post("/{service_id}/pause")
async def update_sim_pause(
    service_id: str,
    req: SimPauseRequest,
    request: Request,
    admin: dict[str, Any] = Depends(require_role("admin")),
) -> dict[str, Any]:
    """Toggle simulator traffic pause (writes zero-traffic buckets when paused)."""
    client_ip = get_client_ip(request)

    with get_db() as conn:
        svc_row = conn.execute(
            "SELECT id FROM services WHERE id = ?;",
            (service_id,),
        ).fetchone()
        if not svc_row:
            raise NotFoundError(f"Service '{service_id}' not found")

        sim_row = conn.execute(
            "SELECT paused FROM sim_state WHERE service_id = ?;",
            (service_id,),
        ).fetchone()

        old_paused = bool(sim_row["paused"]) if sim_row else False
        now_str = datetime.now(UTC).isoformat()
        paused_int = 1 if req.paused else 0

        conn.execute(
            """
            INSERT INTO sim_state (
                service_id, mode, paused, reporting_paused, mode_since, updated_at
            ) VALUES (?, 'normal', ?, 0, ?, ?)
            ON CONFLICT(service_id) DO UPDATE SET
                paused = excluded.paused,
                updated_at = excluded.updated_at;
            """,
            (service_id, paused_int, now_str, now_str),
        )

        audit.write(
            conn,
            actor=admin["username"],
            action="sim_pause",
            target_type="service",
            target_id=service_id,
            old={"paused": old_paused},
            new={"paused": req.paused},
            ip=client_ip,
        )

        return {
            "status": "ok",
            "service_id": service_id,
            "paused": req.paused,
        }


@router.post("/{service_id}/reporting")
async def update_sim_reporting(
    service_id: str,
    req: SimReportingRequest,
    request: Request,
    admin: dict[str, Any] = Depends(require_role("admin")),
) -> dict[str, Any]:
    """Toggle telemetry reporting (pausing causes data to age past stale limit)."""
    client_ip = get_client_ip(request)

    with get_db() as conn:
        svc_row = conn.execute(
            "SELECT id FROM services WHERE id = ?;",
            (service_id,),
        ).fetchone()
        if not svc_row:
            raise NotFoundError(f"Service '{service_id}' not found")

        sim_row = conn.execute(
            "SELECT reporting_paused FROM sim_state WHERE service_id = ?;",
            (service_id,),
        ).fetchone()

        old_reporting = bool(sim_row["reporting_paused"]) if sim_row else False
        now_str = datetime.now(UTC).isoformat()
        reporting_int = 1 if req.reporting_paused else 0

        conn.execute(
            """
            INSERT INTO sim_state (
                service_id, mode, paused, reporting_paused, mode_since, updated_at
            ) VALUES (?, 'normal', 0, ?, ?, ?)
            ON CONFLICT(service_id) DO UPDATE SET
                reporting_paused = excluded.reporting_paused,
                updated_at = excluded.updated_at;
            """,
            (service_id, reporting_int, now_str, now_str),
        )

        audit.write(
            conn,
            actor=admin["username"],
            action="sim_reporting_pause",
            target_type="service",
            target_id=service_id,
            old={"reporting_paused": old_reporting},
            new={"reporting_paused": req.reporting_paused},
            ip=client_ip,
        )

        return {
            "status": "ok",
            "service_id": service_id,
            "reporting_paused": req.reporting_paused,
        }
