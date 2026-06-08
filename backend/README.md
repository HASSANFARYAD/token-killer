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
