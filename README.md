# Service Monitoring Dashboard

Production-style operations monitoring dashboard built with FastAPI, SQLite, and vanilla JavaScript (ES modules). Provides real-time service health tracking, deterministic telemetry simulation, incident lifecycle management, and administrative audit logging across three platform products: **Website**, **App**, and **Admin Console**.

---

## Architecture

```mermaid
graph TD
    Client["Browser (Vanilla JS ES Modules + CSS Tokens)"]
    API["FastAPI App (Uvicorn)"]
    Auth["Auth & RBAC (Signed Cookies + bcrypt)"]
    MetricsEngine["Metrics Engine (Histogram Merging)"]
    IncidentEngine["Incident State Machine"]
    Simulator["Deterministic Simulator (Async Loop)"]
    DB[("SQLite Database (WAL Mode)")]

    Client <-->|REST API + Polling (10s)| API
    API --> Auth
    API --> MetricsEngine
    API --> IncidentEngine
    Simulator -->|tick / evaluate (5s)| DB
    MetricsEngine <--> DB
    IncidentEngine <--> DB
    Auth <--> DB
```

---

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Backend** | Python 3.12+, FastAPI, Uvicorn, Pydantic v2 | High-performance asynchronous API, strict schema validation, type safety |
| **Database** | SQLite (WAL mode, Foreign Keys ON) | Zero external daemon dependency, ACID transactions, portable isolated testing |
| **Migrations** | Plain SQL migrations (`001_init.sql`, etc.) | Transparent schema versioning without ORM abstraction overhead |
| **Authentication** | `itsdangerous` signed cookies, `bcrypt` (cost 12) | Stateless HttpOnly SameSite=Lax sessions, server-enforced RBAC on every request |
| **Frontend** | Vanilla HTML5, CSS Custom Properties, ES Modules | Zero build step, instant load, no node_modules bundle pipeline |
| **Visualisation** | Chart.js (vendored locally in `frontend/vendor/`) | No external CDN calls; responsive minute-by-minute line charts |
| **Testing** | pytest, httpx, pytest-cov, pytest-asyncio, ruff | Deterministic isolated SQLite fixtures, fast test execution |

---

## Folder Structure

```text
service-monitoring-dashboard/
├── backend/
│   ├── migrations/          # Versioned plain SQL migrations (001_init, 002_indexes, 003_incident_updates)
│   ├── routes/              # FastAPI API route modules (auth, metrics, services, incidents, sim, audit, export)
│   ├── audit.py             # Immutable audit logging with automatic recursive credential redaction
│   ├── auth.py              # Password hashing, session cookie management, RBAC dependencies, rate limiting
│   ├── config.py            # Pydantic/dataclass environment configuration with secure defaults
│   ├── db.py                # SQLite connection factory, WAL pragmas, migration runner, CLI entrypoint
│   ├── errors.py            # Uniform error models and global exception handlers
│   ├── incidents.py         # Incident lifecycle state machine, streak evaluation, timeline events
│   ├── main.py              # FastAPI application factory, middleware, lifespan handlers, static mounting
│   ├── metrics.py           # Fixed-edge histogram merging, percentile interpolation, KPI aggregations
│   ├── seed.py              # Idempotent deterministic database seeder (accounts, services, telemetry)
│   ├── simulator.py         # Deterministic background traffic generator and chaos injection engine
│   └── status.py            # Service health evaluation engine (gray/red/green precedence rules)
├── frontend/
│   ├── css/                 # Modern design system (base.css, layout.css, components.css, utilities.css)
│   ├── js/
│   │   ├── views/           # SPA view controllers (dashboard, services, service-detail, incidents, audit, sim)
│   │   ├── api.js           # Fetch wrapper with CSRF headers, sequence tracking, and error mapping
│   │   ├── app.js           # SPA shell, authentication bootloader, theme switcher, layout management
│   │   ├── poller.js        # Interval polling helper with document visibility lifecycle management
│   │   ├── router.js        # Hash-based client router with dynamic parameter matching
│   │   └── ui.js            # Reusable DOM builders (badges, skeletons, modals, toasts, cards)
│   ├── vendor/              # Locally vendored Chart.js library (no external CDN)
│   └── index.html           # Single-page application entrypoint
├── docs/                    # Architectural documentation, assumptions, limitations, review guide, demo script
├── scripts/                 # Helper & demo scripts (sim_demo.py for CLI walkthrough, verify_api_live.py for live API verification)
├── tests/                   # Automated pytest suite covering metrics, status, auth, incidents, restart, security
├── pyproject.toml           # Project metadata, dependencies, ruff, and pytest configurations
└── uv.lock                  # Deterministic dependency lockfile
```

