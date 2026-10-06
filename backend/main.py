"""Main FastAPI application factory for Service Monitoring Dashboard."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.config import settings

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    app = FastAPI(
        title="Service Monitoring Dashboard",
        description="Operations dashboard with service health, metrics, and incident simulation.",
        version="0.1.0",
    )

    # API routes take precedence
    @app.get("/health", tags=["System"])
    async def health_check() -> dict[str, Any]:
        """Health check endpoint confirming service availability."""
        is_dev = settings.secret_key == settings.DEFAULT_SECRET
        return {
            "status": "ok",
            "version": "0.1.0",
            "timestamp": datetime.now(UTC).isoformat(),
            "environment": "development" if is_dev else "production",
        }

    # Mount static frontend directory at /
    if FRONTEND_DIR.exists():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

    return app


# Application entry point for ASGI servers (e.g. uvicorn backend.main:app)
app = create_app()
