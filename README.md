# service-monitoring-dashboard

Production-style operations monitoring dashboard built with FastAPI, SQLite and vanilla JS, providing service health, deterministic traffic simulation, incident management and audit logging.

## Tech Stack
- **Backend:** Python 3.12+, FastAPI, Uvicorn, Pydantic v2
- **Database:** SQLite (WAL mode) with plain SQL migrations (no ORM)
- **Auth:** bcrypt password hashing (cost 12), signed HttpOnly SameSite=Lax cookie via itsdangerous
- **Frontend:** HTML5, CSS Variables, ES Modules, Chart.js vendored locally
- **Tooling & Tests:** uv, ruff, pytest, httpx, pytest-cov

## Quickstart

```bash
# 1. Install dependencies and virtual environment
uv sync

# 2. Run database migrations
python -m backend.db migrate

# 3. Seed initial users, products, and services
python -m backend.seed

# 4. Start the development server
uvicorn backend.main:app --reload

# 5. Run automated test suite with coverage
pytest --cov=backend
```

Open your browser at `http://127.0.0.1:8000/` to access the operations dashboard.
API health check is available at `http://127.0.0.1:8000/health`.
