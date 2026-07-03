# Sesshush

[![npm version](https://img.shields.io/npm/v/sesshush)](https://www.npmjs.com/package/sesshush)

`sesshush` is a thin command-line proxy that runs a real command, filters noisy output, and appends metadata useful for AI coding agents. It compresses command output before entering your AI agent's context — saving tokens and reducing noise.

Supports **opencode**, **Codex (Amazon Q Developer CLI)**, **Claude Code**, and any terminal-based AI agent.

## Quick Install

From npm:

```sh
npm install -g sesshush
```

Then run the one-time setup to install shell hooks + agent instructions + VS Code extension:

```sh
sesshush init -g --all-agents
```

That's it. You can now use `sesshush` transparently — common commands like `git`, `rg`, `grep`, `pytest`, and `npm test` are auto-wrapped to pipe through the filter.

One-liner for Linux/macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/HASSANFARYAD/token-killer/main/install.sh | sh
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/HASSANFARYAD/token-killer/main/install.ps1 -UseBasicParsing | iex
```

For local development:

```sh
npm install
npm link
sesshush init -g --all-agents
```

To skip VS Code extension install: `sesshush init -g --all-agents --no-vscode`

## Usage

```sh
sesshush git status
sesshush git diff
sesshush rg "TODO" src
sesshush pytest -q
sesshush npm test
```

Debug with raw output:

```sh
sesshush -v pytest -q
```

Strip color:

```sh
sesshush --no-colors git diff
```

## Shell Hook

Install wrapper functions to auto-pipe commands through Sesshush:

```sh
sesshush init -g
```

For AI coding agents:

```sh
sesshush init -g --codex       # Amazon Q Developer CLI (Codex)
sesshush init -g --opencode    # opencode AI
sesshush init -g --all-agents  # All supported agents
```

On native Windows, agent mode writes `AGENTS.md` and `SESSHUSH.md` instructions. Use WSL for Bash-level auto-rewrite.

This updates the detected profile:

- Bash: `~/.bashrc`
- Zsh: `~/.zshrc`
- Fish: `~/.config/fish/config.fish`
- PowerShell: `Documents/PowerShell/Microsoft.PowerShell_profile.ps1`

Remove the hook:

```sh
sesshush uninstall
```

Or run the uninstall helper:

```sh
./uninstall.sh
```

The hook currently wraps `git`, `rg`, `grep`, `pytest`, and `npm`. It avoids recursive invocation with `SESSHUSH_ACTIVE`.

## Filters

- `git status`: branch plus staged, unstaged, and untracked counts.
- `git diff`: filenames, hunk headers, changes, and limited context.
- `rg` / `grep`: grouped by file with capped matches per file.
- `pytest` / `npm test`: failures, tracebacks, error lines, and summaries.
- fallback: deduplicate repeated lines and truncate by configured thresholds.

## Config

Config lives at:

```text
~/.config/sesshush/config.json
```

Defaults:

```json
{
  "excludedCommands": [],
  "maxLines": 220,
  "maxChars": 24000,
  "matchesPerFile": 8,
  "diffContextLines": 2,
  "ultraCompact": false,
  "telemetry": false,
  "colors": true
}
```

Telemetry is local only. No data is sent externally by default.

## Token Tracking

Show approximate saved tokens:

```sh
sesshush gain
```

Show savings for the current chat/session:

```sh
sesshush session
sesshush status --json
```

`sesshush` groups session analytics by session ID environment variables. It detects sessions for all AI coding agents automatically:

| Priority | Env Variable | Agent |
|---|---|---|
| 1 | `SESSHUSH_SESSION_ID` | Sesshush-native |
| 2 | `NOISEGATE_SESSION_ID` | Legacy noisegate compat |
| 3 | `RTK_SESSION_ID` | Legacy RTK compat |
| 4 | `OPENCODE_SESSION_ID` | opencode AI |
| 5 | `CLAUDE_SESSION_ID` | Claude Code |
| 6 | `CODEX_SESSION_ID` | Amazon Q Developer CLI (Codex) |
| 7 | `TERM_SESSION_ID` | Terminal session |
| 8 | (username:cwd) | Fallback |

This lets any CLI wrapper, editor integration, or VS Code extension show savings for the active chat:

```sh
export SESSHUSH_SESSION_ID="chat-$(date +%s)"
export SESSHUSH_SESSION_LABEL="Current chat"
```

PowerShell:

```powershell
$env:SESSHUSH_SESSION_ID = "chat-$([DateTimeOffset]::Now.ToUnixTimeSeconds())"
$env:SESSHUSH_SESSION_LABEL = "Current chat"
```

For status bars and editor integrations, poll:

```sh
sesshush status --json
```

The JSON contains `session.savedTokens`, `session.savedPercent`, and `total.savedTokens`. A VS Code extension can set `SESSHUSH_SESSION_ID` before spawning an agent terminal, then update a status-bar item from `sesshush status --json`.

A VS Code status-bar extension lives in:

```text
vscode-extension/
```

It polls `sesshush status --json` automatically and includes `Sesshush: Start Agent Terminal` for launching opencode, Codex, Claude Code, or any CLI agent with session tracking enabled.

Analytics are stored locally in:

```text
~/.local/share/sesshush/analytics.json
```

Token counts are estimated at roughly one token per four characters to avoid native dependencies. A tokenizer package can be added later behind the same analytics interface.

## Extending

Add a filter in `src/filters.js`, then update `classify(command, args)`.

Filters return:

```js
{ text: "compressed output", truncated: true }
```

Keep filters conservative: preserve errors, failing assertions, file names, line numbers, exit behavior, and enough context for an AI agent to act.
