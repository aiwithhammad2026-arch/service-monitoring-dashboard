# Operations Dashboard — 3 to 5 Minute Demo Script

This script walks through the complete feature set of the **Service Monitoring Dashboard**, demonstrating read-only operations, role enforcement, failure injection, incident resolution, and testing verification.

---

## Prerequisites
Ensure the server is running locally:
```bash
uv sync
uv run python -m backend.db migrate
uv run python -m backend.seed
uv run uvicorn backend.main:app --reload
```
Navigate to `http://127.0.0.1:8000/`.

---

## Step 1: Viewer Tour & Dashboard Overview (0:00 – 0:45)
1. **Login as Viewer:**
   - Username: `viewer`
   - Password: `Viewer#2026!`
   - Notice the green user chip in the sidebar displaying **viewer** role.
2. **Dashboard Tour (`#/dashboard`):**
   - Review the 8 KPI summary cards: *Registered Users*, *Active Users*, *Requests / min*, *Total Errors*, *Error Rate %*, *Success Rate %*, *p50 Latency*, *p95 Latency*.
   - Click the info icon (**ⓘ**) on the *p95 Latency* card to reveal the popover explaining the 18-bin merged histogram formula.
   - Click the info icon on the *Active Users* card to view the 15-minute sliding window definition.
3. **Filtering:**
   - Toggle the time range between `15m`, `1h`, `6h`, and `24h`.
   - Filter by Product: select `App` to observe real-time chart and KPI updates.
   - Point out continuous minute-by-minute Chart.js line charts (Requests & Errors, p50 & p95 Latency).

---

## Step 2: Service Detail & Viewer RBAC Restriction (0:45 – 1:30)
1. **Service Status Grid:**
   - Review the 10 monitored services. Note accessible status badges with **color + icon + text** (e.g. `● Healthy`).
   - Click on the **Payments API** (`#/services/payments`).
2. **Service Detail View:**
   - Review current threshold parameters: *Max Error Rate (5.0%)*, *Max p95 Latency (800ms)*, *Stale Limit (180s)*.
   - Note that threshold and simulator input controls are visible but disabled for the viewer role.
3. **Trigger RBAC Enforcement (403):**
   - Attempt to modify a threshold or trigger a simulator toggle.
   - The system intercepts the request or rejects it on the server with `403 Forbidden` (`FORBIDDEN`), displaying a destructive toast notification: *"Admins only — permission denied"*.

---

## Step 3: Admin Login & Chaos Injection (1:30 – 2:30)
1. **Switch to Admin:**
   - Click **Log Out** in the sidebar.
   - Log in with:
     - Username: `admin`
     - Password: `Admin#2026!`
   - Note the **admin** badge and the appearance of the **Simulator Controls** and **Audit Log** navigation links.
2. **Inject Failure Scenario:**
   - Navigate to **Simulator Controls** (`#/simulator`).
   - Find the **Payments API** row.
   - Change the **Sim Mode** dropdown from `Normal` to `Failing`.
3. **Observe Alert Deduplication:**
   - Return to `#/dashboard` or `#/services`.
   - Within 5 seconds (next tick), **Payments API** turns **Red ("Failing")**.
   - The red incident counter badge in the sidebar increments by **1**.
   - Navigate to `#/incidents` (`Incidents`): observe that exactly **one** open incident (`error_rate`) was created, despite multiple simulation ticks running.

---

## Step 4: Incident Lifecycle & Recovery (2:30 – 3:30)
1. **Acknowledge Incident:**
   - In `#/incidents`, click on the open Payments API incident.
   - Click the **Acknowledge** button.
   - Status updates to `acknowledged`.
2. **Initiate Recovery:**
   - Navigate back to `#/simulator` (or `#/services/payments`).
   - Change the mode of **Payments API** to `Recovering`.
   - The simulator linearly blends error rate down from 40% to 2% over 300 seconds.
3. **Automatic Incident Recovery:**
   - After 3 consecutive healthy minute buckets arrive, the incident status automatically transitions to **Recovered**.
4. **Admin Resolution & Timeline:**
   - Open the incident details drawer and click **Resolve**.
   - Review the complete chronological event timeline: `opened` → `acknowledged` → `recovered` → `resolved`.
   - Click **Add Note** to append an operator comment (e.g. *"Payment gateway upstream circuit breaker reset"*).

---

## Step 5: Observability vs. Failure (3:30 – 4:15)
1. **Demonstrate Telemetry Silence (Stale):**
   - In `#/simulator`, locate **Auth Service** (`auth`).
   - Click **Pause Reporting**.
   - Note the distinction: the service is still active, but has stopped emitting telemetry buckets.
   - After 180 seconds (or after advancing the clock), **Auth Service** turns **Gray ("Stale")** rather than Red.
2. **Demonstrate Traffic Pause (No Data):**
   - Click **Pause Traffic** on **Catalog Service** (`catalog`).
   - The service writes zero-request buckets (`requests=0, errors=0`).
   - Status displays **Gray ("No data")**, proving zero traffic produces nulls rather than false 0% or 100% metrics.

---

## Step 6: Audit Log, CSV Export, Theme & Responsiveness (4:15 – 4:45)
1. **Audit Trail (`#/audit`):**
   - Navigate to **Audit Log** to inspect all admin actions (logins, mode changes, threshold updates, incident acks).
   - Point out that credentials and cookies are automatically redacted to `[REDACTED]`.
2. **Safe CSV Export:**
   - Click **Export Metrics CSV** and **Export Incidents CSV**.
   - Note the downloaded file sanitizes spreadsheet formula injection characters (`=`, `+`, `-`, `@`).
3. **UX & Responsiveness:**
   - Toggle the **Theme Switcher** in the sidebar to toggle between Light and Dark mode.
   - Open browser developer tools, set viewport to mobile width (**375px**), and demonstrate the responsive topbar, off-canvas navigation drawer, and horizontally scrolling tables.

---

## Step 7: Automated Test Verification (4:45 – 5:00)
Run the automated test suite in the terminal:
```bash
uv run pytest --cov=backend -q
uv run ruff check .
```
Show 100% passing tests (130 tests) and over 90% test coverage with zero linter errors.
