# RTK Backend

Python backend for RTK organization login, Super Admin access, Azure AD / Microsoft Entra ID sync, usage persistence, analytics, RBAC, departments, and audit logs.

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

Set these values in `.env`:

- `DATABASE_URL`: PostgreSQL connection string.
- `MICROSOFT_TENANT_ID`: the Microsoft tenant allowed to log in.
- `MICROSOFT_CLIENT_ID`: app/client ID used for Microsoft identity validation.
- `APP_SECRET_KEY`: backend JWT signing secret.
- `COMMAND_HASH_SECRET`: secret used to hash command names before storage.
- `SEED_SUPER_ADMIN_EMAIL`: bootstrap Super Admin email. Defaults to `rtk@hazentech.com`.
- `SEED_SUPER_ADMIN_NAME`: bootstrap Super Admin display name.
- `SEED_SUPER_ADMIN_PASSWORD`: bootstrap Super Admin password. Defaults to `Admin@123456`.
- `SEED_ORGANIZATION_NAME`: bootstrap organization name.

Run migrations:

```powershell
alembic upgrade head
```

Start the API:

```powershell
uvicorn app.main:app --reload
```

The API runs at `http://127.0.0.1:8000` by default. Verify it:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

The VS Code extension never connects to PostgreSQL directly.

## Docker Local Or VM Deployment

From the repository root, create the Docker env file:

```powershell
copy backend\.env.docker.example backend\.env.docker
```

Edit `backend\.env.docker` and set real values for:

```text
MICROSOFT_TENANT_ID
MICROSOFT_CLIENT_ID
APP_SECRET_KEY
COMMAND_HASH_SECRET
SEED_SUPER_ADMIN_PASSWORD
CORS_ORIGINS
```

Docker Compose starts a PostgreSQL container and the backend overrides `DATABASE_URL` to use it:

```text
DATABASE_URL=postgresql+psycopg://rtk:rtk@db:5432/rtk
```

The database is also exposed to the host at `localhost:5433` for local inspection tools.

Run the backend container:

```powershell
docker compose up --build
```

The backend will be available at:

```text
http://localhost:8000
```

Verify it:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

The backend container runs `startup.sh`, waits for PostgreSQL, and applies Alembic migrations automatically before FastAPI starts.

On a Linux VM, install Docker and Docker Compose, copy this repo to the VM, create `backend/.env.docker`, then run:

```bash
docker compose up -d --build
```

To make it public, point a domain to the VM public IP and put a reverse proxy in front of port `8000` with HTTPS. The simplest production shape is:

```text
Internet -> domain -> Nginx/Caddy HTTPS -> http://127.0.0.1:8000
```

For quick testing without a domain, use a tunnel such as Cloudflare Tunnel or ngrok and point the extension setting `rtk.apiBaseUrl` to the public tunnel URL.

## Azure App Service Deployment

Use a Linux Azure Web App with Python 3.11+ and an Azure Database for PostgreSQL instance.

Set these App Service application settings:

```text
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
MICROSOFT_TENANT_ID=your-tenant-id
MICROSOFT_CLIENT_ID=your-azure-app-client-id
APP_SECRET_KEY=long-random-secret
COMMAND_HASH_SECRET=long-random-command-hash-secret
SEED_SUPER_ADMIN_EMAIL=rtk@hazentech.com
SEED_SUPER_ADMIN_NAME=RTK Bootstrap Super Admin
SEED_SUPER_ADMIN_PASSWORD=change-this-password
SEED_ORGANIZATION_NAME=HazenTech
CORS_ORIGINS=https://YOUR-WEB-APP.azurewebsites.net,http://localhost:5173,http://127.0.0.1:5173
```

Set the App Service startup command to:

```bash
bash startup.sh
```

Deploy from the repository root with Azure CLI:

```powershell
az login
az webapp up `
  --name YOUR-WEB-APP `
  --resource-group YOUR-RESOURCE-GROUP `
  --runtime "PYTHON:3.11" `
  --sku B1 `
  --os-type Linux `
  --location eastus `
  --source-path backend

az webapp config set `
  --name YOUR-WEB-APP `
  --resource-group YOUR-RESOURCE-GROUP `
  --startup-file "bash startup.sh"
```

After deployment, verify:

```powershell
Invoke-RestMethod https://YOUR-WEB-APP.azurewebsites.net/health
```

For extension rollout, configure users with:

```json
{
  "rtk.apiBaseUrl": "https://YOUR-WEB-APP.azurewebsites.net",
  "rtk.authRequired": true,
  "rtk.syncEnabled": true
}
```

With these settings, users do not need to run `RTK: Sync Usage Now`; the extension syncs usage automatically after login on its normal refresh interval.

## Bootstrap Super Admin

