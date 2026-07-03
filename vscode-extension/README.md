# Sesshush Token Savings for VS Code

Shows Sesshush token savings in the VS Code status bar.

## How It Works

The extension runs `sesshush status --json` internally every few seconds.

It also provides `Sesshush: Start Agent Terminal`, which opens a VS Code terminal with `SESSHUSH_SESSION_ID` and `SESSHUSH_SESSION_LABEL` set. Commands run through `sesshush` in that terminal are counted against the active VS Code session.

## Development Install

From this folder:

```sh
npm install -g @vscode/vsce
vsce package
code --install-extension sesshush-token-savings-1.0.0.vsix
```

Make sure `sesshush` is installed and available on `PATH`.

## Commands

- `Sesshush: Refresh Token Savings`
- `Sesshush: Start New Session`
- `Sesshush: Start Agent Terminal`

## Settings

- `sesshush.command`: command used to run Sesshush, default `sesshush`.
- `sesshush.refreshIntervalMs`: status refresh interval, default `3000`.
- `sesshush.defaultAgentCommand`: default terminal command, default `codex`.
- `sesshush.showTotalWhenNoSession`: show lifetime totals until the session has runs.
