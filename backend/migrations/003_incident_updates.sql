-- Migration 003_incident_updates.sql: Update incidents table check constraints for types
-- Update type check constraint to strictly allow canonical types: 'error_rate', 'latency', 'stale'

PRAGMA foreign_keys=OFF;

CREATE TABLE incidents_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('error_rate', 'latency', 'stale')),
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

INSERT INTO incidents_new (
    id, service_id, type, status, healthy_streak, last_bucket,
    summary, opened_at, acknowledged_at, recovered_at, resolved_at,
    created_at, updated_at
)
SELECT
    id, service_id,
    CASE
        WHEN type = 'latency_p95' THEN 'latency'
        WHEN type = 'stale_data' THEN 'stale'
        ELSE type
    END,
    status, healthy_streak, last_bucket,
    summary, opened_at, acknowledged_at, recovered_at, resolved_at,
    created_at, updated_at
FROM incidents;

DROP TABLE incidents;

ALTER TABLE incidents_new RENAME TO incidents;

-- Recreate indexes on the newly rebuilt table
CREATE UNIQUE INDEX IF NOT EXISTS one_active_incident
ON incidents(service_id, type)
WHERE status != 'resolved';

CREATE INDEX IF NOT EXISTS idx_incidents_status_opened
ON incidents(status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_service
ON incidents(service_id, opened_at DESC);

PRAGMA foreign_keys=ON;
