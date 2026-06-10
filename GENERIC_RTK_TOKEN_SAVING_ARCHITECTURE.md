# Generic RTK Token-Saving Architecture

## Recommendation

RTK should use a hybrid architecture: VS Code extension + local desktop agent + adapter framework + optional CLI wrappers + backend sync.

This is the only shape that satisfies the key constraints:

- Users are not forced to run `rtk-node` for every workflow.
- VS Code can work as a first-class integration path.
- Terminal wrapping remains optional and consent-based.
- Tool integrations can grow independently through adapters.
- Backend stays the source of truth for organization auth, RBAC, persistence, analytics, and audit logs.
- The extension and local agent never connect directly to PostgreSQL.

The CLI wrapper remains useful for command-output compression and exact before/after savings, but it should become one adapter in a larger RTK system rather than the whole product.

## Current Baseline

The repository already has:

- `rtk-node`, a command wrapper that compresses command output and stores local analytics.
- `vscode-extension`, which shows savings, opens dashboards, starts tracked agent terminals, and can sync after Microsoft login.
- `backend`, a FastAPI service for Microsoft auth, RBAC, extension installs, RTK sessions, usage snapshots, usage events, analytics, and admin views.
- `admin-dashboard`, a browser-facing admin surface.

Current extension defaults are aligned with safety: `rtk.autoWrapTerminals` is `false`, so installing the extension should not automatically modify shell profiles or wrap terminal commands.

## Target Architecture

```text
AI tools / editors / terminals
  |
  |  VS Code extension, Codex adapter, Claude adapter, Cursor adapter,
  |  terminal adapter, CLI wrapper adapter, browser adapter
  v
Local RTK agent
  |
  |  local status, sessions, events, token estimates, consent settings
  v
Token-saving engine
  |
  |  exact counts, estimated counts, savings, rollups
  v
Backend API
  |
  |  auth, RBAC, org data, persistence, audit, dashboards
  v
PostgreSQL
```

The backend remains authoritative for organization-level data. The local agent is authoritative only for local collection state and offline buffering.

## Components

### VS Code Extension

Responsibilities:

- Show session and total token savings in the status bar.
- Show a local dashboard from local agent or CLI status data.
- Authenticate with Microsoft through VS Code auth APIs.
- Store only the RTK backend app token in VS Code SecretStorage.
- Sync local snapshots/events through backend APIs after login.
- Detect supported VS Code activity where technically possible.
- Register itself with the local agent when the agent is available.
- Offer explicit commands for tracked agent terminals and optional terminal wrapping.

Non-responsibilities:

- It must not connect directly to PostgreSQL.
- It must not store Microsoft client secrets, database credentials, API keys, or raw prompts.
- It must not silently edit shell profiles.
- It must not intercept normal VS Code terminal commands by default.

### Local Desktop Agent

The local agent should be a small service started by the extension, installer, or user.

Responsibilities:

- Maintain local sessions and event buffers.
- Expose a localhost API to extensions, CLI wrappers, and adapters.
- Normalize events from different tools into a single schema.
- Run token-saving calculations locally.
- Sync to backend only after authentication.
- Enforce consent and privacy settings.
- Work without VS Code where possible.

Suggested local storage:

- Config: user config directory.
- Events/session cache: local app data directory.
- Secrets: OS credential store where available.
- Prompt/content storage: disabled by default.

Suggested process modes:

- `rtk-agent start`
- `rtk-agent status`
- `rtk-agent stop`
- Optional OS service/tray app later.

### Adapter Layer

Each integration should be isolated behind a common adapter interface. The core should not contain Codex-specific, Claude-specific, Cursor-specific, or VS Code-specific logic.

Example adapters:

- `vscode`
- `codex`
- `claude-code`
- `cursor`
- `terminal`
- `cli-wrapper`
- `browser-extension`
- future tool adapters

Adapter responsibilities:

- Detect whether the tool is installed or active.
- Register capabilities with the local agent.
- Emit normalized events.
- Mark token data as exact or estimated.
- Respect user consent and tool-specific limitations.
- Avoid collecting prompt/code content unless explicitly enabled.

## Local Agent API

Use localhost HTTP or a named pipe. HTTP is easiest for extensions and browser integrations; named pipes can be added later for tighter local security.

