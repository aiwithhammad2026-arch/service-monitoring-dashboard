# Architectural Assumptions and Metric Specifications

## 1. Metric Calculations
- **Active User Definition:** An active user is defined as any registered synthetic user with `last_seen_at` within the configured activity window (`MD_ACTIVE_USER_WINDOW_M`, default 15 minutes) relative to evaluation time `now`.
- **Requests Per Minute (RPM):**
  $$\text{RPM} = \frac{\text{Total Requests in Window}}{\text{Total Minutes in Window}}$$
  The denominator is the full duration of the window (e.g. 15, 60, 360, 1440 minutes), not merely the count of minutes that contain reported data. When total requests equal zero, RPM is `0.0`.
- **Zero-Traffic Nulls:**
  When zero requests are recorded in an evaluation window:
  - Success percentage returns `null` (never `0%` or `100%`).
  - Error percentage returns `null` (never `0%` or `100%`).
  - Average latency, p50, and p95 latency return `null`.
  - The UI displays "No data".
- **Fixed-Edge Latency Histograms:**
  - 18 bins defined by 17 finite edges + $\infty$:
    `[5, 10, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000, 3000, 5000, +inf]` (all in milliseconds).
  - **Merging Rule:** Percentiles are never computed by averaging minute-level percentiles. Instead, histogram bins are summed element-wise across time buckets, and the target percentile is evaluated on the merged histogram.
  - **Linear Interpolation:** Inside the bin containing the target rank $R = \frac{p}{100} \cdot N$, the percentile is interpolated linearly between lower bound $L$ and upper bound $U$ (for bin 0, $L = 0$). For the $+inf$ bin (> 5000 ms), the value is capped at 5000 ms as a documented finite ceiling.

## 2. Service Health Status Evaluation
Evaluated over the recent 3-minute bucket window in strict priority order:
1. **No Data / Stale:**
   - If a service has no recorded buckets, or if its newest bucket is older than `stale_after_s` (default 180s), status is **gray ("No data" / "Stale")**.
   - If the last 3 minute-buckets record zero total requests, status is **gray ("No data")**.
2. **Failing (Error Rate Breach):**
   - If aggregated error percentage exceeds `max_error_pct` (default 5.0%), status is **red ("Failing")**.
3. **Slow (Latency Breach):**
   - If aggregated p95 latency exceeds `max_p95_ms` (default 800.0 ms), status is **red ("Slow")**.
4. **Healthy:**
   - Otherwise, status is **green ("Healthy")**.

### Strict Threshold Boundaries
- Threshold comparisons are strictly greater than (`>`):
  - An error rate of exactly 5.0% when `max_error_pct = 5.0%` is **Healthy**, not failing.
  - A p95 latency of exactly 800.0 ms when `max_p95_ms = 800.0 ms` is **Healthy**, not slow.

## 3. Incident Breaches
- `breaches()` returns active breach conditions: `error_rate`, `latency`, `stale`.
- When a service has zero buckets or its newest bucket is older than `stale_after_s`, it reports `stale` (consistent with gray status).
- If both error rate and latency are breached simultaneously, `breaches()` returns both `['error_rate', 'latency']`. Status evaluation prioritizes `Failing` (red) over `Slow` (red).

## 4. Time Handling
- All internal dates, storage timestamps, and calculations operate in **UTC ISO-8601**.
- Minute buckets are floored to the minute boundary (`YYYY-MM-DDTHH:MM:00Z`).
- Functions accept an injected `now` parameter to ensure 100% deterministic testing.

## 5. Deterministic Traffic Simulator

### RNG Keying
- Each bucket is generated with `random.Random(f"{seed}:{service_id}:{bucket_start}")`.
- The same `(seed, service_id, bucket_start)` triple always produces identical requests, errors, and histogram — regardless of wall-clock time or insertion order.
- Different seeds, services, or minutes produce different data (collision probability negligible).

