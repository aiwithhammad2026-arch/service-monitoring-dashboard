# Architecture Overview — Service Monitoring Dashboard

## 1. System Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│              Browser Client (Vanilla JS ES Modules)         │
│  - SPA Hash Router (#/dashboard, #/services, #/incidents)    │
│  - CSS Design Tokens (Dark / Light responsive theme)        │
│  - 10s Visibility-Aware Poller                              │
│  - Locally Vendored Chart.js                                │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / Signed Cookie Session
┌──────────────────────────────▼──────────────────────────────┐
│                    FastAPI Backend Application              │
│  ├── /auth        : Password auth, session cookies, RBAC   │
│  ├── /metrics     : Overview KPIs & continuous history      │
│  ├── /services    : Health evaluations & threshold updates  │
│  ├── /incidents   : Incident lifecycle & timeline events    │
│  ├── /sim         : Chaos toggles & mode controls           │
│  ├── /audit       : Immutable admin action trail            │
│  └── /export      : Sanitized CSV streaming                 │
├──────────────────────────────┬──────────────────────────────┤
│ Metrics & Status Engine      │ Incident State Machine       │
│ - Fixed-edge hist merge      │ - Streak-based recovery (3x) │
│ - Linear p50/p95 calc        │ - Reopen on recurring breach │
│ - Precedence: gray>red>green │ - Partial unique index dedup │
├──────────────────────────────┴──────────────────────────────┤
│ Deterministic Background Simulator                          │
│ - Async loop (5s ticks) with pure synchronous tick() engine │
│ - Seeded PRNG keyed by (seed:service:minute)                │
└──────────────────────────────┬──────────────────────────────┘
                               │ SQLite WAL Connection
┌──────────────────────────────▼──────────────────────────────┐
│                     SQLite Database                         │
│  - WAL Mode, PRAGMA foreign_keys = ON, PRAGMA busy_timeout  │
│  - Plain SQL migrations (schema_migrations tracking table)  │
│  - Tables: accounts, app_users, services, thresholds,       │
│    sim_state, metric_buckets, incidents, incident_events,   │
│    audit_logs                                               │
└─────────────────────────────────────────────────────────────┘
```

## 2. Core Modules & Responsibilities

- **`backend/db.py`**: SQLite connection factory enforcing WAL journal mode, active foreign keys, and synchronous NORMAL. Handles plain SQL migrations.
- **`backend/auth.py`**: Stateless session management using `itsdangerous` URLSafeTimedSerializer stored in `HttpOnly`, `SameSite=Lax` cookies. User account existence and role are re-verified from the database on every request. In-memory sliding-window failed login rate limiting (5 attempts / 5 min).
- **`backend/metrics.py`**: Core telemetry aggregation. Implements 18-bin fixed-edge histogram merging and linear percentile interpolation. Zero traffic returns `null`.
- **`backend/status.py`**: Evaluates service health across the trailing 3-minute bucket window using strict priority: (1) `No data` / `Stale` (gray), (2) `Failing` (red), (3) `Slow` (red), (4) `Healthy` (green). Strict greater-than comparisons.
- **`backend/incidents.py`**: Incident lifecycle management (`open` → `acknowledged` → `recovered` → `resolved`). Deduplication enforced via partial unique index `one_active_incident` ON `incidents(service_id, type) WHERE status != 'resolved'`. Recovers after 3 consecutive healthy minute buckets; reopens existing incident row if breached before resolution.
- **`backend/simulator.py`**: Deterministic background traffic generator running every 5 seconds. Uses `random.Random(f"{seed}:{service_id}:{bucket_start}")` for 100% reproducible traffic across 4 modes (`normal`, `slow`, `failing`, `recovering`). Distinct handling for traffic pausing (`paused=1` writes 0-request buckets) vs telemetry pause (`reporting_paused=1` writes no bucket, inducing Stale status).
- **`backend/audit.py`**: Centralized audit log writer with automatic recursive redaction for sensitive keys (passwords, tokens, cookies, secrets).
- **`frontend/js/`**: Client SPA utilizing hash routing, dynamic DOM generation via safe standard web APIs (no prohibited injection APIs), CSS custom property tokens, and isolated view lifecycles.
- **`frontend/css/styles.css`**: Soft Bento design system featuring a floating sheet canvas, pill navigation, bento grids, big numerals (40-64px tabular-nums), and WCAG-tested contrast (>= 4.5:1) in dark and light themes.
- **`frontend/js/charts-theme.js`**: Data visualization theme layer providing diagonal-hatch canvas patterns for request bars, stepped line latency curves, dot-matrix mini histograms, and status progress bars.
