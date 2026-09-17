# Testing sesshush

Sesshush wraps noisy shell commands and compresses their output before it
reaches an AI coding agent, so the agent spends fewer tokens reading it.

This is a **pilot build**. It has not been published to npm. Please read
"Known limitations" before filing anything.

## Install

You need Node 18 or newer (`node --version`).

### Option A — from the tarball (recommended for the pilot)

You will be sent a `sesshush-1.0.0.tgz`.

```sh
npm install -g ./sesshush-1.0.0.tgz
sesshush --version          # sesshush 1.0.0
```

### Option B — straight from the repo

```sh
npm install -g github:HASSANFARYAD/token-killer
sesshush --version
```

### Option C — run it without installing

```sh
git clone https://github.com/HASSANFARYAD/token-killer
cd token-killer
npm link
sesshush --version
```

## Check it works

```sh
sesshush git status
sesshush npm test
```

Both should print a compact summary followed by a `--- sesshush metadata ---`
footer showing how much was saved. If a command fails, you should still see the
error and the same exit code you would have got without sesshush.

## Two ways to use it

**Explicitly** — prefix any noisy command. Nothing is installed, nothing
changes:

```sh
sesshush pytest -q
sesshush dotnet build
sesshush rg "TODO" src
```

**Automatically** — install a shell hook so supported commands route through
sesshush on their own:

```sh
sesshush init -g
```

Restart your shell afterwards. This edits your shell profile (`~/.bashrc`,
`~/.zshrc`, or your PowerShell profile) and adds a single marked block. If
sesshush is ever missing from `PATH`, the wrapper falls back to the real command
rather than breaking your shell.

To also drop instruction files so agents prefer sesshush on their own:

```sh
sesshush init -g --all-agents   # writes AGENTS.md / SESSHUSH.md for opencode, Codex, Claude Code
```

## What we would like you to try

Use it for a few days of normal work, then tell us what you saw. Most useful:

1. **Failing builds and test runs.** This is where the savings are — a failing
   run is mostly passing-test noise. Does the failure still tell you what broke?
2. **`git status`, `git diff`, `git log`** in a busy repo.
3. **Your language's build tool** — `dotnet build`, `tsc`, `go build`, `cargo
   build`, `mvn`, `eslint`. Do the errors survive with their file and line?
4. **Anything where the compressed output misled you or your agent.** This is
   the single most valuable thing to report. Losing output is a bug; losing
   *accuracy* is a worse one.

## Reporting what you saw

```sh
sesshush gain              # lifetime totals
sesshush session           # this session only
sesshush status --json     # machine-readable
```

Please send the `gain` output along with your notes.

Read the percentage carefully: it is the share saved **of the output of commands
that went through sesshush**. It is not a percentage off your AI bill. Shell
output is only a slice of what an agent actually sends.

For a specific problem, the most useful report is:

```sh
sesshush --explain <your command>     # says which filter ran and what it dropped
SESSHUSH_DISABLE=1 <your command>     # the raw output, for comparison
```

Send both.

## Turning it off

```sh
SESSHUSH_DISABLE=1 git status   # bypass once, keep everything installed
sesshush uninstall              # remove the shell hook
npm uninstall -g sesshush       # remove entirely
```

`sesshush uninstall` removes only its own marked block; the rest of your shell
profile is left byte-for-byte intact. This is covered by a test, but check your
profile afterwards anyway and tell us if anything moved.

## Known limitations

Please do not file these — they are known and on the list:

- **Nothing is streamed.** Output appears when the command finishes, not as it
  runs. Avoid wrapping long-running or interactive commands (`npm run dev`,
  `docker build`, anything that prompts).
- **Coverage is partial.** Commands without a dedicated filter get generic
  truncation, which does nothing at all under ~220 lines.
- **Token counts are estimates** (characters ÷ 4), not a real tokenizer. Expect
  them to be off by 15–30% on code and diffs.
- **Windows: quoted inline arguments can be mangled**, e.g.
  `sesshush node -e "..."`. Use a script file instead.
- **It only sees shell commands.** If your agent reads files with its own
  built-in tools rather than through the shell, sesshush never sees that, and
  most of an agent's context is exactly that. Expect a modest win, not a
  transformation.

## Something went wrong

```sh
sesshush doctor
```

Send that output. Include your OS, shell, and `node --version`.
