# RTK Super Admin Dashboard

Browser-based dashboard for Super Admins to manage Azure AD settings and fetch users from Microsoft Entra ID through the RTK backend.

## What This Dashboard Does

- Logs in with the seeded Super Admin email/password and stores the returned app session token in browser local storage.
- Shows organization usage summary.
- Adds, updates, and deletes Azure AD settings.
- Saves the Azure AD client secret environment variable name, not the secret value.
- Tests the Azure AD connection.
- Fetches users from Azure AD through the backend.
- Lists imported users, roles, status, and recent audit logs.

The dashboard never connects to PostgreSQL and never sends Azure AD client secrets from the browser. The secret must live in the backend environment, for example:

```text
AZURE_AD_CLIENT_SECRET=your-secret-value
```

## Run Locally

Start the backend first:

```powershell
cd ..\backend
.\.venv\Scripts\Activate.ps1
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Make sure backend `.env` allows the dashboard origin:

```text
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000
```

Start the dashboard:

```powershell
cd ..\admin-dashboard
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Run With Docker

From the repository root, create and edit the backend Docker env file:

```powershell
copy backend\.env.docker.example backend\.env.docker
```

Then run the backend and dashboard:

```powershell
docker compose up --build
```

Open:

```text
http://localhost:5173
```

The dashboard container is served by Nginx and receives its default backend URL from:

```text
RTK_ADMIN_API_BASE_URL=http://localhost:8000
```

For a VM or public URL, set `RTK_ADMIN_API_BASE_URL` in `docker-compose.yml` to your public backend URL.

## Log In As Super Admin

The backend automatically seeds this bootstrap Super Admin on startup after migrations:

```text
Email: rtk@hazentech.com
Password: Admin@123456
```

For local setup, click `Login` in the dashboard. It calls:

```http
POST /api/auth/login
```

with the seeded email/password and receives an app session token. Change `SEED_SUPER_ADMIN_PASSWORD` in backend `.env` before production use.

You can also sign in with this Microsoft account from the tenant configured in `MICROSOFT_TENANT_ID`.

Then log in through the VS Code extension with `RTK: Login with Microsoft`, or call:

```http
POST /api/auth/microsoft/verify
```

Use the returned `access_token` in the dashboard connection form. Paste only the token value, not `Bearer`.

## Fetch Users From Azure AD

1. Enter the API base URL, usually `http://127.0.0.1:8000`.
2. Enter `rtk@hazentech.com` and `Admin@123456`.
3. Click `Login`.
4. In Azure AD Settings, enter:
   - Tenant ID
   - Client ID
   - Client Secret Env Var, for example `AZURE_AD_CLIENT_SECRET`
   - Role mapping rules JSON
5. Click `Save Settings`.
6. Click `Test Connection`.
7. Click `Fetch Users`.

The backend will fetch users from Microsoft Graph, create/update users, create departments, assign department managers where manager data is available, assign roles from job titles, and preserve manual role overrides.

## Build

```powershell
npm run build
```