### `GET /status`

Returns agent health, active integrations, sync state, and current savings.

```json
{
  "agentVersion": "0.1.0",
  "status": "ok",
  "authenticated": true,
  "syncEnabled": true,
  "adapters": [
    { "id": "vscode", "status": "active" },
    { "id": "cli-wrapper", "status": "active" }
  ],
  "session": {
    "id": "workspace:hash",
    "savedTokens": 1200,
    "accuracy": "mixed"
  }
}
```

### `GET /sessions`

Returns recent local sessions and rollups.

### `POST /events`

Accepts normalized usage events from adapters.

```json
{
  "client_event_id": "stable-event-id",
  "source": "codex",
  "tool": "codex-cli",
  "session_id": "local-session-id",
  "workspace_hash": "sha256",
  "event_type": "llm_usage",
  "occurred_at": "2026-06-10T08:00:00Z",
  "tokens": {
    "input": 10000,
    "output": 1500,
    "saved": 3200,
    "accuracy": "estimated",
    "method": "chars_per_token"
  },
  "metadata": {
    "model": "unknown",
    "command_category": "agent"
  }
}
```

### `POST /sync`

Triggers backend sync if authenticated and enabled.

### `POST /tools/register`

Lets adapters announce themselves.

```json
{
  "adapter_id": "vscode",
  "display_name": "RTK VS Code Extension",
  "version": "0.1.1",
  "capabilities": ["status", "sessions", "usage-events", "manual-sync"]
}
```

## Adapter Interface

Core TypeScript-style shape:

```ts
type TokenAccuracy = "exact" | "estimated" | "unknown";

interface RtkAdapter {
  id: string;
  displayName: string;
  version: string;
  detect(): Promise<AdapterDetection>;
  start(context: AdapterContext): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<AdapterStatus>;
}

interface UsageEvent {
  clientEventId: string;
  source: string;
  tool: string;
  sessionId: string;
  workspaceHash?: string;
  eventType: "command_output" | "llm_usage" | "compression" | "manual_estimate";
  occurredAt: string;
  originalTokens?: number;
  compressedTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  savedTokens?: number;
  tokenAccuracy: TokenAccuracy;
  tokenMethod: string;
  promptStored: false;
  contentStored: false;
  metadata?: Record<string, unknown>;
}
```

Every usage record must carry `tokenAccuracy` and `tokenMethod`.

## Integration Options

### VS Code

Short term:

- Continue status polling from bundled/local `rtk-node status --json`.
- Add optional local-agent mode: extension first tries `GET /status`, then falls back to CLI.
- Use `RTK: Start Agent Terminal` for tracked Codex/Claude sessions.
- Keep `rtk.autoWrapTerminals` defaulted to `false`.

Medium term:

- Extension registers with local agent.
- Extension sends workspace/session lifecycle events.
- Extension dashboard reads from agent.
- Extension sync delegates to agent when available.

### Codex

Supported paths:

- `rtk-node agent codex` wrapper for explicit tracked sessions.
- Codex adapter that reads supported local metadata/logs if available and permitted.
- Codex instructions (`AGENTS.md` / `RTK.md`) that ask Codex to prefer `rtk-node` for noisy commands.
- Future direct integration if Codex exposes supported telemetry hooks.

Fallback:

- Estimate token savings from compressed command output and command events.
- Mark unavailable usage as `estimated` or `unknown`, never fake exact counts.

### Claude Code

Supported paths:

- `rtk-node agent claude` wrapper.
- Claude adapter for supported metadata/logs if exposed by the tool and allowed by user settings.
- Optional terminal integration for Claude-launched commands.

Rules:

- Do not scrape prompt text.
- Do not capture project files.
- Only collect usage metadata, command category, timing, and token counts when available.

### Cursor

Supported paths:

- VS Code-compatible extension mode if Cursor supports the extension APIs used by RTK.
- Local agent adapter if Cursor exposes extension or local integration hooks.
- Terminal/CLI wrapper fallback for agent terminals or command output.

Cursor should be treated as a separate adapter because extension support and API behavior can diverge from VS Code.

### Terminal

Supported modes:

