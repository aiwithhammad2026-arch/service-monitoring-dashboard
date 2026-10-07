# Architecture Overview — Service Monitoring Dashboard

## System Overview
Service Monitoring Dashboard is a standalone operations monitoring dashboard built for a fictional platform with three products: Website, App, and Admin Console.

## Core Components
- **Backend:** FastAPI, Uvicorn, SQLite in WAL mode with plain SQL migrations.
- **Frontend:** Vanilla modern ES modules, CSS design tokens, locally vendored Chart.js.
- **Simulator:** Deterministic background traffic generator emitting request metrics across 10 simulated services.
- **Metrics Engine:** Fixed-edge latency histograms, p50/p95 calculations, active users window, requests/min.
- **Incident State Machine:** Deterministic breach detection, alert deduplication, partial unique constraints, and timeline audit logging.