On backend startup, RTK automatically ensures a bootstrap Super Admin user exists:

```text
Email: rtk@hazentech.com
Password: Admin@123456
```

The seeded user is attached to the organization whose tenant is `MICROSOFT_TENANT_ID`. If no active Super Admin exists, this user is assigned `SUPER_ADMIN`. If another active Super Admin already exists, the user is still kept as an active organization member but is not promoted in a way that violates the one-active-Super-Admin rule.

To log in as this seeded Super Admin, use the browser dashboard or call `POST /api/auth/login` with the seeded email and password. The backend hashes the password in PostgreSQL; the plaintext password is only read from configuration at startup.

You can override the seeded account in `.env`:

```text
SEED_SUPER_ADMIN_EMAIL=rtk@hazentech.com
SEED_SUPER_ADMIN_NAME=RTK Bootstrap Super Admin
SEED_SUPER_ADMIN_PASSWORD=change-this-password
SEED_ORGANIZATION_NAME=HazenTech
```

For production, change `SEED_SUPER_ADMIN_PASSWORD` before first startup and rotate it if the default was ever used.

## Manual First-Time Super Admin Setup

If you do not want to rely on the startup seed, you can still create the initial Super Admin manually. This endpoint can only be used while no active Super Admin exists.

```powershell
$body = @{
  tenant_id = "YOUR_MICROSOFT_TENANT_ID"
  email = "you@company.com"
  display_name = "Your Name"
  organization_name = "Your Company"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/api/setup/super-admin `
  -ContentType "application/json" `
  -Body $body
```

After this, sign in from the VS Code extension using the same Microsoft account. The backend verifies the Microsoft token and returns an app session token only if the user already exists and is active.

## Auth and Access Rules

- Unknown Microsoft users are rejected with `USER_NOT_REGISTERED`.
- Disabled users are rejected with `USER_DISABLED`.
- Users from an unconfigured tenant are rejected with `ORG_NOT_CONFIGURED`.
- Super Admin can access all backend APIs.
- Executives and analysts can view organization dashboard data.
- Department managers can view only users and usage in managed departments.
- Employees can view only their own usage.

## Useful Admin APIs

Use a bearer token returned by `/api/auth/login`, the extension login flow, or `/api/auth/microsoft/verify`.

Email/password login:

```powershell
$body = @{
  email = "rtk@hazentech.com"
  password = "Admin@123456"
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/api/auth/login `
  -ContentType "application/json" `
  -Body $body

$headers = @{ Authorization = "Bearer $($login.access_token)" }
```

```powershell
$headers = @{ Authorization = "Bearer YOUR_APP_SESSION_TOKEN" }
```

Current user:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/me -Headers $headers
```

Create a user:

```powershell
$body = @{
  email = "employee@company.com"
  display_name = "Employee Name"
  job_title = "Engineer"
  role = "EMPLOYEE"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/api/admin/users `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

List users:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/admin/users -Headers $headers
```

Create a department:

```powershell
$body = @{ name = "Engineering" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/admin/departments -Headers $headers -ContentType "application/json" -Body $body
```

Dashboard summary:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/dashboard/summary -Headers $headers
```

Audit logs:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/admin/audit-logs -Headers $headers
```

## Azure AD / Microsoft Graph Sync

Azure AD client secrets must stay on the backend. Prefer storing the secret in an environment variable and saving only the variable name in `client_secret_ref`.

Example `.env`:

```text
AZURE_AD_CLIENT_SECRET=your-secret-value
```

Configure Azure AD settings:

```powershell
$body = @{
  tenant_id = "YOUR_MICROSOFT_TENANT_ID"
  client_id = "YOUR_AZURE_APP_CLIENT_ID"
  client_secret_ref = "AZURE_AD_CLIENT_SECRET"
  enabled = $true
  role_mapping_rules = @{
    CEO = "EXECUTIVE"
    Chief = "EXECUTIVE"
    Director = "EXECUTIVE"
    VP = "EXECUTIVE"
    Manager = "DEPARTMENT_MANAGER"
    Lead = "DEPARTMENT_MANAGER"
    Engineer = "EMPLOYEE"
    Developer = "EMPLOYEE"
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Put `
  -Uri http://127.0.0.1:8000/api/admin/azure-ad/settings `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

Test the connection:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/admin/azure-ad/test -Headers $headers
```

Sync users:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/admin/azure-ad/sync-users -Headers $headers
```

The Azure app registration needs Microsoft Graph application permissions appropriate for user sync, typically `User.Read.All` and enough directory permission to read manager relationships. Grant admin consent in Microsoft Entra ID.

## Tests

Backend checks:

```powershell
cd backend
python -m ruff check app tests
pytest -q tests
```