### Mode Profiles
| Mode | ~Error Rate | Latency Profile |
|------|-------------|-----------------|
| `normal` | ~2% (1.5–2.5%) | p50 ≈120ms, p95 ≈270ms |
| `slow` | ~2% | p50 ≈720ms, p95 ≈1600ms (latency ×6 via shifted histogram weights) |
| `failing` | ~40% (38–42%) | Same latency as normal |
| `recovering` | Linear blend 40%→2% over 300s | Linear histogram blend slow→normal |

### Recovering Auto-Switch
- After 300 seconds of elapsed time since `mode_since`, the simulator automatically sets `mode = 'normal'` in `sim_state`. No manual intervention required.

### Pause vs Reporting-Pause Distinction
- **`paused=1`**: Service sends zero-request buckets (`requests=0, errors=0`, empty histogram). This models a service that is intentionally offline but still reporting its silence. Status → gray ("No data" due to zero traffic).
- **`reporting_paused=1`**: No bucket is written at all. Data goes stale after `stale_after_s`. Status → gray ("Stale"). This models a service that has lost observability (e.g. log pipeline failure, sidecar crash).

### Synthetic User Touching
- Each tick selects `randint(20, 35)` user IDs from the 200 seeded `app_users` using `random.Random(f"{seed}:users:{bucket_start}")`.
- Updates `last_seen_at = now` for those IDs, moving the "active users" KPI visibly.
- Different bucket_starts touch different user subsets (deterministic but varied).

### Async Loop Architecture
- `tick(conn, now, seed)` is a **pure synchronous function** fully testable without `asyncio`.
- `SimulatorService._loop()` is a thin async wrapper that calls `tick` via `asyncio.to_thread` every `MD_SIM_TICK` seconds (default 5s).
- Any exception in a tick is logged and the loop continues — a single bad tick never kills the service.
- `MD_SIM_ENABLED=0` disables the entire loop before it starts.

## 6. Incident State Machine and Audit Logging (Task 06)

### Incident Types and Deduplication
- **Types:** `error_rate`, `latency`, `stale`.
- **One Active Incident Constraint:** Enforced in two layers:
  1. **Engine query:** `get_active_incident()` checks for any existing incident where `status != 'resolved'` for that `(service_id, type)`.
  2. **Database safety net:** Partial unique index `one_active_incident` ON `incidents(service_id, type) WHERE status != 'resolved'` prevents duplicate active rows even under concurrent execution. Any `IntegrityError` is safely caught.

### State Transitions and Recovery
- **`open` (Initial Breach):** Created automatically on the first breached bucket with timeline event `opened`.
- **`acknowledged` (Admin Action):** Admin acknowledges an `open` incident. Status becomes `acknowledged`; an audit log entry and timeline event `acknowledged` are recorded.
- **`recovered` (3 Consecutive Healthy Buckets):**
  - An `open` or `acknowledged` incident recovers when **3 consecutive healthy NEW minute buckets** arrive (`healthy_streak >= 3`).
  - Progression tracks `last_bucket` so sub-minute ticks within the same minute bucket do not prematurely advance the streak.
  - Consistent with the status engine: status turns green healthy when all 3 trailing window buckets are healthy, preventing metric flapping.
- **`reopened` (Breach Recurrence):** If a `recovered` incident encounters a new breach before being resolved by an admin, it transitions back to `open` (event `reopened`) using the same incident row ID without creating duplicate rows.
- **`resolved` (Admin Resolution):** Admin resolves an incident from `open`, `acknowledged`, or `recovered`. Status becomes `resolved`; audit log and timeline event `resolved` are written. Once resolved, subsequent breaches will create a new incident.

### Admin Transition Conflict Handling
- Invalid state transitions (e.g., acknowledging an already acknowledged or recovered incident, or resolving an already resolved incident) raise `ConflictError` (HTTP 409) with structured error payload `{"error": {"code": "CONFLICT", "message": "..."}}`.

### Audit Trail and Security Redaction
- Immutable audit log records administrative changes: logins, threshold changes, simulator toggles, incident acknowledgement, resolution, and notes.
- Automatic recursive credential redaction: any field key containing `password`, `token`, `secret`, `cookie`, `session`, `auth`, or `authorization` (case-insensitive, at any nesting level in dicts/lists) is replaced with `"[REDACTED]"`.

## 7. REST API Layer, Authorization, and CSV Export (Task 07)

