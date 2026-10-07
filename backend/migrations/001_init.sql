-- Migration 001_init.sql: Core schema tables and constraints
-- Service Monitoring Dashboard

-- 1. User accounts for the operations dashboard (admin and viewer roles)
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    created_at TEXT NOT NULL
);

-- 2. Synthetic app users for product active/registered users telemetry
CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    product TEXT NOT NULL CHECK (product IN ('website', 'app', 'admin_console')),
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

-- 3. Monitored services catalog
CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    product TEXT NOT NULL CHECK (product IN ('website', 'app', 'admin_console')),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

-- 4. Administrator-configurable monitoring thresholds per service
CREATE TABLE IF NOT EXISTS thresholds (
    service_id TEXT PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
    max_error_pct REAL NOT NULL DEFAULT 5.0 CHECK (max_error_pct >= 0.0 AND max_error_pct <= 100.0),
    max_p95_ms REAL NOT NULL DEFAULT 800.0 CHECK (max_p95_ms >= 1.0 AND max_p95_ms <= 60000.0),
    stale_after_s INTEGER NOT NULL DEFAULT 180 CHECK (stale_after_s >= 30 AND stale_after_s <= 3600),
    updated_at TEXT NOT NULL
);

-- 5. Per-service simulator state controls (failure vs missing data simulation)
CREATE TABLE IF NOT EXISTS sim_state (
    service_id TEXT PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal', 'slow', 'failing', 'recovering')),
    paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
    reporting_paused INTEGER NOT NULL DEFAULT 0 CHECK (reporting_paused IN (0, 1)),
    mode_since TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 6. Minute-level aggregated telemetry buckets
CREATE TABLE IF NOT EXISTS metric_buckets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    bucket_start TEXT NOT NULL, -- UTC ISO-8601 minute bucket (e.g. 2026-10-06T19:00:00Z)
    requests INTEGER NOT NULL CHECK (requests >= 0),
    errors INTEGER NOT NULL CHECK (errors >= 0),
    latency_p50 REAL,           -- Median latency in ms (NULL if requests = 0)
    latency_p95 REAL,           -- 95th percentile latency in ms (NULL if requests = 0)
    latency_hist TEXT NOT NULL, -- JSON array of histogram counts
    created_at TEXT NOT NULL,
    UNIQUE (service_id, bucket_start),
    CHECK (errors <= requests)  -- Errors cannot exceed total request count
);

-- 7. Incidents tracked across the state machine (open -> acknowledged -> recovered -> resolved)
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('error_rate', 'latency_p95', 'stale_data')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'recovered', 'resolved')),
    healthy_streak INTEGER NOT NULL DEFAULT 0 CHECK (healthy_streak >= 0),
    last_bucket TEXT,
    summary TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    acknowledged_at TEXT,
    recovered_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 8. Audit trail of timeline events for incidents
CREATE TABLE IF NOT EXISTS incident_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'acknowledged', 'recovered', 'reopened', 'resolved', 'note')),
    from_status TEXT,
    to_status TEXT,
    actor TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 9. Immutable audit log for administrative changes
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details TEXT NOT NULL, -- JSON metadata describing the change
    created_at TEXT NOT NULL
);

-- 10. Simulator metadata state (seed, tick, last simulation cycle)
CREATE TABLE IF NOT EXISTS sim_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
