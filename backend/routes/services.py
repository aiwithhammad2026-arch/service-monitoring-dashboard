"""Services API endpoints: service status list, service detail, and threshold updates."""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from backend import audit
from backend.auth import get_client_ip, get_current_user, require_role
from backend.db import get_db
from backend.errors import NotFoundError, ValidationError
from backend.status import evaluate_service_status, get_service_thresholds

router = APIRouter()

ALLOWED_STATUSES = {"all", "green", "red", "gray"}
ALLOWED_PRODUCTS = {"all", "website", "app", "admin_console"}


class ThresholdsUpdateRequest(BaseModel):
    """Payload for updating service monitoring thresholds with strict bounds."""

    max_error_pct: float = Field(..., ge=0.0, le=100.0)
    max_p95_ms: float = Field(..., ge=1.0, le=60000.0)
    stale_after_s: int = Field(..., ge=30, le=3600)


@router.get("")
async def list_services(
    q: str | None = Query(None),
    status: str = Query("all"),
    product: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1),
    user: dict[str, Any] = Depends(get_current_user),  # noqa: ARG008
) -> dict[str, Any]:
    """Retrieve paginated list of services with health status, rpm, error %, and p95."""
    if status not in ALLOWED_STATUSES:
        raise ValidationError(
            f"Invalid status '{status}'. Allowed statuses: {', '.join(sorted(ALLOWED_STATUSES))}"
        )

    if product not in ALLOWED_PRODUCTS:
        raise ValidationError(
            f"Invalid product '{product}'. Allowed products: {', '.join(sorted(ALLOWED_PRODUCTS))}"
        )

    effective_page_size = min(page_size, 100)

    with get_db() as conn:
        query = "SELECT id, name, product, description, created_at FROM services WHERE 1=1"
        params: list[Any] = []

        if product != "all":
            query += " AND product = ?"
            params.append(product)

        if q and q.strip():
            clean_q = q.strip()
            # Escape LIKE wildcards to prevent pattern injection
            escaped_q = clean_q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped_q}%"
            query += " AND (name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')"
            params.extend([pattern, pattern])

        query += " ORDER BY id ASC;"
        rows = conn.execute(query, tuple(params)).fetchall()

        # Evaluate each service status using existing status engine
        matched_services: list[dict[str, Any]] = []
        for r in rows:
            svc_id = r["id"]
            eval_result = evaluate_service_status(conn, svc_id)

            if status != "all" and eval_result["status"] != status:
                continue

            # RPM: requests across evaluated 3-minute window divided by 3
            rpm = round(eval_result["requests"] / 3.0, 2)

            matched_services.append(
                {
                    "id": svc_id,
                    "name": r["name"],
                    "product": r["product"],
                    "description": r["description"],
                    "created_at": r["created_at"],
                    "status": eval_result["status"],
                    "status_label": eval_result["label"],
                    "reason": eval_result["reason"],
                    "req_min": rpm,
                    "error_pct": eval_result["error_pct"],
                    "p95": eval_result["p95"],
                    "last_update": eval_result["newest_bucket"],
                }
            )

        total = len(matched_services)
        pages = (total + effective_page_size - 1) // effective_page_size if total > 0 else 1
        start_idx = (page - 1) * effective_page_size
        paged_items = matched_services[start_idx : start_idx + effective_page_size]

        return {
            "items": paged_items,
            "total": total,
            "page": page,
            "page_size": effective_page_size,
            "pages": pages,
        }


@router.get("/{service_id}")
async def get_service(
    service_id: str,
    user: dict[str, Any] = Depends(get_current_user),  # noqa: ARG008
) -> dict[str, Any]:
    """Retrieve full service details including status, thresholds, sim state, and incidents."""
    with get_db() as conn:
        svc_row = conn.execute(
            "SELECT id, name, product, description, created_at FROM services WHERE id = ?;",
            (service_id,),
        ).fetchone()

        if not svc_row:
            raise NotFoundError(f"Service '{service_id}' not found")

        eval_result = evaluate_service_status(conn, service_id)
        rpm = round(eval_result["requests"] / 3.0, 2)
        thresholds = get_service_thresholds(conn, service_id)

        sim_row = conn.execute(
            """
            SELECT mode, paused, reporting_paused, mode_since, updated_at
            FROM sim_state
            WHERE service_id = ?;
            """,
            (service_id,),
        ).fetchone()

        sim_state = None
        if sim_row:
            sim_state = {
                "mode": sim_row["mode"],
                "paused": bool(sim_row["paused"]),
                "reporting_paused": bool(sim_row["reporting_paused"]),
                "mode_since": sim_row["mode_since"],
                "updated_at": sim_row["updated_at"],
            }

        inc_rows = conn.execute(
            """
            SELECT id, service_id, type, status, healthy_streak, summary,
                   opened_at, acknowledged_at, recovered_at, resolved_at, created_at
            FROM incidents
            WHERE service_id = ?
            ORDER BY opened_at DESC
            LIMIT 10;
            """,
            (service_id,),
        ).fetchall()
        recent_incidents = [dict(r) for r in inc_rows]

        return {
            "service": {
                "id": svc_row["id"],
                "name": svc_row["name"],
                "product": svc_row["product"],
                "description": svc_row["description"],
                "created_at": svc_row["created_at"],
                "status": eval_result["status"],
                "status_label": eval_result["label"],
                "reason": eval_result["reason"],
                "req_min": rpm,
                "error_pct": eval_result["error_pct"],
                "p95": eval_result["p95"],
                "last_update": eval_result["newest_bucket"],
            },
            "thresholds": thresholds,
            "sim_state": sim_state,
            "recent_incidents": recent_incidents,
        }


@router.put("/{service_id}/thresholds")
async def update_thresholds(
    service_id: str,
    req: ThresholdsUpdateRequest,
    request: Request,
    admin: dict[str, Any] = Depends(require_role("admin")),
) -> dict[str, Any]:
    """Update service monitoring thresholds with audit logging (admin action)."""
    client_ip = get_client_ip(request)

    with get_db() as conn:
        svc_row = conn.execute(
            "SELECT id FROM services WHERE id = ?;",
            (service_id,),
        ).fetchone()
        if not svc_row:
            raise NotFoundError(f"Service '{service_id}' not found")

        old_thresholds = get_service_thresholds(conn, service_id)
        now_str = datetime.now(UTC).isoformat()

        conn.execute(
            """
            INSERT INTO thresholds (
                service_id, max_error_pct, max_p95_ms, stale_after_s, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(service_id) DO UPDATE SET
                max_error_pct = excluded.max_error_pct,
                max_p95_ms = excluded.max_p95_ms,
                stale_after_s = excluded.stale_after_s,
                updated_at = excluded.updated_at;
            """,
            (
                service_id,
                req.max_error_pct,
                req.max_p95_ms,
                req.stale_after_s,
                now_str,
            ),
        )

        new_thresholds = {
            "max_error_pct": req.max_error_pct,
            "max_p95_ms": req.max_p95_ms,
            "stale_after_s": req.stale_after_s,
        }

        audit.write(
            conn,
            actor=admin["username"],
            action="threshold_update",
            target_type="service",
            target_id=service_id,
            old=old_thresholds,
            new=new_thresholds,
            ip=client_ip,
        )

        return {
            "status": "ok",
            "service_id": service_id,
            "thresholds": new_thresholds,
        }
