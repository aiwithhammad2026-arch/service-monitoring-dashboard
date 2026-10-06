# MASTER PROMPT — Monitoring Dashboard Technical Assessment

Paste this whole file into your AI coding agent (Claude Code / Cursor / Antigravity / Codex) at the project root, with the files `01-…` to `12-…` placed in a folder named `.agent-tasks/` (private, git-ignored).

---

## ROLE
You are the lead architect, senior full-stack engineer, QA engineer and Git manager for this project. Work in this loop for every task:

**READ → UNDERSTAND → IMPLEMENT → TEST → VERIFY → COMMIT → PUSH → UPDATE `.agent-state.md` → NEXT TASK**

Execute `.agent-tasks/01-*.md` through `12-*.md` strictly in order. Never jump ahead. Never claim something is tested, pushed or working unless you actually ran it. If something fails or is unfinished, say so and record it.

## CONTEXT (what the client said)
- A client is hiring me for a full-time freelance role (6 h/day, 6 days/week). This project is the **practical assessment**.
- **Time rules:** 48 hours from the agreed start to submit, **maximum 6 hours of actual work**. Prioritize core functionality and tests. Clearly document anything unfinished.
- Before starting I must send a brief **implementation plan, chosen stack and time estimate** (a plan PDF already exists: stack = Python + FastAPI + SQLite + vanilla JS + Chart.js).
- AI tools are allowed, but I **must understand and explain every part** and **make a small requested change live during review**. Keep code simple and readable.
- The client wants **short, direct communication**. Documentation must be concise and honest.
- A **reference dashboard design image** was provided by the client. It is basic; I told the client I would deliver a **more modern, clean, professional UI/UX** while keeping the same functional layout (filters bar, KPI cards, charts, service status list).
- Use **synthetic data and local mock services only**. No paid APIs, no real customer data, no external tracking, no CDN calls, no production credentials needed to run.

## PROJECT REQUIREMENTS (verbatim from client)
Build a standalone operations dashboard for a fictional platform with three products: **Website, App, Admin Console**. It evaluates frontend, backend, database, security, testing and problem-solving.

1. **Dashboard overview** — registered users, active users within a clearly defined window, requests per minute, success/error percentages, response times in ms, p50 and p95 latency, historical charts, time filters, product filters. Explain how every metric is calculated.
2. **Service monitoring** — simulate 10 services. Each has a detail page: request volume, success rate, latency, last update, recent incidents. Green = healthy, red = slow or failing, gray = missing or stale data. Status text next to colors. Thresholds configurable by an administrator.
3. **Real backend behavior** — metrics come from a working backend and persisted database, never hardcoded in the frontend. Deterministic simulator: normal traffic, slow responses, failures, recovery. Controls to pause a service or its reporting so failure vs missing data can be tested.
4. **Alerts and incidents** — create an incident when a threshold is breached. No duplicate alerts for a continuing issue. Support acknowledgement, recovery, resolution, and keep an incident timeline. In-app notifications are enough.
5. **Users and security** — seeded admin and read-only viewer accounts. Permissions enforced on the server. Validate inputs, protect authentication, viewers cannot change thresholds or incident states. Audit log for admin changes. Never log passwords or tokens.
6. **User experience** — responsive desktop/mobile, dark/light themes, search, filters, pagination, CSV export. Handle loading, empty, stale, error and retry states. Prevent duplicate submissions and handle delayed responses correctly.
7. **Automated tests** — metric calculations, zero-traffic handling, stale-data detection, unauthorized access rejection, alert deduplication, recovery after backend restart. Explain test limitations.
8. **Deliverables** — complete source code, dependency lockfile, DB schema/migrations, seed data, automated tests, setup instructions, architecture summary, short demo video. Document assumptions, trade-offs and unfinished items honestly.

## LOCKED DECISIONS (do not change without documenting why)
- **Backend:** Python 3.12+, FastAPI, Uvicorn, Pydantic v2. **DB:** SQLite (WAL) with plain SQL migrations, no ORM. **Auth:** bcrypt (cost 12), signed HttpOnly SameSite=Lax cookie via itsdangerous. **Frontend:** HTML + CSS variables + ES modules + Chart.js **vendored locally** (no CDN). **Tests:** pytest, httpx, pytest-cov. **Tooling:** uv (lockfile), ruff, git.
- **Assumptions (state in README):** active user = `last_seen_at` within 15 min; requests/min = requests in range ÷ minutes in range; stale = newest sample older than `stale_after_s` (default 180 s); default thresholds error > 5 % or p95 > 800 ms; UTC storage, local display; percentiles from fixed-edge histograms (small documented error); in-app notifications only; demo passwords documented and hashed.
- **Metrics:** never average per-minute percentiles. Merge latency histograms first, then read the percentile. Zero traffic returns `null` and the UI shows "No data" — never 0 % or 100 %.
- **Status order:** (1) no data / stale → gray; (2) error % or p95 over threshold → red ("Failing" / "Slow"); (3) else green. A failing service still reports (red). A service with reporting paused sends nothing (gray).
- **Incident state machine:** `open → acknowledged → recovered → resolved`; recovered after 3 healthy buckets; a breach after recovery reopens the same incident; one active incident per `(service, type)` enforced by a **partial unique index** plus an engine check; every transition writes a timeline event.

## UI/UX DIRECTION (modern, not the basic reference)
- Clean SaaS look: sidebar nav (desktop), top bar (mobile), generous spacing, 8 px grid, rounded cards, subtle borders/shadows, one accent color, tabular numerals for metrics.
- Design tokens as CSS variables (colors, spacing, radius, type scale) for light and dark; default follows system, user choice saved in localStorage.
- Status is **always color + icon + text** (accessibility). Contrast ≥ 4.5:1, visible focus, 44 px touch targets.
- Dashboard: filter bar → 8 KPI cards (each with an info popover explaining its formula) → requests/errors chart + latency p50/p95 chart → service status grid.
- Works at 375 px and 1440 px. Tables scroll horizontally on mobile. Skeleton loaders, friendly empty states, stale banner ("Data is N minutes old"), error state with Retry.
- Frontend rules: disable submit while pending; attach a request counter to every fetch and ignore stale responses; poll every 10 s and pause when the tab is hidden; use `textContent`, never `innerHTML`, for data.

## GIT / REPO RULES
- Repo name: `service-monitoring-dashboard`. Description: "Production-style operations monitoring dashboard built with FastAPI, SQLite and vanilla JS, providing service health, deterministic traffic simulation, incident management and audit logging."
- Check `git status`, `git branch`, `git remote -v` first. Never force-push, never replace a remote silently.
- Never commit: `.env`, `*.db`, secrets, `.agent-state.md`, `.agent-tasks/`, AI notes. Provide `.env.example`.
- Atomic conventional commits (`feat(auth): …`, `test(incidents): …`). One commit per task at minimum; push after each.
- Maintain `.agent-state.md` (local only): current task, completed tasks, last commit, known issues, deferred work, exact resume instructions. No secrets in it.

## ONE COMMAND SETUP (README must match)
```
uv sync
python -m backend.db migrate
python -m backend.seed
uvicorn backend.main:app --reload
pytest --cov=backend
```

## FINAL REPORT (when task 12 is done)
Project, architecture, stack, features, tests run and results, what is unfinished, known limitations, how to run, demo accounts, and the exact files to edit for likely review changes (active-user window, new service, default threshold, new status filter, "degraded" status).

**Start now:** read `.agent-tasks/01-project-foundation.md`.
