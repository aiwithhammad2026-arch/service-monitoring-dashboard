"""Metrics API endpoints: operations overview KPIs and historical chart series."""

from typing import Any

from fastapi import APIRouter, Depends, Query

from backend.auth import get_current_user
from backend.db import get_db
from backend.errors import NotFoundError, ValidationError
from backend.metrics import history, overview

router = APIRouter()

ALLOWED_RANGES = {
    "15m": 15,
    "1h": 60,
    "6h": 360,
    "24h": 1440,
}

ALLOWED_PRODUCTS = {
    "all",
    "website",
    "app",
    "admin_console",
}


@router.get("/overview")
async def get_overview(
    range: str = Query("1h"),
    product: str = Query("all"),
    user: dict[str, Any] = Depends(get_current_user),  # noqa: ARG008
) -> dict[str, Any]:
    """Retrieve high-level dashboard KPI metrics across registered and active users."""
    if range not in ALLOWED_RANGES:
        raise ValidationError(
            f"Invalid range '{range}'. Allowed ranges: {', '.join(sorted(ALLOWED_RANGES.keys()))}"
        )

    if product not in ALLOWED_PRODUCTS:
        raise ValidationError(
            f"Invalid product '{product}'. Allowed products: {', '.join(sorted(ALLOWED_PRODUCTS))}"
        )

    minutes = ALLOWED_RANGES[range]
    effective_product = None if product == "all" else product

    with get_db() as conn:
        data = overview(conn, minutes=minutes, product=effective_product)
        data["range"] = range
        return data


@router.get("/history")
async def get_history(
    range: str = Query("1h"),
    product: str = Query("all"),
    service_id: str | None = Query(None),
    user: dict[str, Any] = Depends(get_current_user),  # noqa: ARG008
) -> dict[str, Any]:
    """Retrieve continuous minute-by-minute metric timeseries for chart rendering."""
    if range not in ALLOWED_RANGES:
        raise ValidationError(
            f"Invalid range '{range}'. Allowed ranges: {', '.join(sorted(ALLOWED_RANGES.keys()))}"
        )

    if product not in ALLOWED_PRODUCTS:
        raise ValidationError(
            f"Invalid product '{product}'. Allowed products: {', '.join(sorted(ALLOWED_PRODUCTS))}"
        )

    minutes = ALLOWED_RANGES[range]
    effective_product = None if product == "all" else product

    with get_db() as conn:
        if service_id is not None:
            svc_row = conn.execute(
                "SELECT id FROM services WHERE id = ?;",
                (service_id,),
            ).fetchone()
            if not svc_row:
                raise NotFoundError(f"Service '{service_id}' not found")

        points = history(
            conn,
            minutes=minutes,
            service_id=service_id,
            product=effective_product,
        )
        return {
            "range": range,
            "minutes": minutes,
            "service_id": service_id,
            "product": product,
            "points": points,
        }
