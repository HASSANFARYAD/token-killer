# RTK Backend

Python backend for RTK organization login, usage persistence, analytics, and the initial admin dashboard.

## Stack

- FastAPI
- SQLAlchemy 2
- Alembic
- PostgreSQL

## Local Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Set `DATABASE_URL`, `MICROSOFT_TENANT_ID`, and `APP_SECRET_KEY` in `.env`.

Run migrations:

```powershell
alembic upgrade head
```

Start the API:

```powershell
uvicorn app.main:app --reload
```

The initial implementation enforces a single Microsoft tenant through `MICROSOFT_TENANT_ID`. The VS Code extension never connects to PostgreSQL directly.
