# RTK Token Savings for VS Code

Shows RTK token savings in the VS Code status bar and a compact dashboard.

## How It Works

The extension runs this command internally every few seconds:

```sh
rtk-node status --json
```

If `rtk.command` is empty, the extension uses the bundled RTK CLI. You can point `rtk.command` at another executable when you want to use a separately installed CLI.

It also provides `RTK: Start Agent Terminal`, which opens a VS Code terminal through the bundled `rtk-node agent <command>` wrapper. Commands run through `rtk-node` in that terminal are counted against the active VS Code session.

## Run Against Your Backend

Start the backend first:

```powershell
cd ..\backend
.\.venv\Scripts\Activate.ps1
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

This workspace sets:

```json
{
  "rtk.apiBaseUrl": "http://localhost:8000",
  "rtk.syncEnabled": true
}
```

Then open this extension folder in VS Code, press `F5`, and run these commands in the Extension Development Host:

- `RTK: Login with Microsoft`
- `RTK: Start Agent Terminal`
- `RTK: Sync Usage Now`
- `RTK: Open Dashboard`

## Production Test Checklist

Before sharing the extension:

- Use a deployed HTTPS backend URL in `rtk.apiBaseUrl`.
- Verify `/health` returns `{"ok":true}`.
- Run backend migrations with `alembic upgrade head`.
- Confirm Microsoft login accepts the same tenant configured in `MICROSOFT_TENANT_ID`.
- Run at least one wrapped terminal command and confirm `/rtk/usage/me/summary` shows usage.
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
- `RTK: Start New Session`
- `RTK: Start Agent Terminal`

## Settings

- `rtk.command`: command used to run RTK, default `rtk-node`.
- `rtk.apiBaseUrl`: backend API base URL, for example `https://api.example.com`.
- `rtk.refreshIntervalMs`: status refresh interval, default `3000`.
- `rtk.defaultAgentCommand`: default terminal command, default `codex`.
- `rtk.showTotalWhenNoSession`: show lifetime totals until the session has runs.
- `rtk.syncEnabled`: sends usage snapshots and events to the configured backend after login.
