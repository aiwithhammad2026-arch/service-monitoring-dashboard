# Technical Review Guide & Explanation Sheet

This guide provides plain-language explanations for core architectural mechanisms in the Service Monitoring Dashboard, followed by an exact change map for likely live review modifications.

---

## 1. Core Architectural Concepts

### 1. Why Histograms Are Merged (Never Average Percentiles)
- **Problem:** You cannot mathematically average percentiles across time intervals because percentiles are non-linear order statistics and do not account for sample volume.
- **Analogy:** Suppose Minute 1 has **10 requests** averaging 50 ms (p50 = 50 ms). Minute 2 has **10,000 requests** during a traffic surge averaging 500 ms (p50 = 500 ms).
  - *Naive Average:* $(50 + 500) / 2 = 275\text{ ms}$.
  - *True Merged p50:* Rank 5,005 out of 10,010 requests falls squarely within the 500 ms traffic surge! The true p50 is ~500 ms. Averaging would distort reality by nearly 50%.
- **Implementation (`backend/metrics.py`):** We store counts across 18 fixed-edge histogram bins for each minute bucket. To compute p50 or p95 over an arbitrary time window (15m, 1h, 24h), we sum each bin across all minute buckets (`merge_hists`), then interpolate the target rank linearly within the containing bin (`percentile`).

---

### 2. How Alert Deduplication Works at the Database Level
- **Mechanism:** Dual-layer defense:
  1. *Engine Layer (`backend/incidents.py`):* `get_active_incident(conn, service_id, type)` queries for any existing record where `status != 'resolved'`. If found, the tick updates the existing incident (e.g. increments healthy streak or records notes) rather than creating a new one.
  2. *Database Safety Net (`backend/migrations/002_indexes.sql`):* A partial unique index:
     ```sql
     CREATE UNIQUE INDEX one_active_incident
     ON incidents(service_id, type)
     WHERE status != 'resolved';
     ```
- **IntegrityError Handling:** If concurrent ticks attempt to insert an incident for the same active breach, SQLite raises an `IntegrityError`. The incident engine catches this constraint violation gracefully, rolls back the insert attempt, and attaches to the existing active incident.

---

### 3. Why 401 Unauthorized Differs From 403 Forbidden
- **401 Unauthorized (`backend/auth.py`):** "Who are you?" The client provided no session cookie, an expired session cookie, or an invalid cryptographic signature. The client is unauthenticated and must log in.
- **403 Forbidden (`backend/auth.py`, `backend/main.py`):** "I know who you are, but you cannot do this." The client is authenticated (e.g. logged in as `viewer`), but attempts an administrative write operation (e.g. `PUT /services/{id}/thresholds` or `POST /incidents/{id}/ack`) or omits the required `x-requested-with` CSRF header (`backend/main.py`).

---

### 4. Failing (Red, Reporting) vs. Stale (Gray, Not Reporting)
- **Failing (`mode = 'failing'`):** The service is actively communicating and reporting metrics, but its error percentage exceeds `max_error_pct` (e.g. 40% errors). It writes fresh minute buckets every tick. Status = **Red ("Failing")**.
- **Stale (`mode = 'normal'`, `reporting_paused = 1`):** The service has stopped emitting telemetry altogether (e.g. log pipeline broken or service host unreachable). No buckets are written. When the newest bucket exceeds `stale_after_s` (180s), status turns **Gray ("Stale")**.
- **Key Distinction:** A failing service is broken but observable (Red). A stale service has lost observability (Gray).

---

### 5. Server Restart Recovery
- **Stateless Application Process:** No incident states, simulator modes, or metric counters live solely in RAM.
- **SQLite Persistence:** All service simulator states (`sim_state`), thresholds (`thresholds`), metric buckets (`metric_buckets`), and active incidents (`incidents`) are committed to SQLite.
- **Recovery:** When FastAPI or Uvicorn restarts, the next simulation tick reads `sim_state` and `incidents` directly from the database file, seamlessly continuing existing failure modes and streaks without duplicate alerts or state loss.

