# SavytoX VS Code Extension Working Report

## Purpose

The SavytoX VS Code extension shows RTK token savings inside VS Code, lets a user start an agent terminal with session tracking, and can sync local RTK usage to the backend after Microsoft login.

The extension is built around two parts:

- `rtk-node`: the CLI that runs commands, compresses noisy output, and records local analytics.
- `vscode-extension`: the VS Code extension that reads those analytics, displays them, and optionally syncs them to the backend API.

## High-Level Flow

1. The user installs or runs the VS Code extension.
2. When VS Code starts, the extension activates automatically.
3. The extension creates an RTK status-bar item.
4. Every few seconds, it runs:

   ```sh
   rtk-node status --json
   ```

5. The returned JSON is used to update the status bar and dashboard.
6. If backend sync is enabled and the user is logged in, the extension sends usage snapshots and command events to the backend API.
7. The user can open dashboards, log in, sync manually, start new sessions, or launch an RTK-tracked agent terminal through VS Code commands.

## What Runs Automatically

These actions happen without the user manually running a command after the extension is active:

| Automatic action | Where it happens | What it does |
| --- | --- | --- |
| Extension activation | `activationEvents` in `vscode-extension/package.json` | Starts after VS Code startup or when any RTK command is invoked. |
| Workspace session selection | `activate()` in `vscode-extension/extension.js` | Creates a session ID based on the current user and workspace path. |
| Status-bar creation | `activate()` | Shows `RTK starting`, then updates it with current savings. |
| Authentication check | `ensureAuthenticated(context, false)` | Checks whether a saved backend token exists. It does not force login unless settings require it. |
| Status polling timer | `startTimer()` | Runs repeatedly based on `rtk.refreshIntervalMs`, default `3000` ms. |
| Local status command | `runRtkStatus()` | Runs `rtk-node status --json` using the bundled CLI, configured CLI, or installed CLI. |
| Dashboard refresh | `refreshStatus()` | Updates the status bar and open local dashboard webview. |
| Background usage sync | `maybeSyncSnapshot()` | Sends snapshots to the backend when sync is enabled, the user is logged in, and `rtk.syncIntervalMs` has elapsed. |
| Auto-wrap prompt | `maybePromptAutoWrap()` | Prompts once to enable automatic terminal command wrapping. |
| Workspace session reset | `onDidChangeWorkspaceFolders` | Switches the active RTK session when workspace folders change. |
| Configuration reaction | `onDidChangeConfiguration` | Restarts polling or refreshes status when RTK settings change. |

## Commands the User Runs Manually in VS Code

The extension contributes these commands to the VS Code Command Palette.

| VS Code command | User action | What happens internally |
| --- | --- | --- |
| `RTK: Refresh Token Savings` | User wants an immediate refresh. | Runs local status polling immediately. |
| `RTK: Open Dashboard` | User opens the local dashboard. | Opens a VS Code webview showing session and total savings from `rtk-node status --json`. |
| `RTK: Open Admin Dashboard` | Admin user opens organization dashboard. | Requires Microsoft login, then calls backend admin/dashboard APIs. |
| `RTK: Login with Microsoft` | User signs in. | Uses VS Code Microsoft authentication, sends the Microsoft access token to the backend, and stores only the backend app token in VS Code SecretStorage. |
| `RTK: Logout` | User signs out. | Calls backend logout if possible, then clears local SecretStorage token and install ID. |
| `RTK: Sync Usage Now` | User forces sync. | Authenticates, refreshes local status if needed, then sends the latest snapshot to the backend. |
| `RTK: Import Existing Usage` | User imports existing local history. | Uploads recent local RTK runs once for the current session. |
| `RTK: Start New Session` | User starts a new VS Code RTK session. | Creates a new random session ID and updates the status display. |
| `RTK: Use Current Workspace Session` | User returns to workspace-based tracking. | Resets session ID to `username:workspacePath`. |
| `RTK: Enable Automatic Terminal Wrapping` | User enables shell hooks. | Runs bundled `rtk-node init -g --hook-only --command <bundled command>`. Restarted terminals then wrap supported commands automatically. |
| `RTK: Start Agent Terminal` | User starts Codex or another agent. | Opens a VS Code terminal and sends `rtk-node agent <command>`. |

## Commands the User Runs Manually in a Terminal

These are the main CLI commands a user or developer may run directly.

### Install RTK Node

From npm:

```sh
npm install -g rtk-node
rtk-node init -g
```

Windows PowerShell installer:

```powershell
iwr https://raw.githubusercontent.com/your-org/rtk-node/main/install.ps1 -UseBasicParsing | iex
```

Linux/macOS installer:

```sh
curl -fsSL https://raw.githubusercontent.com/your-org/rtk-node/main/install.sh | sh
```

Local development install:

```sh
npm install
npm link
rtk-node init -g --codex
```

### Run Commands Through RTK

Users can prefix noisy commands with `rtk-node`:

```sh
rtk-node git status
rtk-node git diff
rtk-node rg "TODO" src
rtk-node pytest -q
rtk-node npm test
```

RTK executes the real command, filters the output, records analytics, and exits with the same exit code as the original command.

### View Local Savings

```sh
rtk-node gain
rtk-node session
rtk-node status
rtk-node status --json
```

The VS Code extension mainly depends on:

```sh
rtk-node status --json
```

### Start an Agent Session

