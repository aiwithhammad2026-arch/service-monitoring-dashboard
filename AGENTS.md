# AGENTS.md — Development & Collaboration Guidelines

## Project Overview
**Service Monitoring Dashboard** is an enterprise-grade operations monitoring and telemetry platform built with FastAPI, SQLite (WAL mode), and Vanilla JavaScript (native ES Modules).

---

## Authors & Project Ownership

### Core Engineers & Authors:
1. **Hammad**
   - **Role:** AI Engineer & Developer
   - **Email:** `aiwithhammad2026@gmail.com`
   - **Focus:** System Architecture, Telemetry Model, and Dashboard Concepts.

2. **Maaz Ali**
   - **Role:** Full-Stack Engineer & Deployment Lead
   - **Email:** `maazalisshahid@gmail.com`
   - **Focus:** Full-Stack Architecture, Bug Resolution, Test Automation Suite (133/133 tests), UI/UX Polish, and Vercel Serverless Integration.


---

## Collaboration & Engagement Agreement
- **Revenue & Compensation Model:** 
  - This project is developed as a client / commercial deliverable and portfolio project.
  - Ongoing compensation, monthly salary ($500/month or equivalent client contract value), and revenue sharing are structured on a **50/50 equal basis** between **Hammad** and **Maaz Ali**.
- **Deployment & Production Readiness:**
  - Production deployments (including Vercel live instances) must reflect co-attribution across `README.md`, UI footer, and system about dialogs.
  - If any modifications or releases occur, all test suites must pass before deployment.

---

## Engineering Rules for Antigravity & AI Coding Agents
1. **Git Commit Strategy:**
   - **Atomic Single-File Commits:** Every file modified must be committed individually using clear Conventional Commits (`feat:`, `fix:`, `style:`, `docs:`, `test:`). Never batch multiple files into a single commit.
2. **Quality & Validation Standards:**
   - Always run `.venv/bin/ruff check .` before completing a task (0 linter errors allowed).
   - Always run `.venv/bin/python -m scripts.check_docs` to verify documentation path integrity.
   - Always verify that all 133 automated tests pass with 90%+ coverage (`.venv/bin/pytest --cov=backend`).
3. **Vercel Serverless Compatibility:**
   - Database operations in serverless must default to `/tmp/monitoring.db`.
   - Never run continuous `asyncio` background loops in serverless handlers (`use_lifespan=False`).
   - Static assets (`frontend/**`) must be served directly via `@vercel/static` CDN routes.
