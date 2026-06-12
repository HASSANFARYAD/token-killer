# SavytoX for VS Code

SavytoX is a local-first VS Code extension that reduces noisy terminal output and prepares token-efficient context for any LLM workflow.

It works without external software. Install the extension from a VSIX or the VS Code Marketplace, open the Token Saver Terminal, run normal developer commands, and copy compact context into ChatGPT, Claude, Gemini, GitHub Copilot, Cline, Roo, Continue, Claude Code, or another terminal/context-based AI tool.

SavytoX works with any LLM workflow that uses VS Code terminal output, logs, diffs, files, or copied context.

## Extension-Only Mode

The default engine is built into the extension:

- No `rtk-node`, `rtk`, standalone CLI, unsigned binary, certificate, admin permission, login, or backend is required.
- The extension activates successfully even when no external CLI exists.
- The status bar shows `SavytoX: Ready` until local savings have been recorded.
- Source code, terminal output, and workspace data stay local by default.

The built-in optimizer includes filters for:

- `git status`, `git diff`, and `git log`
- `npm test`, `npm run build`, `pnpm test`, `yarn test`, and `pytest`
- `rg`, `grep`, `ls`, `dir`, `cat`, `type`, `Get-ChildItem`, and `Get-Content`
- Generic long output fallback

Filters preserve important errors, warnings, filenames, changed files, failed tests, stack traces, and actionable summaries while removing repetitive noise, huge unchanged output, dependency spam, repeated stack frames, and excessive file listings.

## Commands

- `SavytoX: Open Token Saver Terminal`
- `SavytoX: Copy Token-Optimized Context`
- `SavytoX: Show Token Savings Dashboard`
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

RTK commands remain for backward compatibility and advanced deployments.

## Token Saver Terminal

Run `SavytoX: Open Token Saver Terminal` to open a controlled VS Code terminal session. Commands are executed from the current workspace, output is captured locally, compacted by the built-in filters, then printed back to the terminal.

This terminal does not modify `.bashrc`, `.zshrc`, PowerShell profiles, PATH, or system settings. Automatic shell profile hooks remain an explicit legacy/advanced opt-in through `RTK: Enable Automatic Terminal Wrapping`.

## Copy Optimized Context

Run `SavytoX: Copy Token-Optimized Context` to copy a compact prompt-ready bundle to the clipboard. It can include:

- Current active file summary
- Selected text, if any
- Recent Token Saver Terminal summary
- Git status summary
- Git diff summary
- Relevant changed files

The command also opens a preview document so you can inspect the exact context before pasting it into an LLM.

## Dashboard And Metrics

Run `SavytoX: Show Token Savings Dashboard` to view local savings. Metrics are calculated inside the extension and stored in VS Code workspace state:

- Raw output characters
- Optimized output characters
- Estimated raw tokens
- Estimated optimized tokens
- Estimated tokens saved
- Percentage saved
- Commands optimized
- Current session savings

Token estimates use a simple local approximation of four characters per token. They are meant to help compare noisy versus optimized context, not to reproduce a provider-specific tokenizer exactly.

## Settings

Primary SavytoX settings:

- `savytox.engine`: `extension`, `external-cli`, or `auto`. Default: `extension`.
- `savytox.optimizationMode`: `safe`, `balanced`, or `aggressive`.
- `savytox.enableTokenSaverTerminal`: enables the Token Saver Terminal command.
- `savytox.enableShellIntegrationCapture`: allows future VS Code shell integration capture when available.
- `savytox.externalCommand`: optional external CLI command for advanced adapter mode.
- `savytox.showStatusBar`: shows local savings in the status bar.
- `savytox.maxOutputChars`: maximum optimized output size.
- `savytox.preserveErrors`: keeps errors, warnings, failed tests, and stack traces.

Legacy `rtk.*` settings are still supported for existing users. Backend sync and Microsoft login are disabled by default for local-first installs.

## Optional External CLI Mode

External CLI support is optional. Use it only when you intentionally want an advanced RTK-compatible adapter:

```json
{
  "savytox.engine": "external-cli",
  "savytox.externalCommand": "rtk-node"
}
```

In `auto` mode, SavytoX uses the extension engine unless a compatible external command is detected. Missing external tools do not block activation and do not make the default status bar show an unavailable state.

## Privacy

SavytoX is local-first by default:

- No login is required.
- No backend sync is required.
- No source code, terminal output, or workspace data is sent to a server by default.
- Network/backend features are opt-in through legacy RTK sync settings and authentication commands.
- Shell profile modification is never automatic in the default Token Saver Terminal workflow.

## Development

From this folder:

```sh
npm install
npm test
npm run package
```

The package command creates a VSIX that can be installed into a clean VS Code profile.
