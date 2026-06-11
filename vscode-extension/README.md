# RTK Token Savings for VS Code

Shows RTK token savings in the VS Code status bar, provides a local session dashboard, and can securely sync usage to the RTK backend after Microsoft login.

## How It Works

The extension runs this command internally every few seconds:

```sh
rtk-node status --json
```

If `rtk.command` is empty, the extension uses the bundled RTK CLI. You can point `rtk.command` at another executable when you want to use a separately installed CLI.

It also provides `RTK: Start Agent Terminal`, which opens a VS Code terminal through the bundled `rtk-node agent <command>` wrapper. Commands run through `rtk-node` in that terminal are counted against the active VS Code session.

On install/startup, the extension installs shell hooks only when `rtk.autoWrapTerminals` is enabled. It is disabled by default for new installs, so normal terminals keep native command behavior until you opt in. When enabled, supported commands such as `git`, `npm`, `rg`, `find`, and `cat` route through RTK-Node automatically where the user's shell supports hooks. Windows PowerShell, Linux bash/zsh/fish, and macOS zsh/bash/fish are supported. Codex/VS Code zsh shells also receive a scoped non-interactive loader. The generated hooks validate RTK first and fall back to the native command if RTK is unavailable. Set `RTK_NODE_DISABLE=1` for one command when exact raw output is required.

The extension does not connect to PostgreSQL. Organization auth, RBAC, Azure AD settings, and usage persistence all go through the backend API.

## Run Against Your Backend

Start the backend first:

