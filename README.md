# Service Monitoring Dashboard

[![FastAPI](https://img.shields.io/badge/FastAPI-0.142+-009688.svg?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB.svg?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL_Mode-003B57.svg?style=flat&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Vanilla JS](https://img.shields.io/badge/Frontend-Vanilla_ES_Modules-F7DF1E.svg?style=flat&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
[![Coverage](https://img.shields.io/badge/Coverage-93%25-brightgreen.svg?style=flat)](https://pytest.org)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A production-style operations monitoring dashboard built with **FastAPI**, **SQLite** (WAL mode), and **Vanilla JavaScript** (native ES modules and CSS design tokens). Delivers real-time service health tracking, deterministic telemetry simulation, automated incident lifecycle management, and security audit logging across three platform products: **Website**, **App**, and **Admin Console**.

---

## Visual Showcase (Full Platform Walkthrough)

### 1. Operations Dashboard Overview
Real-time KPI metric tiles, active/registered user tracking (15-minute sliding window), continuous request throughput (RPM), and latency percentiles (p50, p95).

#### ☀️ Light Mode
![Dashboard Overview - Light Mode](assets/light-03-dashboard-overview-all.png)

#### 🌙 Dark Mode
![Dashboard Overview - Dark Mode](assets/dark-03-dashboard-overview-all.png)

---

### 2. Multi-Product & Range Segmentation
Instant telemetry filtering across platform product tiers (**Website**, **App**, **Admin Console**) and customizable aggregation windows (15m, 1h, 6h, 24h).

#### ☀️ Light Mode — Website Platform
![Dashboard Website - Light Mode](assets/light-04-dashboard-website.png)

#### 🌙 Dark Mode — Website Platform
![Dashboard Website - Dark Mode](assets/dark-04-dashboard-website.png)

#### ☀️ Light Mode — 24-Hour Continuous Telemetry
![Dashboard 24h - Light Mode](assets/light-07-dashboard-range-24h.png)

#### 🌙 Dark Mode — 24-Hour Continuous Telemetry
![Dashboard 24h - Dark Mode](assets/dark-07-dashboard-range-24h.png)

---

### 3. Monitored Services Catalog & Health Matrix
Live status evaluation across all 10 microservices with health indicators (`Healthy`, `Slow`, `Failing`, `Stale`), error rates, and instant keyword search filtering.

#### ☀️ Light Mode — Fleet Catalog
![Services Catalog - Light Mode](assets/light-08-services-catalog.png)

#### 🌙 Dark Mode — Fleet Catalog
![Services Catalog - Dark Mode](assets/dark-08-services-catalog.png)

#### ☀️ Light Mode — Search & Status Filtering
![Services Filtered - Light Mode](assets/light-09-services-filtered.png)

#### 🌙 Dark Mode — Search & Status Filtering
![Services Filtered - Dark Mode](assets/dark-09-services-filtered.png)

---

### 4. Service Deep Dive & Alert Threshold Management
Detailed minute-by-minute percentile analysis, error breakdown, threshold tuning (`max_error_pct`, `max_p95_ms`), and immediate audit logging.

#### ☀️ Light Mode — Service Telemetry & Charts
![Service Detail - Light Mode](assets/light-10-service-detail-payments.png)

#### 🌙 Dark Mode — Service Telemetry & Charts
![Service Detail - Dark Mode](assets/dark-10-service-detail-payments.png)

#### ☀️ Light Mode — Threshold Tuning Form
![Service Threshold Form - Light Mode](assets/light-11-service-threshold-edit.png)

#### 🌙 Dark Mode — Threshold Tuning Form
![Service Threshold Form - Dark Mode](assets/dark-11-service-threshold-edit.png)

---

### 5. Deterministic Chaos Simulator & Traffic Engine
Live background telemetry generator with configurable chaos modes (`normal`, `slow`, `failing`, `recovering`), zero-traffic bucket pauses, and reporting blackout toggles.

#### ☀️ Light Mode — Simulator Fleet Controls
![Simulator Controls - Light Mode](assets/light-12-simulator-controls.png)

#### 🌙 Dark Mode — Simulator Fleet Controls
![Simulator Controls - Dark Mode](assets/dark-12-simulator-controls.png)

#### ☀️ Light Mode — Active Chaos Modes Triggered
![Simulator Chaos Active - Light Mode](assets/light-13-simulator-chaos-active.png)

#### 🌙 Dark Mode — Active Chaos Modes Triggered
![Simulator Chaos Active - Dark Mode](assets/dark-13-simulator-chaos-active.png)

---

### 6. Automated Incident Lifecycle Management
Automated streak evaluation state machine (`open` $\rightarrow$ `acknowledged` $\rightarrow$ `recovered` $\rightarrow$ `resolved`) with chronological timeline event auditing.

#### ☀️ Light Mode — Active Incidents Queue
![Incidents Overview - Light Mode](assets/light-14-incidents-overview.png)

#### 🌙 Dark Mode — Active Incidents Queue
![Incidents Overview - Dark Mode](assets/dark-14-incidents-overview.png)

#### ☀️ Light Mode — Incident Detail Timeline & Audit Modal
![Incident Detail Modal - Light Mode](assets/light-15-incident-detail-timeline.png)

#### 🌙 Dark Mode — Incident Detail Timeline & Audit Modal
![Incident Detail Modal - Dark Mode](assets/dark-15-incident-detail-timeline.png)

---

### 7. Security Audit Trail & Authentication Portal
Immutable audit log recording every administrative action, parameter change, and chaos trigger with recursive credential redaction and actor attribution.

#### ☀️ Light Mode — Formatted Security Audit Trail
![Audit Trail - Light Mode](assets/light-16-audit-trail.png)

#### 🌙 Dark Mode — Formatted Security Audit Trail
![Audit Trail - Dark Mode](assets/dark-16-audit-trail.png)

#### ☀️ Light Mode — Authentication Portal
![Login View - Light Mode](assets/light-01-login.png)

#### 🌙 Dark Mode — Authentication Portal
![Login View - Dark Mode](assets/dark-01-login.png)

---

## Architecture Overview

```mermaid
flowchart TD
    Client["Browser (Vanilla JS ES Modules + CSS Tokens)"]
    API["FastAPI Backend (Uvicorn)"]
    Auth["Auth & RBAC (Signed Cookies + bcrypt)"]
    MetricsEngine["Metrics Engine (Fixed-Edge Histograms)"]
    IncidentEngine["Incident State Machine (Streak Evaluation)"]
    Simulator["Deterministic Simulator (Async Loop)"]
    DB[("SQLite Database (WAL Mode)")]

    Client <-->|"REST API + Polling (10s)"| API
    API --> Auth
    API --> MetricsEngine
    API --> IncidentEngine
    Simulator -->|"Tick / Evaluate (5s)"| DB
    MetricsEngine <--> DB
    IncidentEngine <--> DB
    Auth <--> DB
```

---

## Tech Stack & Design Decisions

| Layer | Technology | Rationale & Trade-offs |
|---|---|---|
| **Backend** | Python 3.12+, FastAPI, Uvicorn, Pydantic v2 | High-performance asynchronous API, strict schema validation, type safety |
| **Database** | SQLite (WAL mode, Foreign Keys ON) | Zero external daemon dependency, ACID transactions, portable isolated testing |
| **Migrations** | Versioned plain SQL (`001_init.sql`, etc.) | Transparent schema versioning without ORM abstraction overhead |
| **Authentication** | `itsdangerous` signed cookies, `bcrypt` (cost 12) | Stateless HttpOnly SameSite=Lax sessions, server-enforced RBAC on every request |
| **Frontend** | Vanilla HTML5, CSS Custom Properties, ES Modules | Zero build step, instant load, no node_modules bundle pipeline |
| **Visualisation** | Chart.js (vendored in `frontend/vendor/chart.umd.js`) | Local offline execution with zero CDN latency or external dependencies |
| **Testing** | pytest, httpx, pytest-cov, pytest-asyncio, ruff | Deterministic isolated SQLite fixtures, 93%+ coverage |

---

## Project Structure

```text
service-monitoring-dashboard/
├── backend/
│   ├── migrations/          # Versioned plain SQL migrations (001_init.sql, 002_indexes.sql, 003_incident_updates.sql)
│   ├── routes/              # FastAPI API route modules (auth.py, metrics.py, services.py, incidents.py, sim.py, audit.py, export.py)
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
│   ├── css/
│   │   └── styles.css       # Unified design system (tokens, layout, components, themes)
│   ├── js/
│   │   ├── views/           # SPA view controllers (dashboard.js, services.js, service-detail.js, incidents.js, audit.js, simulator.js)
│   │   ├── api.js           # Fetch wrapper with CSRF headers, sequence tracking, and error mapping
│   │   ├── app.js           # SPA shell, authentication bootloader, theme switcher, layout management
│   │   ├── poller.js        # Interval polling helper with document visibility lifecycle management
│   │   ├── router.js        # Hash-based client router with dynamic parameter matching
│   │   └── ui.js            # Reusable DOM builders (badges, skeletons, modals, toasts, cards)
│   ├── vendor/
│   │   └── chart.umd.js     # Locally vendored chart bundle (no external CDN)
│   └── index.html           # Single-page application entrypoint
├── docs/                    # Architectural documentation, assumptions, test report, review guide, demo script
├── scripts/                 # Helper & demo scripts (check_docs.py, sim_demo.py, verify_api_live.py, capture_full_suite.py)
├── tests/                   # Automated pytest suite (test_docs.py, test_metrics.py, test_status.py, test_api.py, etc.)
├── assets/                  # High-resolution dashboard screenshots in Light & Dark modes
├── pyproject.toml           # Project metadata, dependencies, ruff, and pytest configurations
└── uv.lock                  # Deterministic dependency lockfile
```

---

## Quickstart & Setup Guide

### Option A: Using `uv` (Recommended)

```bash
# 1. Install dependencies
uv sync

# 2. Run database migrations
uv run python -m backend.db migrate

# 3. Seed initial users, services, thresholds, and historical metrics
uv run python -m backend.seed

# 4. Start the application server
uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

### Option B: Using Python Virtual Environment (`venv` / `virtualenv`)

```bash
# 1. Create and activate virtual environment
python3 -m venv .venv || virtualenv .venv
source .venv/bin/activate

# 2. Install dependencies
pip install -e .
# Or install direct requirements:
pip install "bcrypt>=5.0.0" "fastapi>=0.115.0" "itsdangerous>=2.2.0" "pydantic>=2.10.0" "uvicorn[standard]>=0.30.0"

# 3. Run migrations and seed data
python -m backend.db migrate
python -m backend.seed

# 4. Start server
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Access the dashboard at **`http://127.0.0.1:8000/`**.

---

## Demo Credentials & Access Control

| Username | Password | Role | Permissions & Capabilities |
|---|---|---|---|
| **`viewer`** | `Viewer#2026!` | `Viewer` | **Read-Only**: Access live telemetry overview, service health matrix, continuous charts, incident timelines, and CSV data export. |
| **`admin`** | `Admin#2026!` | `Admin` | **Full Control**: All viewer permissions + update alerting thresholds, toggle simulator chaos modes (`normal`, `slow`, `failing`, `recovering`), pause traffic, acknowledge/resolve incidents, and inspect security audit log. |

---

## Environment Configuration

Configure custom options in `.env` (refer to `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `MD_DB_PATH` | `monitoring.db` | Path to the SQLite database file |
| `MD_SECRET_KEY` | `insecure-dev-secret-key-change-in-production` | Secret key for cryptographic cookie signing (`itsdangerous`) |
| `MD_SIM_SEED` | `42` | Seed integer for deterministic pseudo-random traffic simulation |
| `MD_SIM_TICK` | `5.0` | Simulator tick interval in seconds |
| `MD_SIM_ENABLED` | `1` | Set `0` to disable background simulation loop (useful during test runs) |
| `MD_SECURE_COOKIES` | `false` | Enable `Secure` cookie flag (set `true` when behind HTTPS) |
| `MD_STALE_AFTER_S` | `180` | Age threshold in seconds before telemetry is marked Stale (`gray`) |
| `MD_ACTIVE_USER_WINDOW_M` | `15` | Window in minutes for calculating active registered users |
| `MD_BCRYPT_ROUNDS` | `12` | Cost factor for bcrypt password hashing (lowered in test environment) |
| `MD_SESSION_MAX_AGE_S` | `86400` | Session cookie validity max age in seconds (24 hours) |
| `MD_RATE_LIMIT_MAX_ATTEMPTS` | `5` | Maximum failed login attempts allowed per `(user, IP)` |
| `MD_RATE_LIMIT_WINDOW_S` | `300` | Sliding window in seconds for failed login rate limiting (5 minutes) |

---

## REST API Reference

All API responses use JSON and require an authenticated session cookie unless marked **Public**.

| Method | Endpoint | Minimum Role | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Liveness check and operational status |
| `POST` | `/auth/login` | Public | Authenticate user credentials, set signed HTTP-only cookie |
| `POST` | `/auth/logout` | Public | Clear session cookie |
| `GET` | `/auth/me` | Viewer | Retrieve current authenticated user profile and role |
| `GET` | `/metrics/overview` | Viewer | High-level KPI summary cards across range and product filters |
| `GET` | `/metrics/history` | Viewer | Continuous minute-by-minute time series for request & latency charts |
| `GET` | `/services` | Viewer | Paginated list of monitored services with health badges and metrics |
| `GET` | `/services/{id}` | Viewer | Service detail, threshold rationale, continuous charts, sim state |
| `PUT` | `/services/{id}/thresholds` | Admin | Update service alerting thresholds (audit logged) |
| `POST` | `/sim/{id}/mode` | Admin | Change simulator mode (`normal`, `slow`, `failing`, `recovering`) |
| `POST` | `/sim/{id}/pause` | Admin | Toggle traffic pause (writes zero-request buckets) |
| `POST` | `/sim/{id}/reporting` | Admin | Toggle reporting pause (emits no buckets $\rightarrow$ triggers Stale status) |
| `GET` | `/incidents` | Viewer | Paginated incidents list filtered by status |
| `GET` | `/incidents/{id}` | Viewer | Incident details with chronological timeline of state changes |
| `POST` | `/incidents/{id}/ack` | Admin | Acknowledge open incident |
| `POST` | `/incidents/{id}/resolve` | Admin | Resolve active incident (from open, acknowledged, or recovered) |
| `GET` | `/audit` | Admin | Paginated security audit trail with credential redaction |
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
   - Bins are merged element-wise across time buckets ($O(1)$ space per minute).
   - Percentiles are interpolated linearly inside the target rank bin.

---

## Health Evaluation Precedence

The health status engine evaluates each service over a trailing 3-minute window with strict precedence rules:

```mermaid
flowchart TD
    Start["Evaluate Service Metrics (Trailing 3m)"] --> CheckStale{"No buckets OR newest bucket > stale_after_s OR requests == 0?"}
    CheckStale -->|"Yes"| Stale["STALE / NO DATA (Gray)"]
    CheckStale -->|"No"| CheckFailing{"Error Rate > max_error_pct?"}
    CheckFailing -->|"Yes"| Failing["FAILING (Red)"]
    CheckFailing -->|"No"| CheckSlow{"p95 Latency > max_p95_ms?"}
    CheckSlow -->|"Yes"| Slow["SLOW (Amber/Red)"]
    CheckSlow -->|"No"| Healthy["HEALTHY (Green)"]
```

---

## Testing & Quality Assurance

The repository includes a comprehensive automated test suite with **133 tests** covering unit, integration, security, and documentation integrity.

- 📄 Read the complete [Automated Test & QA Report](docs/test-report.md) for module-by-module results and coverage metrics.

```bash
# Run full test suite with backend coverage
pytest --cov=backend

# Run static analysis and linting
ruff check .

# Verify documentation file references
python -m scripts.check_docs
```

---

## Author & Maintainer

- **Developer:** Hammad (AI Engineer & Developer)
- **Email:** [aiwithhammad2026@gmail.com](mailto:aiwithhammad2026@gmail.com)
- **Repository:** [aiwithhammad2026-arch/service-monitoring-dashboard](https://github.com/aiwithhammad2026-arch/service-monitoring-dashboard)
