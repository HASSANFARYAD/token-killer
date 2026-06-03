# rtk-node

`rtk-node` is a thin command-line proxy that runs a real command, filters noisy output, and appends metadata useful for AI coding agents. It is inspired by RTK-style token reduction, but intentionally starts with a small, maintainable set of command-aware filters.

## Install

From npm:

```sh
npm install -g rtk-node
rtk-node init -g
```

One-liner for Linux/macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/your-org/rtk-node/main/install.sh | sh
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/your-org/rtk-node/main/install.ps1 -UseBasicParsing | iex
```

For local development:

```sh
npm install
npm link
rtk-node init -g --codex
```

## Usage

```sh
rtk-node git status
rtk-node git diff
rtk-node rg "TODO" src
rtk-node pytest -q
rtk-node npm test
```

Debug with raw output:

```sh
rtk-node -v pytest -q
```

Strip color:

```sh
rtk-node --no-colors git diff
```

## Shell Hook

Install wrapper functions for supported commands:

```sh
rtk-node init -g
```

For Codex:

```sh
rtk-node init -g --codex
```

On native Windows, Codex mode writes `AGENTS.md` and `RTK.md` instructions. Use WSL for Bash-level auto-rewrite.

This updates the detected profile:

- Bash: `~/.bashrc`
- Zsh: `~/.zshrc`
- Fish: `~/.config/fish/config.fish`
- PowerShell: `Documents/PowerShell/Microsoft.PowerShell_profile.ps1`

Remove the hook:

```sh
rtk-node uninstall
```

Or run the uninstall helper:

```sh
./uninstall.sh
```

The hook currently wraps `git`, `rg`, `grep`, `pytest`, and `npm`. It avoids recursive invocation with `RTK_NODE_ACTIVE`.

## Filters

- `git status`: branch plus staged, unstaged, and untracked counts.
- `git diff`: filenames, hunk headers, changes, and limited context.
- `rg` / `grep`: grouped by file with capped matches per file.
- `pytest` / `npm test`: failures, tracebacks, error lines, and summaries.
- fallback: deduplicate repeated lines and truncate by configured thresholds.

## Config

Config lives at:

```text
~/.config/rtk-node/config.json
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
rtk-node gain
```

Analytics are stored locally in:

```text
~/.local/share/rtk-node/analytics.json
```

Token counts are estimated at roughly one token per four characters to avoid native dependencies. A tokenizer package can be added later behind the same analytics interface.

## Extending

Add a filter in `src/filters.js`, then update `classify(command, args)`.

Filters return:

```js
{ text: "compressed output", truncated: true }
```

Keep filters conservative: preserve errors, failing assertions, file names, line numbers, exit behavior, and enough context for an AI agent to act.
