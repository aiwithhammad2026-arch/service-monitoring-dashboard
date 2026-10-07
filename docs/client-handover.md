# Service Monitoring Dashboard — Client Handover (`service-monitoring-dashboard`)
**Setup (5 commands):** `uv sync` -> `uv run python -m backend.db migrate` -> `uv run python -m backend.seed` -> `uv run uvicorn backend.main:app --reload` -> `uv run pytest --cov=backend`. App at `http://127.0.0.1:8000/`.
**Demo Accounts (Demo only):** `admin` / `Admin#2026!` (Full write & admin controls), `viewer` / `Viewer#2026!` (Read-only).
### What is built, mapped to the client's 8 requirements
1. **Dashboard Overview:** 8 KPI summary cards, active-user window, RPM, success/error %, p50/p95 latency, history charts, time/product filters, formula popovers.
2. **Service Monitoring:** 10 monitored services across 3 products, detail views, green/red/gray health status with text labels, admin-editable thresholds.
3. **Real Backend Behaviour:** SQLite persistence (WAL mode), deterministic 5s simulator, distinct traffic pause (`paused=1`) vs reporting pause (`reporting_paused=1`).
4. **Alerts & Incidents:** Incident state machine (open/ack/recovered/resolved), DB deduplication via `one_active_incident` index, timeline events, in-app badge.
5. **Users & Security:** Seeded `admin` and `viewer`, server-enforced RBAC, `x-requested-with` CSRF header, sliding-window rate limiter, redacted audit log.
6. **User Experience:** Responsive (375px/1440px), Dark/Light themes, search/filters, pagination, formula-safe CSV export, loading/empty/stale/error/retry states.
7. **Automated Tests:** 132 passing pytest tests with 93% backend coverage (unit, API, restart, security); UI tested via static/schema tests (no headless browser).
8. **Deliverables:** Full source, `uv.lock`, SQL migrations, deterministic seed, test suite, setup guides, architecture docs; demo video recorded separately by operator.
### Unfinished Items & Limitations (from docs/limitations.md & README)
- **Scenario Replay:** Automated JSON scenario scheduling is deferred; live chaos injection is operated via simulator UI and API controls.
- **No Headless Browser / UI Tests:** Tests cover unit, API, integration, and security layers; browser end-to-end rendering is not automated.
- **SQLite Concurrency:** Operates in WAL mode with busy timeouts; single-writer architecture is suited for single-node workloads.
- **In-Memory Rate Limiting:** Failed login rate limiter is stored in process memory and resets on server process restart.
- **Histogram Percentile Approximations:** Percentiles linearly interpolated within 18 fixed bins (capped at 5000ms finite ceiling).
- **Demo Walkthrough Video:** Screen recording following `docs/demo-script.md` must be recorded separately by an operator.
### Where to Edit for Likely Review Changes
- **Active-User Window:** `backend/config.py` (`Settings.active_user_window_m`), `backend/metrics.py` (`overview`), `tests/test_metrics.py`.
- **Add New Service:** `backend/seed.py` (`SERVICES_CATALOG`), `backend/migrations/001_init.sql`, `tests/test_db_and_seed.py`.
- **Default Thresholds:** `backend/seed.py` (`seed()`), `backend/config.py` (`Settings.stale_after_s`), `backend/status.py`.
- **New Status Filter:** `backend/routes/services.py` (`ALLOWED_STATUSES`), `frontend/js/views/services.js` (`renderTable`), `tests/test_api.py`.
- **Add Degraded Status:** `backend/status.py` (`evaluate_service_status`, `breaches`), `frontend/js/ui.js` (`makeStatusBadge`), `frontend/css/styles.css`.
