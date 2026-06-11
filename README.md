<p align="center">
  <img src="banner.png" alt="cc-kiro-plugin banner" />
</p>

# cc-kiro-plugin

A Claude Code and Codex plugin that integrates [Kiro CLI](https://kiro.dev/docs/cli/quick-start/) as an agentic coding assistant. It routes tasks through a shared Node.js bridge, so Claude can delegate file edits, code search, shell commands, architecture analysis, and multi-step implementation work to Kiro.

## Installation

### 1. Register the marketplace

```bash
claude plugin marketplace add AllanHarlen/cc-kiro-plugin
```

### 2. Install the plugin

```bash
claude plugin install cc-kiro-plugin
```

Or open the interactive plugin manager with `/plugin` and browse to install.

### 3. Install and authenticate Kiro CLI

```bash
# macOS/Linux
curl -fsSL https://cli.kiro.dev/install | bash

# Windows PowerShell
irm 'https://cli.kiro.dev/install.ps1' | iex
```

```bash
kiro-cli login
```

Kiro headless mode may require `KIRO_API_KEY` for unattended execution.

## Why Use The Bridge?

Claude can call `kiro-cli` directly through Bash, but the plugin adds a stable contract:

| Capability | Direct `kiro-cli` | Via plugin bridge |
|------------|-------------------|-------------------|
| Consistent coding prompt | Manual each time | Built-in constraints |
| Inline file/directory context | Manual | `--dirs` / `--files` |
| Headless permissions | Manual | Agentic default or `--read-only` |
| Output capture | Manual | `--output-file` |
| Structured failures | No | quota/auth/timeout exit codes |
| Claude Code command/skill | No | `/cc-kiro-plugin:kiro` and `$kiro-integration` |

## Usage

```bash
/cc-kiro-plugin:kiro "Refactor the auth module for async/await and update all callers"

/cc-kiro-plugin:kiro --dirs src,docs "Explain the architecture and cite key files"

/cc-kiro-plugin:kiro --read-only --dirs src "Analyze the impact of removing the cache module"

/cc-kiro-plugin:kiro --list-models --model-format json-pretty

/cc-kiro-plugin:kiro --model sonnet --effort high "Design the database schema for module X"

/cc-kiro-plugin:kiro --cwd ./frontend --parallel "Implement the requested React screens and run checks"

/cc-kiro-plugin:kiro --continue "Continue from step 3 of the previous refactoring"
```

For agent usage, use `kiro-coder` for implementation work and `kiro-agent` for read-only architecture, audit, planning, and impact-analysis tasks. Coding should go through `/cc-kiro-plugin:kiro`, `$kiro-integration`, or `kiro-coder`.

## Bridge Options

| Option | Behavior |
|--------|----------|
| `--dirs <path,...>` | Inline directories into the prompt |
| `--files <glob,...>` | Inline targeted files |
| `--add-dir <path>` | Compatibility alias that inlines a directory; Kiro has no native `--add-dir` |
| `--cwd <path>` | Run Kiro from a specific working directory |
| `--model <name>` | Forward to `kiro-cli chat --model` |
| `--list-models` | List available Kiro models |
| `--model-format <format>` | Output format for `--list-models` |
| `--effort <level>` | Forward to `kiro-cli chat --effort` |
| `--agent <name>` | Forward to `kiro-cli chat --agent` |
| `--kiro-agent <name>` | Backward-compatible alias for `--agent` |
| `--trust-tools <names>` | Forward to `kiro-cli chat --trust-tools=<names>` |
| `--parallel` | Ask Kiro to use subagents/crew capabilities when useful |
| `--subagent-model <name>` | Ask subagents to use a model when available |
| `--read-only` | Use `--trust-tools=fs_read` instead of `--trust-all-tools` |
| `--continue`, `-c` | Resume the latest Kiro session for this directory |
| `--conversation <id>` | Resume a specific Kiro session via `--resume-id` |
| `--timeout <duration>` | Bridge silence timeout |
| `--output-file <path>` | Capture full output to a file |
| `--print-command` | Print the resolved `kiro-cli` command without running it |

## Local Development

```bash
npm test
```

Main runtime files:

- `scripts/kiro-bridge.js`
- `scripts/check-kiro.js`
- `commands/kiro.md`
- `agents/kiro-coder.md`
- `agents/kiro-agent.md`
- `skills/SKILL.md`

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Generic error |
| `10` | `QUOTA_EXAUSTED` |
| `11` | `AUTH_REQUIRED` |
| `12` | `TIMEOUT` |
| `13` | `KIRO_MISSING` |
