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

## First-Time Super Admin Setup

Before any Microsoft user can log in through the extension, create the initial Super Admin. This endpoint can only be used while no active Super Admin exists.

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

Use a bearer token returned by the extension login flow or `/api/auth/microsoft/verify`.

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
