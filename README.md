# sesshush

`sesshush` is a thin command-line proxy that runs a real command, filters noisy output, and appends metadata useful for AI coding agents. It is inspired by RTK-style token reduction, but intentionally starts with a small, maintainable set of command-aware filters.

## Install

From npm:

```sh
npm install -g sesshush
sesshush init -g
```

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
sesshush init -g --codex
```

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

Install wrapper functions for supported commands:

```sh
sesshush init -g
```

For Codex:

```sh
sesshush init -g --codex
```

On native Windows, Codex mode writes `AGENTS.md` and `RTK.md` instructions. Use WSL for Bash-level auto-rewrite.

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

- `git status`: branch, ahead/behind, and staged/unstaged/untracked/conflict
  counts. Runs `git status --porcelain=v2` under the hood, so the counts are
  exact and unaffected by locale. Pass your own format flag (`-s`, `--porcelain`,
  `--long`) to keep git's output as-is.
- `git diff`: filenames, hunk headers, changes, and limited context.
- `rg` / `grep`: grouped by file with capped matches per file.
- `pytest` / `npm test`: failures, tracebacks, error lines, and summaries.
- fallback: deduplicate repeated lines and truncate by configured thresholds.

## Failed commands

Output from a command that exits non-zero is compressed too, which is where most
of the savings are: a failing test run is mostly passing-test noise.

Compression of a failure is deliberately conservative:

- Filters that summarize a successful result (`git commit`, `git push`) are not
  applied to a failure, so an error is never reduced to `ok push`.
- Generic truncation keeps the tail rather than the head, because a failing
  command explains itself at the end of its output.
- If a filter would leave a failed command with no output at all, the raw output
  is printed instead.
- The exit code is always propagated unchanged.

## Piping

Stdin is passed through to the wrapped command, so `producer | sesshush consumer`
works:

```sh
cat access.log | sesshush grep ERROR
```

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

## Analytics

Show approximate saved tokens:

```sh
sesshush gain
```

Show savings for the current chat/session:

```sh
sesshush session
sesshush status --json
```

`sesshush` groups session analytics by `RTK_SESSION_ID` when it is set. This lets a CLI wrapper, editor integration, or VS Code extension show savings for the active chat instead of only lifetime totals:

```sh
export RTK_SESSION_ID="chat-$(date +%s)"
export RTK_SESSION_LABEL="Current chat"
```

PowerShell:

```powershell
$env:RTK_SESSION_ID = "chat-$([DateTimeOffset]::Now.ToUnixTimeSeconds())"
$env:RTK_SESSION_LABEL = "Current chat"
```

For status bars and editor integrations, poll:

```sh
sesshush status --json
```

The JSON contains `session.savedTokens`, `session.savedPercent`, and `total.savedTokens`. A VS Code extension can set `RTK_SESSION_ID` before spawning an agent terminal, then update a status-bar item from `sesshush status --json`.

For interactive agent CLIs, use the streaming wrapper:

```sh
sesshush agent codex
sesshush agent claude
sesshush agent cursor-agent
```

The wrapper keeps the agent interactive, sets `RTK_SESSION_ID` for the session, and prints the session token-savings summary when the agent exits. Any command the agent runs through `sesshush` is counted against that session.

An initial VS Code status-bar extension lives in:

```text
vscode-extension/
```

It polls `sesshush status --json` automatically and includes `RTK: Start Agent Terminal` for launching Codex or another CLI with session tracking enabled.

The extension can also sync RTK usage to the backend after Microsoft login. The organization features live behind this architecture:

```text
VS Code Extension -> Backend API -> PostgreSQL Database
```

The extension never stores PostgreSQL credentials, Azure AD client secrets, or admin secrets. See:

- `backend/README.md` for Super Admin bootstrap, Azure AD settings, sync, RBAC, and admin API testing.
- `vscode-extension/README.md` for Extension Development Host testing, Microsoft login, usage sync, and dashboard commands.
- `admin-dashboard/README.md` for the browser Super Admin dashboard.

Analytics are stored locally in:

```text
~/.local/share/sesshush/analytics.json
```

Token counts are estimated at roughly one token per four characters to avoid native dependencies. A tokenizer package can be added later behind the same analytics interface.

## Extending

The engine lives in `src/` at the repository root. That is the only copy: the
tree in `vscode-extension/src/` is generated by `npm run sync:engine` so the
extension can ship a working CLI inside its `.vsix`, and `npm test` fails if the
two drift. Never edit `vscode-extension/src/*.js` by hand.

Add a filter in `src/filters.js`, then update `classify(command, args)`. A filter
that summarizes a successful result must not be added to `FAILURE_SAFE_FILTERS`;
only filters that surface errors belong there.

Filters return:

```js
{ text: "compressed output", truncated: true }
```

Keep filters conservative: preserve errors, failing assertions, file names, line numbers, exit behavior, and enough context for an AI agent to act.

`sesshush` only appends the metadata footer when the filtered output plus metadata is still smaller than the raw command output. For small commands, it may print only the filtered body or the original output to avoid turning a tiny result into token growth.

Token counts default to an approximate one token per four characters. Set `SESSHUSH_CHARS_PER_TOKEN` when you want local analytics tuned for a specific agent or model family:

```sh
SESSHUSH_CHARS_PER_TOKEN=3.8 sesshush session
```