- Manual wrapper: `rtk-node git status`.
- Agent wrapper: `rtk-node agent codex`.
- Optional shell hook: explicit user command only.
- Future terminal integration: agent-owned terminal sessions with environment-level session IDs.

The terminal layer must preserve:

- Working directory.
- PATH.
- Exit codes.
- Arguments including `.`, quoted strings, spaces, glob-like values, and multiline commands.
- Native command behavior when RTK is disabled or fails.

## Tracking Without Forcing `rtk-node`

RTK should collect usage through the best available source:

1. Direct tool metadata or API usage when exact counts are available.
2. Local agent events from editor/extension integrations.
3. Agent-launched terminals with `RTK_SESSION_ID`.
4. Optional shell hooks after explicit consent.
5. Manual wrappers for high-value noisy commands.
6. Estimates from local logs or compressed output where exact counts are unavailable.

The dashboard should show coverage clearly:

- Exact tokens.
- Estimated tokens.
- Unknown/untracked activity.
- Adapter health.

## Where Wrappers Remain Useful

Wrappers are still useful for:

- Command-output compression.
- Capturing exact original/compressed output token estimates.
- Agent terminal sessions.
- CI/dev workflows where deterministic wrapping is acceptable.
- Debugging adapter behavior.

Wrappers should not be required for:

- Showing VS Code status.
- Syncing already-collected usage.
- Using normal terminal commands.
- Installing the extension.

## Preventing Terminal Breakage

Rules:

- Extension install must not modify shell profiles.
- `rtk.autoWrapTerminals` must stay `false` by default.
- Shell hooks must be installed only through an explicit command and confirmation.
- Shell hooks must be removable with `rtk-node uninstall`.
- Wrapper functions must use native argument forwarding:
  - POSIX: `"$@"`
  - Fish: `$argv`
  - PowerShell: `@args`
- Wrappers must preserve native exit code.
- Wrappers must use recursion guards such as `RTK_NODE_ACTIVE`.
- If RTK fails, the shell hook should either run the native command or fail visibly without corrupting arguments.
- The extension should prefer the bundled CLI path for its own polling instead of relying on a broken global npm shim.

## Token-Saving Engine

The engine should calculate:

- Original tokens.
- Compressed tokens.
- Input tokens.
- Output tokens.
- Saved tokens.
- Estimated cost saved.
- Session rollups.
- User rollups.
- Tool rollups.
- Workspace rollups.
- Organization rollups.

Token source categories:

- `exact_api_usage`: provider/tool reported exact tokens.
- `exact_cli_metadata`: CLI reported exact tokens.
- `compression_estimate`: original vs compressed command output estimated locally.
- `log_estimate`: estimate from supported local logs.
- `manual_estimate`: conservative estimate when only text size is known.
- `unknown`: event known but token count unavailable.

Storage must preserve both the count and the source category.

## Exact vs Estimated Data

Every event and rollup should expose:

```json
{
  "tokens": 4200,
  "accuracy": "estimated",
  "method": "chars_per_token",
  "confidence": "medium"
}
```

Rollups should include split totals:

```json
{
  "exact_tokens": 10000,
  "estimated_tokens": 5000,
  "unknown_events": 3
}
```

The UI should never imply estimated values are exact.

## Backend Sync Flow

1. Adapter emits local events to local agent.
2. Local agent stores events locally.
3. User logs in through VS Code extension or local agent auth flow.
4. Backend verifies Microsoft identity and returns an RTK app token.
5. Agent/extension stores only the app token in a secure store.
6. Agent registers install/device with backend.
7. Agent upserts sessions.
8. Agent batches snapshots and usage events.
9. Backend validates ownership and organization membership.
10. Backend stores events, rollups, audit logs, and dashboard data.

Existing backend endpoints can remain, but should be generalized over time from extension-specific naming to generic client naming:

- Current: `/api/extension/installs`
- Future: `/api/clients/installs`
- Current: `/api/extension/rtk/sessions`
- Future: `/api/rtk/sessions`
- Current: `/api/extension/usage/event`
- Future: `/api/usage/events`

Backwards-compatible aliases should be kept while the extension migrates.

## Privacy and Security Model

Allowed by default:

