"""Main FastAPI application factory for Service Monitoring Dashboard."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.errors import register_error_handlers
from backend.routes.audit import router as audit_router
from backend.routes.auth import router as auth_router
from backend.routes.export import router as export_router
from backend.routes.incidents import router as incidents_router
from backend.routes.metrics import router as metrics_router
from backend.routes.services import router as services_router
from backend.routes.sim import router as sim_router
from backend.simulator import simulator

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@asynccontextmanager
async def _lifespan(app: FastAPI):  # noqa: ARG001
    """Start and stop the background simulator around the ASGI lifespan."""
    await simulator.start()
    try:
        yield
    finally:
        await simulator.stop()


def create_app(
    extra_routers: list[APIRouter] | None = None,
    use_lifespan: bool = True,
) -> FastAPI:
    """Create and configure the FastAPI application instance."""
    app = FastAPI(
        title="Service Monitoring Dashboard",
        description="Operations dashboard with service health, metrics, and incident simulation.",
        version="0.1.0",
        lifespan=_lifespan if use_lifespan else None,
    )

    # 1. Register uniform error handlers returning {"error": {"code", "message"}}
    register_error_handlers(app)

    # 2. CSRF Defense Middleware: Require X-Requested-With on all state-changing requests
    @app.middleware("http")
    async def csrf_middleware(request: Request, call_next: Any) -> Any:
        if request.method in ("POST", "PUT", "DELETE", "PATCH"):
            csrf_header = request.headers.get("x-requested-with")
            if not csrf_header or not csrf_header.strip():
                return JSONResponse(
                    status_code=403,
                    content={
                        "error": {
                            "code": "CSRF_FAILED",
                            "message": "Missing required X-Requested-With header",
                        }
                    },
                )
        return await call_next(request)

    # 3. System Health API Route
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

    # 4. API Routers
    app.include_router(auth_router, prefix="/auth", tags=["Auth"])
    app.include_router(metrics_router, prefix="/metrics", tags=["Metrics"])
    app.include_router(services_router, prefix="/services", tags=["Services"])
    app.include_router(sim_router, prefix="/sim", tags=["Simulator"])
    app.include_router(incidents_router, prefix="/incidents", tags=["Incidents"])
    app.include_router(audit_router, prefix="/audit", tags=["Audit"])
    app.include_router(export_router, prefix="/export", tags=["Export"])

    # 5. Optional extra routers (e.g. test-only route harness)
    if extra_routers:
        for r in extra_routers:
            app.include_router(r)

    # 6. Mount static frontend directory at /
    if FRONTEND_DIR.exists():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

    return app


# Application entry point for ASGI servers (e.g. uvicorn backend.main:app)
app = create_app()
