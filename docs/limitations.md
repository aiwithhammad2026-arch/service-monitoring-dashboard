# System Limitations and Honest Assessment

This document lists the technical limitations, constraints, and intentional trade-offs in the Service Monitoring Dashboard codebase.

---

## 1. Testing Limitations

- **Fake Clock Fixture in Automated Tests:**
  Tests inject explicit `now: datetime` parameters into status evaluations, metric queries, and simulator ticks rather than sleeping on real system clocks. While this provides 100% deterministic and instantaneous test execution, real-world wall-clock skew and edge-of-second race conditions are simulated rather than tested against physical time.
- **No Headless Browser / UI End-to-End Tests:**
  Automated tests for the frontend perform static syntax validation (`node --check`), regex token safety guards (verifying zero forbidden tokens like `innerHTML`), static route serving checks, and schema validation against the backend OpenAPI contract. Full end-to-end user interactions in real browser rendering engines are not automated.
- **SQLite Concurrency & Single-Writer Constraint:**
  SQLite operates with WAL mode and a 5000 ms busy timeout. However, SQLite is fundamentally a single-writer database. High-concurrency simultaneous write load is lightly tested; heavy multi-threaded write scaling would require PostgreSQL.

---

## 2. Telemetry & Metrics Limitations

- **Histogram Percentile Approximations:**
  Latency percentiles (p50, p95) are calculated from 18 fixed-edge histogram bins with linear interpolation within the rank bin. While this prevents the mathematical fallacy of averaging percentiles across minutes and provides $O(1)$ constant storage per minute, the calculated percentiles are approximations bounded by bin widths.
- **5000 ms Finite Latency Ceiling:**
  The 18th histogram bin captures all latencies exceeding 5000 ms (`+inf`). Any latency in this bin is capped at 5000.0 ms in percentile calculations. Extreme latency spikes (e.g. 30 seconds) will be reported as 5000.0 ms.
- **In-App Notifications Only:**
  Incident notifications are communicated exclusively through the UI (header badge, status colors, incident tables, and timelines). No external webhook, email, PagerDuty, or SMS dispatch integrations are implemented.

---

## 3. Security & State Limitations

- **In-Memory Login Rate Limiting:**
  The failed login rate limiter (5 failed attempts per `(username, IP)` per 5 minutes) stores counters in process memory. If the backend process restarts, accumulated failed attempt counters are reset.
- **Signed Cookie Invalidation:**
  User sessions are signed using `itsdangerous` timestamps. While the application re-verifies user existence and role from SQLite on every request (allowing immediate permission revocation or account disabling), the cryptographic signature itself cannot be revoked globally without rotating `MD_SECRET_KEY` or waiting for the session to expire (default 24 hours).
- **Scenario File Runner (`MD_SIM_SCENARIO`):**
  The configuration setting `MD_SIM_SCENARIO` is defined in `backend/config.py`, but automated JSON-driven time-offset chaos scenario execution is not implemented. Chaos injection is performed via the live API / simulator UI controls.