```sh
rtk-node agent codex
rtk-node agent claude
rtk-node agent cursor-agent
```

This keeps the agent interactive, sets `RTK_SESSION_ID`, tracks commands run through RTK, and prints a session summary when the agent exits.

## Commands Wrapped Automatically After Auto-Wrap Is Enabled

When the user enables shell hooks, supported commands are rewritten through `rtk-node`.

On Bash, Zsh, and Fish:

```text
git
rg
grep
pytest
npm
ls
find
cat
```

On PowerShell:

```text
git
rg
grep
pytest
npm
```

The hook uses `RTK_NODE_ACTIVE` to avoid recursive wrapping. For example, when a user runs `git status`, the shell function runs `rtk-node git status`; inside RTK, the real `git` runs normally.

On native Windows Codex mode, `rtk-node init -g --codex` writes `AGENTS.md` and `RTK.md` instructions instead of doing Bash-level automatic rewriting. WSL should be used for Bash-style auto-rewrite.

## Backend Sync Flow

Backend sync is optional and requires:

- `rtk.apiBaseUrl` configured.
- `rtk.syncEnabled` set to `true`.
- Successful Microsoft login.
- The backend user is registered and active.

Sync flow:

1. The extension reads local usage from `rtk-node status --json`.
2. The user logs in with `RTK: Login with Microsoft`.
3. The extension sends the Microsoft token to:

   ```text
   POST /api/auth/microsoft/verify
   ```

4. The backend returns an app access token.
5. The extension stores that app token in VS Code SecretStorage.
6. During automatic or manual sync, the extension ensures an extension install record exists:

   ```text
   POST /api/extension/installs
   ```

7. It ensures a backend RTK session exists:

   ```text
   POST /api/extension/rtk/sessions
   ```

8. It sends summary snapshots:

   ```text
   POST /api/extension/usage/snapshot
   ```

9. It sends recent command events:

   ```text
   POST /api/extension/usage/event
   ```

The extension does not store database credentials, Azure AD client secrets, or admin secrets.

## Local Data Stored by RTK

RTK stores local config here:

```text
~/.config/rtk-node/config.json
```

RTK stores local analytics here:

```text
~/.local/share/rtk-node/analytics.json
```

The extension stores the backend app token in VS Code SecretStorage. It also stores small state values such as install ID, install key, and whether import/auto-wrap prompts have already happened.

## Important Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `rtk.command` | empty | Optional external RTK command. Empty means use bundled CLI first. |
| `rtk.apiBaseUrl` | `https://syntellio.hazentech.dev:9006/` | Backend API base URL. |
| `rtk.authRequired` | `true` | Controls whether organization features require Microsoft login. |
| `rtk.refreshIntervalMs` | `3000` | How often the extension refreshes local status. |
| `rtk.defaultAgentCommand` | `codex` | Default value for `RTK: Start Agent Terminal`. |
| `rtk.showTotalWhenNoSession` | `true` | Shows lifetime totals when the current session has no runs. |
| `rtk.syncEnabled` | `true` | Enables backend usage sync after login. |
| `rtk.syncIntervalMs` | `30000` | Minimum interval between automatic sync attempts. |
| `rtk.autoWrapTerminals` | `true` | Prompts once to enable shell hooks. |
| `rtk.followWorkspacePath` | `true` | Keeps the active session aligned with the current workspace path. |

## Developer Run and Test Commands

From the extension folder:

```sh
cd vscode-extension
npm install
npm run package
npm run install:local
```

To test in Extension Development Host:

1. Open `vscode-extension` in VS Code.
2. Press `F5`.
3. In the Extension Development Host, run:

   ```text
   RTK: Login with Microsoft
   RTK: Start Agent Terminal
   RTK: Sync Usage Now
   RTK: Open Dashboard
   RTK: Open Admin Dashboard
   ```

For local backend testing:

```powershell
cd ..\backend
.\.venv\Scripts\Activate.ps1
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Then configure VS Code settings:

```json
{
  "rtk.apiBaseUrl": "http://localhost:8000",
  "rtk.authRequired": true,
  "rtk.syncEnabled": true
}
```

## What the Status Bar Shows

The status bar shows a compact message like:

```text
RTK 1.2k saved
```

The tooltip includes:

- Whether the value is for the current session or total history.
- Saved tokens and saved percentage.
- Original token estimate.
- Compressed token estimate.
- Run count.
- Current session label.

If the RTK CLI cannot be found or `rtk-node status --json` fails, it shows:

```text
RTK unavailable
```

## Security Notes

- Microsoft login is verified by the backend.
- Unknown users cannot sync usage.
- Disabled users cannot sync usage.
- PostgreSQL credentials remain only on the backend.
- Azure AD client secret values are not entered in the extension; the extension stores only the backend environment variable name.
- Usage sync sends snapshots and command event summaries, not database credentials or secrets.

## Summary

The user normally does not need to run `rtk-node status --json`; the extension runs it automatically. The user mainly interacts through VS Code commands such as login, start agent terminal, open dashboard, sync usage, and enable auto-wrap.

For command tracking, the user either:

- Starts an agent with `RTK: Start Agent Terminal`, or
- Enables automatic terminal wrapping, or
- Manually prefixes commands with `rtk-node`.

The automatic parts are status polling, dashboard refresh, workspace session tracking, optional background sync, and the one-time auto-wrap prompt.