### Route Specification & RBAC
| Method | Route | Minimum Role | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | System liveness and environment status |
| `POST` | `/auth/login` | Public | Session creation with bcrypt verification |
| `POST` | `/auth/logout` | Public | Session termination and cookie deletion |
| `GET` | `/auth/me` | Viewer+ | Current authenticated user identity |
| `GET` | `/metrics/overview` | Viewer+ | High-level dashboard KPI summary cards |
| `GET` | `/metrics/history` | Viewer+ | Minute-by-minute continuous chart time series |
| `GET` | `/services` | Viewer+ | Paginated service status list with RPM and p95 |
| `GET` | `/services/{id}` | Viewer+ | Service detail, status, thresholds, and sim state |
| `PUT` | `/services/{id}/thresholds` | Admin | Update monitoring thresholds (audit logged) |
| `POST` | `/sim/{id}/mode` | Admin | Simulator traffic mode change (`mode_since` recorded) |
| `POST` | `/sim/{id}/pause` | Admin | Traffic pause toggle (writes zero-traffic buckets) |
| `POST` | `/sim/{id}/reporting` | Admin | Telemetry reporting pause (causes stale transition) |
| `GET` | `/incidents` | Viewer+ | Paginated incident list filtered by status |
| `GET` | `/incidents/{id}` | Viewer+ | Incident detail and event timeline |
| `POST` | `/incidents/{id}/ack` | Admin | Acknowledge incident (`open` → `acknowledged`) |
| `POST` | `/incidents/{id}/resolve` | Admin | Resolve incident (`*` → `resolved`) |
| `GET` | `/audit` | Admin | Paginated audit log records |
| `GET` | `/export/metrics.csv` | Viewer+ | Safe CSV export of metric buckets |
| `GET` | `/export/incidents.csv` | Viewer+ | Safe CSV export of incidents |

### Allow-lists & Validation Rules
- **Range (`range`):** Allowed values: `15m`, `1h`, `6h`, `24h`. Anything else returns `422 VALIDATION_ERROR`.
- **Product (`product`):** Allowed values: `all`, `website`, `app`, `admin_console`. Returns `422` if invalid.
- **Service Status (`status`):** Allowed values: `all`, `green`, `red`, `gray`. Returns `422` if invalid.
- **Simulator Mode (`mode`):** Allowed values: `normal`, `slow`, `failing`, `recovering`. Returns `422` if invalid.
- **Incident Status (`status`):** Allowed values: `all`, `open`, `acknowledged`, `recovered`, `resolved`. Returns `422` if invalid.
- **Pagination:** `page >= 1` (returns `422` if `< 1`). `page_size >= 1`, automatically clamped at maximum `100` (`page_size=1000` is safely clamped to `100`).
- **Threshold Ranges:**
  - `max_error_pct`: `0.0` to `100.0`
  - `max_p95_ms`: `1.0` to `60000.0` (milliseconds)
  - `stale_after_s`: `30` to `3600` (seconds)
  - Out-of-bounds values (e.g. 150%, -5%, or 0 ms) return `422 VALIDATION_ERROR`.

### Uniform Error Format
All errors (400, 401, 403, 404, 409, 422, 429, 500) strictly adhere to:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```
- **401 Unauthorized:** Missing or expired session cookie (`code: "UNAUTHORIZED"`).
- **403 Forbidden:** Authenticated user lacks required role (`code: "FORBIDDEN"`) or missing `X-Requested-With` header on mutating requests (`code: "CSRF_FAILED"`).
- **404 Not Found:** Resource not found (`code: "NOT_FOUND"`).
- **409 Conflict:** Invalid state machine transition (`code: "CONFLICT"`).
- **422 Validation Error:** Malformed payload or out-of-range parameter (`code: "VALIDATION_ERROR"`).

### CSV Formula Injection Defense
CSV exports stream with `Content-Disposition: attachment; filename="..."` and encode values safely. Any cell whose first character is `=`, `+`, `-`, `@`, `\t`, or `\r` is automatically prefixed with a single quote (`'`), neutralizing dynamic formula execution in spreadsheet software while preserving human readability.


