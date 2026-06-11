---
description: Invoke the Kiro CLI bridge directly as the canonical agentic coding path; creates, edits, searches files, and runs commands through Kiro
allowed-tools: Bash(node *kiro-bridge.js*), Glob, Read
argument-hint: "[--list-models] [--model name] [--effort level] [--agent name] [--parallel] [--subagent-model name] [--dirs path,...] [--add-dir path] [--cwd path] [--files pattern,...] [--read-only] [--continue] [--conversation id] [--timeout duration] <task>"
---

# /cc-kiro-plugin:kiro Command

Runs a Kiro CLI agentic session to complete coding tasks. Kiro receives the task
through the shared bridge and uses its native file, search, and shell tools to
complete the work.

Use this command directly for any task that creates, edits, deletes, moves, or
formats files. You can also invoke `kiro-coder` as an agentic coding agent.
`kiro-agent` remains read-only and exists only for analysis/planning.

By default, the bridge runs Kiro headless with `--trust-all-tools`. Pass
`--read-only` for analysis-only tasks; it forwards `--trust-tools=fs_read`.

## Usage

```bash
/cc-kiro-plugin:kiro <task>
/cc-kiro-plugin:kiro --dirs <path,...> <task>
/cc-kiro-plugin:kiro --files <pattern,...> <task>
/cc-kiro-plugin:kiro --add-dir <path> <task>
/cc-kiro-plugin:kiro --cwd <path> <task>
/cc-kiro-plugin:kiro --read-only <task>
```

## Arguments

| Argument | Description | Example |
|----------|-------------|---------|
| `--model <name>` | Forward model selection to `kiro-cli chat --model`. Family aliases (`opus`, `sonnet`, `haiku`) and natural forms are normalized to the canonical id | `--model opus` |
| `--list-models` | List Kiro models and exit | `--list-models` |
| `--model-format <format>` | Output format for `--list-models`: `plain`, `json`, or `json-pretty` | `--model-format json-pretty` |
| `--effort <level>` | Forward reasoning effort to `kiro-cli chat --effort` | `--effort high` |
| `--agent <name>` | Use a Kiro custom agent config | `--agent code-reviewer` |
| `--kiro-agent <name>` | Backward-compatible alias for `--agent` | `--kiro-agent code-reviewer` |
| `--parallel` | Ask Kiro to use native subagent/crew capabilities when useful | `--parallel` |
| `--subagent-model <name>` | Ask spawned subagents to use this model when available. Implies `--parallel` | `--subagent-model sonnet` |
| `--dirs <paths>` | Recursively inline directories into the bridge prompt | `--dirs src,docs` |
| `--add-dir <path>` | Compatibility alias that inlines the directory as context. Kiro has no native `--add-dir` | `--add-dir src` |
| `--cwd <path>` | Spawn Kiro from this working directory | `--cwd ./frontend` |
| `--files <pattern,...>` | Inline matching files into the bridge prompt | `--files "schemas/**/*.json"` |
| `--read-only` | Disable `--trust-all-tools`; use read/grep tools only | `--read-only` |
| `--continue`, `-c` | Continue the most recent Kiro conversation | `--continue` |
| `--conversation <id>` | Resume a specific Kiro conversation via `--resume-id` | `--conversation abc123` |
| `--timeout <duration>` | Bridge silence timeout | `--timeout 10m` |
| `--interactive` | Use interactive `kiro-cli chat` instead of headless mode | `--interactive` |
| `<task>` | Coding task or question | required |

## Execution Instructions

Parse arguments into bridge flags, then execute through the shared bridge:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-bridge.js" [options] -- "<TASK>"
```

Guidance:
- Default invocation is agentic: Kiro may create/edit/delete files and run commands.
- Use `--read-only` when the task is pure analysis and should not modify files.
- Use `--dirs` or `--files` for explicit inline context.
- Use `--cwd` when Kiro should operate from a subproject root.
- Keep the task direct, scoped, and explicit about the expected output.

## Natural-Language to Flags Conversion

The caller usually describes the work in natural language. Before invoking the
bridge, convert that intent into explicit flags so execution matches the
request. This conversion is mandatory.

| User says (natural language) | Convert to |
|------------------------------|------------|
| "use claude opus", "com o opus", "rode no opus 4.7" | `--model opus` (bridge normalizes to the canonical id) |
| "use o sonnet", "with sonnet 4" | `--model sonnet` |
| "use haiku" | `--model haiku` |
| "esforço alto", "think hard", "high effort" | `--effort high` |
| "develop / build / implement / create / edit / fix / refactor ..." | agentic mode (default; do NOT pass `--read-only`) |
| "analyze / review / audit / explain / map / plan (no file changes)" | `--read-only` |
| "em paralelo", "use subagents", "split the work" | `--parallel` |
| "no diretório frontend", "from ./api" | `--cwd <path>` |

Rules:
- You may pass model family aliases (`opus`, `sonnet`, `haiku`) or natural forms
  like `"claude opus 4.7"` directly to `--model`; the bridge converts them to the
  canonical Kiro id. When unsure which models exist, run `--list-models` first.
- Combine signals: "use claude opus and develop a front-end" becomes
  `--model opus` in agentic mode (no `--read-only`).
- Only add `--read-only` when the task clearly must not modify files.

```bash
# "use claude opus and develop a front-end"
node "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-bridge.js" --model opus -- "develop a front-end"
```

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| `0` | Success | - |
| `1` | Generic error | Check stderr |
| `10` | `QUOTA_EXAUSTED` | Retry later or switch model; structured JSON emitted to stdout |
| `11` | `AUTH_REQUIRED` | Run `kiro-cli login` or set `KIRO_API_KEY` for headless mode |
| `12` | `TIMEOUT` | Increase `--timeout` or narrow the task scope |
| `13` | `KIRO_MISSING` | Install Kiro CLI |

## Examples

### Coding task
```bash
/cc-kiro-plugin:kiro refactor the auth module to use async/await throughout
```

### Analysis only
```bash
/cc-kiro-plugin:kiro --read-only --dirs src explain the architecture of this codebase
```

### Monorepo subproject
```bash
/cc-kiro-plugin:kiro --cwd ./frontend --parallel implement the requested React components
```

### List available models
```bash
/cc-kiro-plugin:kiro --list-models --model-format json-pretty
```

### Select a model
```bash
/cc-kiro-plugin:kiro --model opus --effort high refactor this module for testability
```

### Continue previous session
```bash
/cc-kiro-plugin:kiro --continue fix the failing tests from the previous session
```

## Error Handling

| Error | Solution |
|-------|----------|
| Authentication error | Run `kiro-cli login`; for headless automation set `KIRO_API_KEY` |
| Kiro missing on PATH | macOS/Linux: `curl -fsSL https://cli.kiro.dev/install \| bash`; Windows: `irm 'https://cli.kiro.dev/install.ps1' \| iex` |
| QUOTA_EXAUSTED | Wait for quota reset or use `--continue` to resume with a narrower scope |
| Timeout | Increase `--timeout 15m`, reduce the task scope, or split into steps |