- Tool name.
- Adapter name.
- Session ID.
- Workspace hash, not raw path.
- Timing.
- Token counts.
- Token accuracy/method.
- Command category.
- Hashed command identity when needed.
- Exit code and duration.

Disallowed by default:

- Raw prompts.
- Raw completions.
- Source code snippets.
- Full terminal output.
- API keys.
- Access tokens.
- Database credentials.
- Shell history.
- Environment dumps.
- Unrelated terminal commands.

Consent rules:

- Prompt/code collection must be separate opt-in and off by default.
- Shell profile modification must require explicit confirmation.
- Terminal command capture outside RTK wrappers must require explicit opt-in.
- Users must be able to disable adapters individually.
- Users must be able to pause all local tracking.
- Users must be able to delete local usage data.

Secret handling:

- Backend tokens: VS Code SecretStorage or OS credential store.
- Microsoft client secrets: backend environment only.
- PostgreSQL credentials: backend environment only.
- API keys: never collected or synced.

## Failure Handling

Local agent unavailable:

- Extension falls back to bundled CLI status.
- UI shows degraded mode.

Backend unavailable:

- Local collection continues.
- Sync queue retries with backoff.
- UI shows last successful sync time.

Adapter fails:

- Disable only that adapter.
- Continue other adapters.
- Surface adapter error in local dashboard.

CLI wrapper missing or broken:

- Extension should use bundled CLI where possible.
- Manual terminal commands should continue normally.
- The dashboard should show `RTK unavailable` for CLI-backed status but not interfere with user commands.

Shell hook failure:

- Hook should not be installed silently.
- Installer should create a backup.
- Uninstall should remove only the RTK managed block.

## Investigation Plan: `git add .` Broken After Extension Install

Observed in this workspace: the `rtk-node` command currently fails because the global npm shim points to a missing module:

```text
Cannot find module '...\\npm\\node_modules\\rtk-node\\bin\\rtk-node.js'
```

That failure would break commands if a shell hook rewrites `git add .` to `rtk-node git add .`.

Investigation checklist:

1. Confirm extension version and settings:
   - Check `rtk.autoWrapTerminals`.
   - Check `rtk.command`.
   - Check whether `RTK: Enable Automatic Terminal Wrapping` was run.
2. Inspect VS Code terminal profiles:
   - `terminal.integrated.profiles.windows`
   - `terminal.integrated.defaultProfile.windows`
   - shell startup arguments.
3. Inspect shell profile for RTK hook block:
   - PowerShell profile from `$PROFILE`.
   - Bash/Zsh/Fish profile where applicable.
   - Verify only the RTK managed block was added.
4. Test command resolution:
   - `Get-Command git`
   - `Get-Command rtk-node`
   - `where.exe git`
   - `where.exe rtk-node`
5. Test direct native Git:
   - `git.exe status`
   - `git.exe add .` in a disposable test repo.
6. Test wrapper argument forwarding:
   - `rtk-node git add .`
   - `rtk-node git add -- "file with spaces.txt"`
   - `rtk-node git commit -m "message"`
7. Test hook forwarding:
   - In a new terminal after hook install, run `git add .`.
   - Verify `.` arrives unchanged.
   - Verify exit code matches native Git.
8. Check environment:
   - `RTK_NODE_ACTIVE`
   - `RTK_NODE_HOOK`
   - `PATH`
   - current working directory.
9. Check extension behavior:
   - Ensure activation does not call `installShellHook()`.
   - Ensure only `rtk.enableAutoWrap` calls hook installation.
10. Fix global CLI shim:
   - Reinstall or remove broken global `rtk-node`.
   - Prefer bundled CLI path in extension-owned commands.

Required fix:

- Keep auto-wrap disabled by default.
- Do not install hooks on extension activation.
- If shell hooks are enabled and `rtk-node` cannot run, show a clear diagnostic and provide uninstall guidance.
- Consider generating hooks that call an absolute bundled CLI path rather than a fragile global npm shim.
- Add tests for `git add .`, quoted args, dot args, and exit code preservation.

## Testing Strategy

Unit tests:

- Adapter event normalization.
- Token accuracy classification.
- Command hashing.
- Consent gates.
- Shell hook generation.
- Argument forwarding including `.`, quoted strings, spaces, and `--`.

Integration tests:

