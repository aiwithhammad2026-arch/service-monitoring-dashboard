-- Migration 002_indexes.sql: Performance indexes and partial unique constraint
-- Service Monitoring Dashboard

-- Partial unique index: Enforces exactly one active incident per (service, type)
-- Active incidents are any incident with status != 'resolved' (i.e. open, acknowledged, recovered).
-- Once resolved, a new incident can be opened for that (service, type).
CREATE UNIQUE INDEX IF NOT EXISTS one_active_incident
ON incidents(service_id, type)
WHERE status != 'resolved';

-- Time-series lookup optimization for dashboard metric charts
CREATE INDEX IF NOT EXISTS idx_metric_buckets_service_time
ON metric_buckets(service_id, bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_metric_buckets_time
ON metric_buckets(bucket_start DESC);

-- Incident filtering and sorting indexes
CREATE INDEX IF NOT EXISTS idx_incidents_status_opened
ON incidents(status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_service
ON incidents(service_id, opened_at DESC);

-- Incident timeline events lookup
CREATE INDEX IF NOT EXISTS idx_incident_events_incident
ON incident_events(incident_id, created_at ASC);

-- Audit log chronology
CREATE INDEX IF NOT EXISTS idx_audit_log_created
ON audit_log(created_at DESC);

-- App users lookup by activity window and product
CREATE INDEX IF NOT EXISTS idx_app_users_last_seen
ON app_users(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_users_product
ON app_users(product);
