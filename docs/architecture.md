# Architecture Overview — Service Monitoring Dashboard

## System Overview
Service Monitoring Dashboard is a standalone operations monitoring dashboard built for a fictional platform with three products: Website, App, and Admin Console.

## Core Components
- **Backend:** FastAPI, Uvicorn, SQLite in WAL mode with plain SQL migrations.
- **Frontend:** Vanilla modern ES modules, CSS design tokens, locally vendored Chart.js.
- **Simulator:** Deterministic background traffic generator emitting request metrics across 10 simulated services.
- **Metrics Engine:** Fixed-edge latency histograms, p50/p95 calculations, active users window, requests/min.
- **Incident State Machine:** Deterministic breach detection, alert deduplication, partial unique constraints, and timeline audit logging.

## Frontend Screens
- `#/login`: Authentication view with username and password inputs, form validation, and credential verification.
- `#/dashboard`: High-level operations dashboard with time range/product filtering, 8 KPI cards with formula popovers, continuous request volume & latency charts, and service status grid.
- `#/services`: Filterable and searchable paginated service directory showing real-time health badges, RPM, error rates, and p95 latencies.
- `#/services/:id`: Service detail view displaying threshold rationale, KPI metrics, continuous 1-hour line charts, incident history, and admin threshold/simulator controls.
- `#/incidents`: Incident management dashboard with status filters, chronological event timeline drawer, and admin acknowledge/resolve action flows.
- `#/audit`: Admin audit log table with pagination and safe streaming CSV export downloads for metrics and incidents.
- `#/simulator`: Simulator control matrix for failure injection, traffic pause toggles, and reporting pause simulation.