---

## Quickstart & Setup Commands

Run the following commands in your shell from the repository root:

```bash
# 1. Install dependencies into isolated virtual environment
uv sync

# 2. Execute database schema migrations
uv run python -m backend.db migrate

# 3. Seed initial users, products, services, thresholds, and historical metrics
uv run python -m backend.seed

# 4. Start the development server
uv run uvicorn backend.main:app --reload

# 5. Run the full automated test suite with backend coverage
uv run pytest --cov=backend
```

Open your browser at `http://127.0.0.1:8000/` to access the application.

---

## Demo Accounts

> **Notice:** The following accounts are seeded for demonstration and evaluation only.

| Username | Password | Role | Permissions |
|---|---|---|---|
| `admin` | `Admin#2026!` | **Admin** | Full read & write: threshold updates, simulator chaos toggles, incident ack/resolve, audit access |
| `viewer` | `Viewer#2026!` | **Viewer** | Read-only: dashboard overview, service details, incident tracking, CSV export |

---

## Environment Variables

Configured in `.env` (refer to `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `MD_DB_PATH` | `monitoring.db` | Path to the SQLite database file |
| `MD_SECRET_KEY` | `insecure-dev-secret-key-change-in-production` | Secret key for cryptographic cookie signing (`itsdangerous`) |
| `MD_SIM_SEED` | `42` | Seed integer for deterministic pseudo-random traffic simulation |
| `MD_SIM_TICK` | `5.0` | Simulator tick interval in seconds |
| `MD_SIM_ENABLED` | `1` | Set `0` to disable background simulation loop (useful for testing) |
| `MD_SECURE_COOKIES` | `false` | Enable `Secure` cookie flag (set `true` when behind HTTPS) |
| `MD_STALE_AFTER_S` | `180` | Age threshold in seconds before telemetry is marked stale (gray) |
| `MD_ACTIVE_USER_WINDOW_M` | `15` | Window in minutes for calculating active registered users |
| `MD_BCRYPT_ROUNDS` | `12` | Cost factor for bcrypt password hashing (lowered in test environments) |
| `MD_RATE_LIMIT_MAX_ATTEMPTS` | `5` | Maximum failed login attempts allowed per (user, IP) |
| `MD_RATE_LIMIT_WINDOW_S` | `300` | Sliding window in seconds for failed login rate limiting (5 minutes) |

---

## API Summary Table

All API responses use JSON and require an authenticated session cookie unless marked Public.

| Method | Endpoint | Minimum Role | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Liveness check and operational status |
| `POST` | `/auth/login` | Public | Authenticate user, set signed session cookie |
| `POST` | `/auth/logout` | Public | Clear session cookie |
| `GET` | `/auth/me` | Viewer | Retrieve current authenticated user profile and role |
| `GET` | `/metrics/overview` | Viewer | High-level KPI summary cards across range and product filters |
| `GET` | `/metrics/history` | Viewer | Continuous minute-by-minute time series for request & latency charts |
| `GET` | `/services` | Viewer | Paginated list of monitored services with health badges and metrics |
| `GET` | `/services/{id}` | Viewer | Service detail, threshold rationale, continuous charts, sim state |
| `PUT` | `/services/{id}/thresholds` | Admin | Update service alerting thresholds (audit logged) |
| `POST` | `/sim/{id}/mode` | Admin | Change simulator mode (`normal`, `slow`, `failing`, `recovering`) |
| `POST` | `/sim/{id}/pause` | Admin | Toggle traffic pause (writes zero-request buckets) |
| `POST` | `/sim/{id}/reporting` | Admin | Toggle reporting pause (emits no buckets -> triggers Stale status) |
| `GET` | `/incidents` | Viewer | Paginated incidents list filtered by status |
| `GET` | `/incidents/{id}` | Viewer | Incident details with chronological timeline of state changes |
| `POST` | `/incidents/{id}/ack` | Admin | Acknowledge open incident |
| `POST` | `/incidents/{id}/resolve` | Admin | Resolve active incident (from open, acknowledged, or recovered) |
| `GET` | `/audit` | Admin | Paginated audit trail with credential redaction |
| `GET` | `/export/metrics.csv` | Viewer | Stream sanitized CSV export of metric telemetry buckets |
| `GET` | `/export/incidents.csv` | Viewer | Stream sanitized CSV export of incidents |

---

## Metric Definitions & Formulas

1. **Registered Users:** Total count of synthetic user records in `app_users` for the selected product.
2. **Active Users:** Count of users in `app_users` whose `last_seen_at >= now - MD_ACTIVE_USER_WINDOW_M` (15 minutes).
3. **Requests Per Minute (RPM):**
   $$\text{RPM} = \frac{\sum \text{Requests in Window}}{\text{Total Minutes in Window}}$$
4. **Success Percentage:**
   $$\text{Success \%} = \frac{\sum \text{Requests} - \sum \text{Errors}}{\sum \text{Requests}} \times 100$$
   *Returns `null` ("No data") if total requests equal zero.*
5. **Error Percentage:**
   $$\text{Error \%} = \frac{\sum \text{Errors}}{\sum \text{Requests}} \times 100$$
   *Returns `null` ("No data") if total requests equal zero.*
6. **p50 and p95 Latency:**
   - Evaluated using 18 fixed-edge histogram bins: `[5, 10, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000, 3000, 5000, +inf]` ms.
   - Bins are merged element-wise across time buckets.
   - Percentiles are interpolated linearly inside the target rank bin. The `+inf` bin is capped at 5000 ms.
   *Returns `null` ("No data") if total requests equal zero.*

---

## Assumptions & Design Decisions

- **Strict Status Precedence:** Evaluated over the trailing 3-minute window:
  1. `No data` / `Stale` (gray): No buckets in window, newest bucket older than `stale_after_s`, or 0 requests across window.
  2. `Failing` (red): Error rate > `max_error_pct` (default 5.0%).
  3. `Slow` (red): p95 latency > `max_p95_ms` (default 800.0 ms).
  4. `Healthy` (green): All metrics within acceptable thresholds.
- **Strict Boundary Equality:** Threshold comparisons use strictly greater than (`>`). Exact boundary values (e.g. error rate exactly 5.0%) remain Healthy.
- **Incident Deduplication:** Enforced at the engine layer and guaranteed at the DB schema layer via a partial unique index `one_active_incident` ON `incidents(service_id, type) WHERE status != 'resolved'`.
- **Zero-Traffic Semantics:** Zero traffic returns `null` for percentiles and ratios to avoid misleading `0%` or `100%` indicators.
- **Timezone Consistency:** All dates and timestamps are stored and manipulated in UTC ISO-8601 strings.

---

## Architectural Trade-offs

1. **SQLite (WAL mode) vs. PostgreSQL:**
   - *Chosen:* SQLite in WAL mode.
   - *Trade-off:* Eliminates external database infrastructure, enabling zero-config local evaluation and isolated in-memory/file testing. SQLite is single-writer, which limits high-concurrency write throughput compared to PostgreSQL, but is optimal for low-to-medium volume telemetry and single-node operations.
2. **Polling (10s) vs. WebSockets / Server-Sent Events:**
   - *Chosen:* Standard REST endpoints polled at 10-second intervals with document visibility pause (`poller.js`).
   - *Trade-off:* Significantly simpler backend state management, standard caching, automatic reconnection, and firewall traversal. WebSockets would provide lower latency updates at the expense of connection state management.
3. **Vanilla JS (ES Modules) vs. Frontend Framework (React/Vue):**
   - *Chosen:* Native ES Modules and CSS custom properties.
   - *Trade-off:* Zero build pipeline, instant browser refresh, zero bundle size bloat. Does require explicit DOM construction helpers (`ui.js`) rather than declarative JSX.
4. **Histogram Percentiles vs. Raw Request Logs:**
   - *Chosen:* 18-bin fixed-edge histograms aggregated per minute bucket.
   - *Trade-off:* Constant $O(1)$ storage per minute regardless of request volume (1 request vs 10,000 requests consumes identical DB space). Introduces a small approximation error bounded by bin widths.
5. **In-App Notifications vs. External Webhooks/Alerting:**
   - *Chosen:* In-app incident badges, status highlights, and timeline history.
   - *Trade-off:* Self-contained evaluation without requiring third-party credentials (PagerDuty, Slack, SMTP).

---

## Unfinished Items & Future Improvements

- **Scenario File Runner (`MD_SIM_SCENARIO`):** Setting and configuration hook is present in `backend/config.py`, but automated JSON scenario scheduling is currently deferred.
- **Persistent Rate Limiting:** The failed login rate limiter is currently in-memory (resets on server process restart). Future improvement would store sliding windows in SQLite or Redis.
- **Export Filters:** CSV export streams all buckets or all incidents; UI-driven date range filtering for CSV exports can be added.
- **WebSocket Streaming:** Optional live stream channel for sub-second telemetry updates.

---

## Running Automated Tests

```bash
# Run entire test suite with coverage report
uv run pytest --cov=backend -q

# Run static analysis and linting
uv run ruff check .
```
