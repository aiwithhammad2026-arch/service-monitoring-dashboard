"""CSV export API endpoints: streaming metrics and incidents with formula injection defense."""

import csv
import io
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Response

from backend.auth import get_current_user
from backend.db import get_db
from backend.errors import ValidationError
from backend.metrics import floor_to_minute

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

ALLOWED_INCIDENT_STATUSES = {
    "all",
    "open",
    "acknowledged",
    "recovered",
    "resolved",
}


def escape_csv_cell(value: Any) -> str:
    """Prefix dangerous formula characters with a single quote to prevent injection.

    Protects spreadsheet applications (Excel, LibreOffice, Google Sheets) from
    dynamic data exchange (DDE) and code execution attacks.
    """
    if value is None:
        return ""
    text = str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{text}"
    return text


@router.get("/metrics.csv")
async def export_metrics_csv(
    range: str = Query("1h"),
    product: str = Query("all"),
    user: dict[str, Any] = Depends(get_current_user),  # noqa: ARG008
) -> Response:
    """Export metric buckets as CSV with formula escaping and range/product filters."""
    if range not in ALLOWED_RANGES:
        raise ValidationError(
            f"Invalid range '{range}'. Allowed ranges: {', '.join(sorted(ALLOWED_RANGES.keys()))}"
        )

    if product not in ALLOWED_PRODUCTS:
        raise ValidationError(
            f"Invalid product '{product}'. Allowed products: {', '.join(sorted(ALLOWED_PRODUCTS))}"
        )

    minutes = ALLOWED_RANGES[range]
    eval_now = floor_to_minute(datetime.now(UTC))
    start_dt = eval_now - timedelta(minutes=minutes - 1)

    with get_db() as conn:
        query = """
            SELECT mb.service_id, s.name as service_name, s.product, mb.bucket_start,
                   mb.requests, mb.errors, mb.latency_p50, mb.latency_p95
            FROM metric_buckets mb
            JOIN services s ON s.id = mb.service_id
            WHERE mb.bucket_start >= ? AND mb.bucket_start <= ?
        """
        params: list[Any] = [start_dt.isoformat(), eval_now.isoformat()]

        if product != "all":
            query += " AND s.product = ?"
            params.append(product)

        query += " ORDER BY mb.bucket_start DESC, mb.service_id ASC;"
        rows = conn.execute(query, tuple(params)).fetchall()

        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

        headers = [
            "service_id",
            "service_name",
            "product",
            "bucket_start",
            "requests",
            "errors",
            "latency_p50",
            "latency_p95",
        ]
        writer.writerow([escape_csv_cell(h) for h in headers])

        for r in rows:
            row_data = [
                r["service_id"],
                r["service_name"],
                r["product"],
                r["bucket_start"],
                r["requests"],
                r["errors"],
                r["latency_p50"],
                r["latency_p95"],
            ]
            writer.writerow([escape_csv_cell(val) for val in row_data])

        csv_content = output.getvalue()
        return Response(
            content=csv_content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="metrics.csv"'},
        )


@router.get("/incidents.csv")
async def export_incidents_csv(
    status: str = Query("all"),
    user: dict[str, Any] = Depends(get_current_user),  # noqa: ARG008
) -> Response:
    """Export incidents as CSV with formula escaping and status filter."""
    if status not in ALLOWED_INCIDENT_STATUSES:
        raise ValidationError(
            f"Invalid incident status '{status}'. "
            f"Allowed statuses: {', '.join(sorted(ALLOWED_INCIDENT_STATUSES))}"
        )

    with get_db() as conn:
        query = """
            SELECT id, service_id, type, status, healthy_streak, summary,
                   opened_at, acknowledged_at, recovered_at, resolved_at, created_at
            FROM incidents
            WHERE 1=1
        """
        params: list[Any] = []

        if status != "all":
            query += " AND status = ?"
            params.append(status)

        query += " ORDER BY opened_at DESC;"
        rows = conn.execute(query, tuple(params)).fetchall()

        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

        headers = [
            "id",
            "service_id",
            "type",
            "status",
            "healthy_streak",
            "summary",
            "opened_at",
            "acknowledged_at",
            "recovered_at",
            "resolved_at",
            "created_at",
        ]
        writer.writerow([escape_csv_cell(h) for h in headers])

        for r in rows:
            row_data = [
                r["id"],
                r["service_id"],
                r["type"],
                r["status"],
                r["healthy_streak"],
                r["summary"],
                r["opened_at"],
                r["acknowledged_at"],
                r["recovered_at"],
                r["resolved_at"],
                r["created_at"],
            ]
            writer.writerow([escape_csv_cell(val) for val in row_data])

        csv_content = output.getvalue()
        return Response(
            content=csv_content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="incidents.csv"'},
        )
