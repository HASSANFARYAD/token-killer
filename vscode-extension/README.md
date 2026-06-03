# RTK Token Savings for VS Code

Shows RTK token savings in the VS Code status bar. The extension bundles the RTK CLI, so users do not need to install `rtk-node` separately for the status bar to work.

## How It Works

The extension runs its bundled RTK CLI internally every few seconds, equivalent to:

```sh
rtk-node status --json
```

It also provides `RTK: Start Agent Terminal`, which opens a VS Code terminal with `RTK_SESSION_ID` and `RTK_SESSION_LABEL` set. Commands run through `rtk-node` in that terminal are counted against the active VS Code session.

## Development Install

From this folder:

```sh
npm install -g @vscode/vsce
vsce package
code --install-extension rtk-token-savings-0.1.0.vsix
```

Install the generated `.vsix`; no separate `rtk-node` install is required for VS Code status tracking.

## Commands

- `RTK: Refresh Token Savings`
- `RTK: Start New Session`
- `RTK: Start Agent Terminal`

## Settings

- `rtk.command`: optional external RTK command. Leave empty to use the bundled RTK CLI.
- `rtk.refreshIntervalMs`: status refresh interval, default `3000`.
- `rtk.defaultAgentCommand`: default terminal command, default `codex`.
- `rtk.showTotalWhenNoSession`: show lifetime totals until the session has runs.
