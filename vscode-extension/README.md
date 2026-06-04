# RTK Token Savings for VS Code

Shows RTK token savings in the VS Code status bar and a compact dashboard.

## How It Works

The extension runs this command internally every few seconds:

```sh
rtk-node status --json
```

If `rtk.command` is empty, the extension uses the bundled RTK CLI. You can point `rtk.command` at another executable when you want to use a separately installed CLI.

It also provides `RTK: Start Agent Terminal`, which opens a VS Code terminal through the bundled `rtk-node agent <command>` wrapper. Commands run through `rtk-node` in that terminal are counted against the active VS Code session.

## Development Install

From this folder:

```sh
npm install -g @vscode/vsce
vsce package
code --install-extension rtk-token-savings-0.1.0.vsix
```

Make sure `rtk-node` is installed and available on `PATH`.

## Commands

- `RTK: Refresh Token Savings`
- `RTK: Open Dashboard`
- `RTK: Start New Session`
- `RTK: Start Agent Terminal`

## Settings

- `rtk.command`: command used to run RTK, default `rtk-node`.
- `rtk.refreshIntervalMs`: status refresh interval, default `3000`.
- `rtk.defaultAgentCommand`: default terminal command, default `codex`.
- `rtk.showTotalWhenNoSession`: show lifetime totals until the session has runs.
