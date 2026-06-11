---
name: kiro-integration
description: Use Kiro CLI as an agentic coding assistant for tasks that require creating, editing, or searching files across the codebase, or for large-context analysis that benefits from synthesizing many files in one pass.
allowed-tools: Bash(node *kiro-bridge.js*), Glob, Read
---

# Kiro CLI Integration

Kiro CLI runs as an agentic assistant that can create, edit, delete, search
files, and run commands using its native tools. Use it when the task spans
multiple files, requires codebase understanding, or needs actual file
modifications.

## When to Use Kiro

| Scenario | Mode |
|----------|------|
| Multi-file refactor or code generation | Agentic (default) |
| Create new files or reports | Agentic (default) |
| Whole-codebase architecture review | Read-only (`--read-only`) |
| Cross-file security audit | Read-only (`--read-only`) |
| Refactor impact analysis | Read-only (`--read-only`) |
| Documentation generation | Agentic or read-only |
| Structured data analysis | Read-only (`--read-only`) |

## Default Behavior

By default, the bridge is agentic: `kiro-cli chat --no-interactive
--trust-all-tools` is used. Pass `--read-only` to forward
`--trust-tools=fs_read` instead.

Kiro headless mode requires authentication. Use `kiro-cli login` for local
sessions; for unattended/headless automation, set `KIRO_API_KEY`.

## Natural-Language to Flags Conversion

Requests arrive in natural language. Convert intent into explicit flags so the
run matches the request:

| User says | Convert to |
|-----------|------------|
| "use claude opus" / "com o opus" / "opus 4.7" | `--model opus` |
| "use o sonnet" / "with sonnet 4" | `--model sonnet` |
| "use haiku" | `--model haiku` |
| "high effort" / "esforço alto" / "think hard" | `--effort high` |
| build / create / implement / edit / fix / refactor | agentic (default, no `--read-only`) |
| analyze / review / audit / explain / plan (no writes) | `--read-only` |
| "em paralelo" / "use subagents" | `--parallel` |
| "no diretório X" / "from ./Y" | `--cwd <path>` |

The bridge normalizes model aliases (`opus`, `sonnet`, `haiku`) and natural
forms like `"claude opus 4.7"` into the canonical Kiro id, so passing the family
alias to `--model` is always safe. Example: "use claude opus and develop a
front-end" -> `--model opus` in agentic mode.

## Host Entry Points

### Claude Code

For coding tasks, use the command/skill directly or spawn `kiro-coder`.
Do not spawn `kiro-agent` for work that creates, edits, deletes, moves, or
formats files; that agent is read-only analysis only.

```bash
/cc-kiro-plugin:kiro <task>
/cc-kiro-plugin:kiro --dirs src,docs <task>
/cc-kiro-plugin:kiro --files "schemas/**/*.json" <task>
/cc-kiro-plugin:kiro --cwd ./frontend <task>
/cc-kiro-plugin:kiro --read-only --dirs src <task>
```

### Codex

- Mention the skill explicitly with `$kiro-integration`.
- Or ask Codex to use the Kiro integration for a coding or analysis task.

## Shared Runtime Contract

Always prefer the shared bridge script over hand-written `kiro-cli` commands:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-bridge.js" [options] -- "<task>"
```

The bridge owns argument parsing, defaults, file ingestion, prompt assembly,
QUOTA_EXAUSTED detection, and Kiro invocation.

## Bridge Options

| Option | Behavior |
|--------|----------|
| `--dirs <path,...>` | Inline directories into the bridge prompt |
| `--files <glob,...>` | Inline targeted globs and mixed data formats |
| `--add-dir <path>` | Compatibility alias that inlines a directory; Kiro has no native `--add-dir` |
| `--cwd <path>` | Spawn Kiro from a specific working directory |
| `--model <name>` | Forwarded to `kiro-cli chat --model` |
| `--list-models` | List available Kiro models and exit |
| `--model-format <format>` | Output format for `--list-models`: `plain`, `json`, `json-pretty` |
| `--effort <level>` | Forwarded to `kiro-cli chat --effort` |
| `--agent <name>` | Forwarded to `kiro-cli chat --agent` |
| `--kiro-agent <name>` | Backward-compatible alias for `--agent` |
| `--trust-tools <names>` | Forwarded to `kiro-cli chat --trust-tools=<names>` |
| `--parallel` | Ask Kiro to use native subagent/crew capabilities when useful |
| `--subagent-model <name>` | Ask spawned subagents to use this model when available; implies `--parallel` |
| `--read-only` | Disable `--trust-all-tools`; use read/grep tools only |
| `--continue`, `-c` | Continue the most recent Kiro conversation |
| `--conversation <id>` | Resume a specific Kiro conversation |
| `--timeout <duration>` | Bridge silence timeout (default: 10m) |
| `--interactive` | Use interactive Kiro chat for human-at-terminal sessions |
| `--print-command` | Inspect the resolved Kiro command without running it |

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| `0` | Success | - |
| `1` | Generic error | Check stderr |
| `10` | QUOTA_EXAUSTED | Retry later; JSON signal emitted to stdout |
| `11` | AUTH_REQUIRED | Run `kiro-cli login` or set `KIRO_API_KEY` |
| `12` | TIMEOUT | Increase `--timeout` or narrow task scope |
| `13` | KIRO_MISSING | Install Kiro CLI |

## Good Patterns

### Agentic coding

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-bridge.js" \
  "Refactor the auth module to async/await. Update all callers. Report changed files."
```

### Monorepo subproject

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-bridge.js" --cwd ./frontend --parallel \
  "Implement the requested React components and run the frontend checks."
```

### List/select models

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-bridge.js" --list-models --model-format json-pretty

node "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-bridge.js" --model sonnet --effort high \
  "Refactor this module for testability."
```

### Read-only architecture

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-bridge.js" --read-only --dirs src,docs \
  "Explain the architecture and cite the key files."
```

### Refactor impact

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-bridge.js" --read-only --dirs src --continue \
  "Analyze the impact of refactoring the auth module. Include affected files and migration steps."
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Authentication error | Run `kiro-cli login`; for headless automation set `KIRO_API_KEY` |
| Kiro missing on PATH | macOS/Linux: `curl -fsSL https://cli.kiro.dev/install \| bash`; Windows: `irm 'https://cli.kiro.dev/install.ps1' \| iex` |
| QUOTA_EXAUSTED (exit 10) | Wait for quota reset; use `--continue` to resume later with a narrower scope |
| TIMEOUT (exit 12) | Increase `--timeout 15m` or split the task into smaller steps |
