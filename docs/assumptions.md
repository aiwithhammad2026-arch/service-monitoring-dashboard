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
