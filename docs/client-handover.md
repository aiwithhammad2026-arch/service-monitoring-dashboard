# Service Monitoring Dashboard — Client Handover
**Repository:** `service-monitoring-dashboard` — Real-time operations monitoring with deterministic simulation and RBAC.
**Setup (5 commands):** `uv sync` -> `uv run python -m backend.db migrate` -> `uv run python -m backend.seed` -> `uv run uvicorn backend.main:app --reload` -> `uv run pytest --cov=backend`. App at `http://127.0.0.1:8000/`.
**Demo Accounts (Demo only):** `admin` / `Admin#2026!` (Full write & admin controls), `viewer` / `Viewer#2026!` (Read-only).
**Built (Reqs 1–8):** (1) 3 products / 10 services; (2) Deterministic 5s simulator; (3) Merged 18-bin histogram RPM/p50/p95; (4) Trailing 3m health status (gray>red>green); (5) Incident lifecycle with `one_active_incident` DB index; (6) Signed cookie RBAC (Admin/Viewer) + CSRF; (7) Vanilla JS responsive SPA with vendored Chart.js; (8) Sanitized CSV export & redacted audit logs.
### Unfinished Items & Limitations (from docs/limitations.md & README)
- **Scenario File Runner:** `MD_SIM_SCENARIO` hook defined in `backend/config.py`, but automated JSON scheduling is deferred.
- **No Headless Browser / UI Tests:** Unit/API/integration tests pass; browser UI rendering not automated.
- **SQLite Concurrency:** Operates in WAL mode with busy timeouts; single-writer architecture suited for single-node workloads.
- **In-Memory Rate Limiting:** Failed login rate limiter is stored in process memory and resets on server process restart.
- **Histogram Percentile Approximations:** Percentiles linearly interpolated within fixed bins (capped at 5000ms finite ceiling).
- **Demo Walkthrough Video:** Screen recording following `docs/demo-script.md` must be recorded separately by an operator.
### Where to Edit for Likely Review Changes
- **Active-User Window:** `backend/config.py` (`Settings.active_user_window_m`), `backend/metrics.py` (`overview`), `tests/test_metrics.py`.
- **Add New Service:** `backend/seed.py` (`SERVICES_CATALOG`), `backend/migrations/001_init.sql`, `tests/test_db_and_seed.py`.
- **Default Thresholds:** `backend/seed.py` (`seed()`), `backend/config.py` (`Settings.stale_after_s`), `backend/status.py`.
- **New Status Filter:** `backend/routes/services.py` (`ALLOWED_STATUSES`), `frontend/js/views/services.js` (`renderTable`), `tests/test_api.py`.
- **Add Degraded Status:** `backend/status.py` (`evaluate_service_status`, `breaches`), `frontend/js/ui.js` (`makeStatusBadge`), `frontend/css/styles.css`.