---

### 6. Why Status Can Stay Red 1 to 2 Minutes After Recovery
- **3-Bucket Evaluation Window:** The status engine (`backend/status.py`) evaluates health by aggregating telemetry across the **last 3 minute buckets** (3-minute rolling window).
- **Explanation:** If Minute 1 and Minute 2 had 40% error rates, and Minute 3 arrives with 0% errors (healthy), the 3-minute aggregate may still exceed the 5% threshold ($40 + 40 + 0 = 80\text{ errors} / 300\text{ reqs} = 26.7\%$).
- **Benefit:** This intentional hysteresis prevents rapid status flickering (flapping) during intermittent or noisy recovery periods. Status turns green only when the full 3-minute window stabilizes.

---

### 7. Why `paused=1` Writes Zero-Request Buckets vs. `reporting_paused=1` Writes None
- **`paused=1` (Traffic Paused):** The service is alive and telemetry is working, but it receives zero client traffic. It writes a valid minute bucket with `requests = 0, errors = 0`. Status = **Gray ("No data")**.
- **`reporting_paused=1` (Reporting Paused):** The telemetry pipeline itself is severed. The simulator writes **no row** to `metric_buckets`. After 180 seconds elapse with no new rows, status = **Gray ("Stale")**.

---

## 2. Where to Edit for Likely Change Requests

| Change Request | Files to Modify | Exact Functions / Symbols | Tests to Update |
|---|---|---|---|
| **Change Active-User Window** | `backend/config.py`<br>`backend/metrics.py` | `Settings.active_user_window_m`<br>`overview()` (`last_seen_at >= ?` delta) | `tests/test_metrics.py`<br>`tests/test_simulator.py` |
| **Add a New Service** | `backend/seed.py` | `SERVICES_CATALOG` (re-run `uv run python -m backend.seed`; applied migrations are never edited) | `tests/test_api.py::test_pagination_and_clamping`<br>`tests/test_db_and_seed.py::test_seed_twice_does_not_duplicate_rows` |
| **Change Default Thresholds** | `backend/seed.py`<br>`backend/config.py`<br>`backend/status.py` | `seed()` in `seed.py`<br>`Settings.stale_after_s`<br>`get_service_thresholds()` | `tests/test_status.py`<br>`tests/test_metrics.py` |
| **New Status Filter or Column** | `backend/routes/services.py`<br>`frontend/js/views/services.js` | `ALLOWED_STATUSES` in `list_services()`<br>`renderTable()` | `tests/test_api.py` |
| **Add a "Degraded" Middle Status** | `backend/status.py`<br>`frontend/js/ui.js`<br>`frontend/css/styles.css` | `evaluate_service_status()` (add rule)<br>`breaches()`<br>`makeStatusBadge()` | `tests/test_status.py`<br>`tests/test_metrics.py` |
| **Change Polling Interval** | `frontend/js/poller.js`<br>`frontend/js/app.js`<br>`backend/config.py` | `createPoller({ intervalMs })`<br>`_startIncidentPoll()`<br>`Settings.sim_tick` | `tests/test_frontend.py` |
| **Add a New KPI Card** | `backend/metrics.py`<br>`backend/routes/metrics.py`<br>`frontend/js/views/dashboard.js` | `overview()` return dict<br>`get_overview()`<br>`renderKPIs()` | `tests/test_metrics.py`<br>`tests/test_api.py` |

---

## 3. What Breaks When You Change X

- **Default Error Threshold (5.0% -> 3.0%):** Breaks `tests/test_metrics.py::test_strict_threshold_boundary_equal_is_not_a_breach` (asserts strict boundary behavior at 5.0%).
- **Add New Service:** Breaks `tests/test_api.py::test_pagination_and_clamping` and `tests/test_db_and_seed.py::test_seed_twice_does_not_duplicate_rows` (both assert total services = 10).
- **Add Status Value to `ALLOWED_STATUSES`:** Breaks no test because no existing test asserts rejection of the new status string.