```powershell
cd ..\backend
.\.venv\Scripts\Activate.ps1
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Bootstrap the first Super Admin from the backend README before trying to log in from VS Code.

Configure the extension settings. For local development, this workspace can use:

```json
{
  "rtk.apiBaseUrl": "https://syntellio.hazentech.dev:9006",
  "rtk.authRequired": true,
  "rtk.syncEnabled": true,
  "rtk.autoWrapTerminals": false
}
```

Then open this extension folder in VS Code, press `F5`, and run these commands in the Extension Development Host:

- `RTK: Login with Microsoft`
- `RTK: Start Agent Terminal`
- `RTK: Sync Usage Now`
- `RTK: Open Dashboard`
- `RTK: Open Admin Dashboard`

## What to Test

### 1. Local Status Bar

After the Extension Development Host opens, the status bar should show an RTK item such as:

```text
RTK 0 saved
```

This comes from local polling of:

```sh
rtk-node status --json
```

This part does not require backend sync.

### 2. Microsoft Login

Run:

```text
RTK: Login with Microsoft
```

Expected results:

- If your Microsoft account was bootstrapped or imported as an active user, login succeeds.
- If the account is unknown, the extension shows:

```text
Your account is not registered in the RTK Token Savings system. Please contact your manager or administrator to have your account added before using this extension.
```

- If the account is disabled, the extension shows:

```text
Your account is currently disabled. Please contact your administrator.
```

The extension stores only the backend app session token in VS Code SecretStorage.

### 3. Generate Usage

Run:

```text
RTK: Start Agent Terminal
```

Enter an agent command such as:

```text
codex
```

In that terminal, run commands that go through RTK wrapping. The extension will keep polling local savings.

You can also run a simple manual command in a normal terminal:

```powershell
rtk-node git status
rtk-node status --json
```

### 4. Sync Usage

Run:

```text
RTK: Sync Usage Now
```

Sync requires:

- `rtk.apiBaseUrl` configured.
- `rtk.syncEnabled` set to `true`.
- Successful Microsoft login.
- Backend user is registered and active.

Unauthenticated, unregistered, or disabled users cannot sync usage.

### 5. Local Dashboard

Run:

```text
RTK: Open Dashboard
```

This opens the compact VS Code webview dashboard for the current local RTK session. It shows local status data from `rtk-node status --json`.

### 6. Admin Dashboard

Run:

```text
RTK: Open Admin Dashboard
```

This opens the current VS Code admin webview. It calls backend dashboard APIs:

- `GET /api/me`
- `GET /api/dashboard/summary`
- `GET /api/dashboard/users`
- `GET /api/admin/users`
- `GET /api/admin/azure-ad/settings`
- `GET /api/admin/azure-ad/sync-status`

Access is enforced by the backend:

- Super Admin and all-data roles can see organization data.
- Department managers see only scoped department data.
- Employees are limited to their own data.

Super Admins can use this webview to:

- Add or update Azure AD tenant/client settings.
- Save the backend environment variable name that contains the Azure AD client secret.
- Edit job-title-to-role mapping rules as JSON.
- Delete Azure AD settings.
- Test the Azure AD connection.
- Fetch users from Azure AD.
- View imported users and their roles/status.

The Azure AD client secret value itself is not entered in the extension. Put it in the backend environment, then enter only the environment variable name, for example `AZURE_AD_CLIENT_SECRET`.

Department and role management APIs exist in the backend, but the current VS Code UI focuses on Azure AD settings and user import.

## Backend Admin APIs During Testing

After login, use an app session token as a bearer token:

```powershell
$headers = @{ Authorization = "Bearer YOUR_APP_SESSION_TOKEN" }
```

Useful endpoints:

```text
GET  /api/me
GET  /api/admin/users
POST /api/admin/users
GET  /api/admin/departments
POST /api/admin/departments
GET  /api/admin/roles
GET  /api/dashboard/summary
GET  /api/dashboard/users
GET  /api/admin/audit-logs
PUT  /api/admin/azure-ad/settings
POST /api/admin/azure-ad/test
POST /api/admin/azure-ad/sync-users
GET  /api/admin/azure-ad/sync-status
```

The admin dashboard webview is a read-only summary today. Full Super Admin management screens are still a future extension UI task.

## Production Test Checklist

Before sharing the extension:

- Use a deployed HTTPS backend URL in `rtk.apiBaseUrl`.
- Verify `/health` returns `{"ok":true}`.
- Run backend migrations with `alembic upgrade head`.
- Confirm Microsoft login accepts the same tenant configured in `MICROSOFT_TENANT_ID`.
- Bootstrap the first Super Admin.
- Run at least one wrapped terminal command and confirm `/api/dashboard/summary` shows usage after sync.
- Package the extension and install the generated `.vsix` on a clean VS Code profile.

## Development Install

From this folder:

```sh
npm install
npm run package
npm run install:local
```

The extension includes the RTK CLI under `bin` and `src`. Use `rtk.command` only when you want to override it with an external RTK command.

## Commands

- `RTK: Refresh Token Savings`
- `RTK: Open Dashboard`
- `RTK: Open Admin Dashboard`
- `RTK: Login with Microsoft`
- `RTK: Logout`
- `RTK: Sync Usage Now`
- `RTK: Import Existing Usage`
- `RTK: Start New Session`
- `RTK: Use Current Workspace Session`
- `RTK: Enable Automatic Terminal Wrapping`
- `RTK: Disable Automatic Terminal Wrapping`
- `RTK: Run Diagnostics`
- `RTK: Start Agent Terminal`

## Settings

- `rtk.command`: optional external RTK command. Leave empty to use the bundled CLI.
- `rtk.apiBaseUrl`: backend API base URL, for example `https://api.example.com`.
- `rtk.authRequired`: prompts for Microsoft login before organization sync and protected dashboard access.
- `rtk.refreshIntervalMs`: status refresh interval, default `3000`.
- `rtk.defaultAgentCommand`: default terminal command, default `codex`.
- `rtk.showTotalWhenNoSession`: show lifetime totals until the session has runs.
- `rtk.syncEnabled`: sends usage snapshots and events to the configured backend after login.
- `rtk.syncIntervalMs`: minimum interval for backend usage sync attempts.
- `rtk.autoWrapTerminals`: automatically installs shell hooks so supported commands run through RTK-Node in VS Code and Codex shells. Default `false`; enable it only when you want wrapped terminals, and remove hooks with `RTK: Disable Automatic Terminal Wrapping`.
- `rtk.followWorkspacePath`: keeps the displayed session aligned with the current workspace path.

## Terminal Safety

Default behavior:

- Status bar polling runs `rtk-node status --json` in the extension host.
- `RTK: Start Agent Terminal` creates a dedicated RTK terminal and sets `RTK_SESSION_ID` and `RTK_SESSION_LABEL` in that terminal.
- Automatic terminal wrapping is installed on startup when `rtk.autoWrapTerminals` is enabled.
- Windows installs hook blocks into both PowerShell Core and Windows PowerShell profile paths.
- Linux and macOS interactive bash, zsh, and fish shells receive profile functions.
- Codex/VS Code zsh shells also receive a `.zshenv` loader so non-interactive zsh command shells are routed.
- Bash non-interactive shells require the parent process to set `BASH_ENV`; the extension does not force that globally because it would affect unrelated system scripts.
- The generated hooks validate RTK before wrapping and fall back to the native command if RTK is unavailable.
- Set `RTK_NODE_DISABLE=1 <command>` to bypass wrapping for a single command.
- Disable wrapping with `RTK: Disable Automatic Terminal Wrapping` or by running `rtk-node uninstall-hooks` in the affected shell.

## Diagnostics

Run `RTK: Run Diagnostics` to inspect extension version, VS Code version, OS, configured RTK command, bundled CLI health, global `rtk-node` health, auto-wrap state, Git path, Node path, Python path, and whether `git add .` would be wrapped in new terminals.
