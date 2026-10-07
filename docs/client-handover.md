# Service Monitoring Dashboard — Client Handover

**Repository:** `service-monitoring-dashboard` — Real-time operations monitoring dashboard with telemetry simulation, incident lifecycle, and RBAC.

### Quickstart & Setup Commands
Run from repo root: `uv sync` → `uv run python -m backend.db migrate` → `uv run python -m backend.seed` → `uv run uvicorn backend.main:app --reload` → `uv run pytest --cov=backend`. App at `http://127.0.0.1:8000/`.
**Demo Accounts (Evaluation only):** `admin` / `Admin#2026!` (Full write & admin controls), `viewer` / `Viewer#2026!` (Read-only).

### Built Capabilities (Requirements 1–8)
1. **Products & Services:** 3 platform products (Website, App, Admin Console) monitoring 10 services with continuous telemetry.
2. **Deterministic Simulator:** 5s seeded PRNG background traffic loop (`normal`, `slow`, `failing`, `recovering`) with traffic pause vs reporting pause.
3. **Metrics Engine:** Merged 18-bin histograms computing RPM, p50, and p95 latency; zero-traffic returns null.
4. **Health Status:** Trailing 3-minute evaluation window with strict precedence (`gray` stale/no-data > `red` failing/slow > `green` healthy).
5. **Incidents & Deduplication:** State machine (`open` → `acknowledged` → `recovered` → `resolved`) with `one_active_incident` DB constraint.
6. **Authentication & RBAC:** Signed session cookies (`itsdangerous`), bcrypt hashing, role enforcement (Admin vs Viewer), and CSRF protection.
7. **Single-Page UI:** Vanilla JS ES modules, CSS custom property themes (Light/Dark), responsive layout (375px/1440px), and vendored Chart.js.
8. **Export & Audit:** Sanitized CSV export defending against formula injection and immutable audit logging with credential redaction.

### Unfinished Items & Limitations
- **Scenario File Runner:** `MD_SIM_SCENARIO` setting hook defined in `backend/config.py`, but automated JSON scenario scheduling is deferred.
- **No Headless Browser / UI Tests:** Tests cover unit, API, integration, and security layers; browser end-to-end rendering is not automated.
- **SQLite Concurrency:** Operates in WAL mode with busy timeouts; single-writer architecture is suited for single-node workloads.
- **In-Memory Rate Limiting:** Failed login rate limiter is stored in process memory and resets on server process restart.
- **Histogram Percentile Approximations:** Percentiles are linearly interpolated within fixed histogram bins (capped at 5000ms finite ceiling).
- **Demo Walkthrough Video:** Screen recording following `docs/demo-script.md` must be recorded separately by an operator.

### Where to Edit for Live Review Changes
- **Active-User Window:** `backend/config.py` (`Settings.active_user_window_m`), `backend/metrics.py` (`overview`), `tests/test_metrics.py`.
- **Add New Service:** `backend/seed.py` (`SERVICES_CATALOG`), `backend/migrations/001_init.sql`, `tests/test_db_and_seed.py`.
- **Default Thresholds:** `backend/seed.py` (`seed()`), `backend/config.py` (`Settings.stale_after_s`), `backend/status.py`.
- **New Status Filter:** `backend/routes/services.py` (`ALLOWED_STATUSES`), `frontend/js/views/services.js` (`renderTable`), `tests/test_api.py`.
- **Add Degraded Status:** `backend/status.py` (`evaluate_service_status`, `breaches`), `frontend/js/ui.js` (`makeStatusBadge`), `frontend/css/styles.css`.