- VS Code extension status fallback: local agent unavailable, bundled CLI available, global CLI broken.
- Local agent API: sessions, events, sync queue, adapter registration.
- Backend sync: auth required, disabled user, unknown user, duplicate event id, duplicate snapshot hash.
- CLI wrapper: exit code preservation and output compression.

End-to-end tests:

- VS Code-only workflow.
- Codex via `RTK: Start Agent Terminal`.
- Claude via wrapper.
- Normal terminal with no auto-wrap.
- Optional shell hook enabled.
- Multiple tools contributing to one session.
- Offline collection followed by sync.

Regression tests for terminal safety:

- Installing extension does not modify shell profile.
- `git status`, `git add .`, `git commit -m "message"`, `npm install`, `npm run build`, `node -v`, and `python --version` work after install.
- Shell hook can be installed and uninstalled cleanly.
- Broken global `rtk-node` does not affect normal commands unless the user explicitly enabled shell hooks.

## Rollout Plan

### Phase 1: Stabilize Current Extension and CLI

- Keep auto-wrap opt-in and off by default.
- Add terminal safety tests.
- Fix broken global CLI diagnostics.
- Ensure extension always prefers bundled CLI for internal polling.
- Document uninstall and recovery commands.

### Phase 2: Introduce Local Agent

- Build `rtk-agent` with `/status`, `/sessions`, `/events`, `/sync`, `/tools/register`.
- Store local events and consent settings.
- Make VS Code extension read from agent when available.
- Keep CLI fallback.

### Phase 3: Adapter Framework

- Implement adapter interface.
- Port CLI wrapper and VS Code extension to adapter model.
- Add Codex and Claude adapter stubs with wrapper-backed collection first.
- Add adapter health to local dashboard.

### Phase 4: Backend Generalization

- Add generic client/install naming while preserving current extension endpoints.
- Add token accuracy fields.
- Add source/tool/workspace rollups.
- Add exact vs estimated dashboard splits.

### Phase 5: More Tool Integrations

- Cursor support through extension compatibility or local agent adapter.
- Browser extension adapter if web-based AI tools become a target.
- Provider-specific exact usage adapters only where APIs legally and technically support it.

## Acceptance Criteria

- Users are not forced to manually run `rtk-node` for every workflow.
- VS Code extension works as an independent integration path.
- Local agent can collect events from multiple adapters.
- Terminal wrapper is optional.
- Installing the extension does not change shell profiles.
- Normal commands continue to work after extension install.
- `git add .` works with no wrapping, manual wrapping, and optional shell hook wrapping.
- RTK supports Codex, Claude, VS Code, Cursor, and terminal workflows through adapters or safe fallbacks.
- Every token record identifies exact, estimated, or unknown accuracy.
- Sync runs only after authentication.
- Backend owns organization auth, RBAC, persistence, analytics, and audit logs.
- Extension and local agent do not connect directly to PostgreSQL.
- Raw prompts, raw completions, source snippets, API keys, and backend secrets are not collected by default.
- Users can pause, disable, configure, and remove tracking.
- Local and backend dashboards show token savings and collection coverage.
- New AI tools can be added without modifying the core engine.

## Development Tasks

1. Add terminal safety tests for shell hooks and wrapper forwarding.
2. Add a diagnostic command: `rtk-node doctor`.
3. Add CLI shim validation to the extension dashboard.
4. Build `rtk-agent` service skeleton.
5. Implement local agent storage and event schema.
6. Implement `/status`, `/sessions`, `/events`, `/sync`, `/tools/register`.
7. Add token accuracy fields to local event model.
8. Update backend schemas and migrations for accuracy/source fields.
9. Add backward-compatible generic backend endpoints.
10. Update VS Code extension to prefer local agent, then bundled CLI, then global CLI.
11. Register VS Code extension as an adapter.
12. Register CLI wrapper as an adapter.
13. Implement Codex wrapper-backed adapter.
14. Implement Claude wrapper-backed adapter.
15. Add Cursor detection and compatibility adapter.
16. Add local dashboard adapter health and exact/estimated split.
17. Add sync queue retry/backoff.
18. Add privacy settings and consent UI.
19. Add uninstall/recovery flow for shell hooks.
20. Document rollout, admin setup, and troubleshooting.

