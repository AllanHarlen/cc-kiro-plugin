#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { resolveDefaultLogPath, logEvent } from "./utils.js";

const DEFAULT_MAX_FILES = 40;
const DEFAULT_MAX_FILE_BYTES = 32_768;
const SUPPORTED_FORMATS = new Set(["text"]);
const KNOWN_BINARY_EXTENSIONS = new Set([
  ".7z", ".ai", ".avif", ".bmp", ".class", ".db", ".dll", ".dylib",
  ".eot", ".exe", ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg",
  ".lockb", ".mov", ".mp3", ".mp4", ".otf", ".pdf", ".png", ".pyc",
  ".so", ".svgz", ".tar", ".ttf", ".wasm", ".webm", ".webp", ".woff",
  ".woff2", ".zip",
]);

const IGNORED_PATH_SEGMENTS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const MEDIA_TYPES = new Map([
  [".csv", "text/csv"],
  [".graphql", "application/graphql"],
  [".gql", "application/graphql"],
  [".html", "text/html"],
  [".json", "application/json"],
  [".jsonl", "application/x-ndjson"],
  [".md", "text/markdown"],
  [".sql", "text/sql"],
  [".toml", "application/toml"],
  [".tsv", "text/tab-separated-values"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
]);

export const EXIT_SUCCESS = 0;
export const EXIT_QUOTA_EXAUSTED = 10;
export const EXIT_AUTH_REQUIRED = 11;
export const EXIT_TIMEOUT = 12;
export const EXIT_KIRO_MISSING = 13;
export const EXIT_ERROR = 1;

const QUOTA_PATTERNS = [
  /QUOTA_EXAUSTED/,
  /quota.*exceeded/i,
  /rate.?limit/i,
  /resource.?exhausted/i,
  /\b429\b/,
  /too many requests/i,
  /daily.*limit/i,
];

const AUTH_PATTERNS = [
  /not authenticated/i,
  /authentication.*required/i,
  /please.{0,20}sign.?in/i,
  /please.{0,20}log.?in/i,
  /\bunauthorized\b/i,
  /\b401\b/,
  /KIRO_API_KEY/i,
  /api key.*required/i,
];

const USAGE = `Usage:
  node "\${CLAUDE_PLUGIN_ROOT}/scripts/kiro-bridge.js" [options] <task>

Options:
  --task <text>              Explicit task text.
  --dirs <path,...>          Directories to ingest recursively and inline into the prompt.
  --add-dir <path>           Compatibility alias: add a directory to inline context. Repeatable.
                             Kiro CLI has no native --add-dir; use --cwd to change execution root.
  --cwd <path>               Working directory used when spawning kiro-cli. Default: current directory.
  --files <glob,...>         File globs to ingest.
  --format <text>            Output format. Default: text.
  --model <name>             Forwarded to kiro-cli chat --model. Accepts family
                             aliases (opus, sonnet, haiku) and natural-language
                             forms like "claude opus 4.7"; normalized to the
                             canonical Kiro id before invocation.
  --list-models              List Kiro models and exit.
  --model-format <format>    Output format for --list-models: plain, json, json-pretty. Default: json.
  --effort <level>           Forwarded to kiro-cli chat --effort (low, medium, high, xhigh, max).
  --agent <name>             Forwarded to kiro-cli chat --agent.
  --kiro-agent <name>        Alias for --agent.
  --trust-tools <names>      Forwarded to kiro-cli chat --trust-tools=<names>.
  --parallel                 Ask Kiro to use its native subagent/crew capabilities when useful.
  --subagent-model <name>    Ask spawned subagents to use this model. Implies --parallel.
  --timeout <duration>       Bridge silence timeout (for example: 3m, 300s). Kiro has no matching CLI flag.
  --interactive              Use interactive Kiro chat instead of --no-interactive.
  --read-only                Disable --trust-all-tools; forwards --trust-tools=fs_read by default.
  --continue, -c             Resume the most recent Kiro conversation for this directory.
  --conversation <id>        Resume a specific Kiro conversation via --resume-id.
  --skip-permissions         Compatibility alias for --trust-all-tools (on by default).
  --output-file <path>       Write the full Kiro output to a file instead of streaming to stdout.
  --print-command            Print the resolved kiro-cli command and exit.
  -h, --help                 Show this help message.

Defaults:
  Agentic mode is ON by default: --trust-all-tools is forwarded. Pass --read-only
  to restrict Kiro to read/grep style tools.

Exit codes:
   0  Success
   1  Generic error
  10  QUOTA_EXAUSTED  - quota or rate limit hit; workflow should retry or pause
  11  AUTH_REQUIRED   - Kiro needs login or KIRO_API_KEY for headless mode
  12  TIMEOUT         - Kiro did not respond within the configured timeout
  13  KIRO_MISSING    - Kiro CLI not found on PATH

Logging:
  Plugin events are always written to a JSONL log file.
    Windows:     %LOCALAPPDATA%\\kiro\\cc-plugin-logs\\plugin-YYYY-MM-DD.jsonl
    macOS/Linux: ~/.local/share/kiro/cc-plugin-logs/plugin-YYYY-MM-DD.jsonl
  Override:      CC_KIRO_LOG_PATH=<path>
  Legacy override: CC_ANTIGRAVITY_LOG_PATH=<path>
  Include output chunks in log: CC_KIRO_LOG_OUTPUT=1
`;

function summarizeParsedArgs(parsed) {
  return {
    dirs: parsed.dirs,
    addDirs: parsed.addDirs,
    cwd: parsed.cwd,
    files: parsed.files,
    format: parsed.format,
    model: parsed.model,
    listModels: parsed.listModels,
    modelFormat: parsed.modelFormat,
    effort: parsed.effort,
    kiroAgent: parsed.kiroAgent,
    trustTools: parsed.trustTools,
    timeout: parsed.timeout,
    interactive: parsed.interactive,
    readOnly: parsed.readOnly,
    continueConversation: parsed.continueConversation,
    conversationId: parsed.conversationId,
    skipPermissions: parsed.skipPermissions,
    maxFiles: parsed.maxFiles,
    maxFileBytes: parsed.maxFileBytes,
    printCommand: parsed.printCommand,
    outputFile: parsed.outputFile,
    parallel: parsed.parallel,
    subagentModel: parsed.subagentModel,
    help: parsed.help,
    taskLength: parsed.task.length,
  };
}

function summarizeContext(context) {
  return {
    includedCount: context.included.length,
    skippedCount: context.skipped.length,
    included: context.included.map((file) => ({
      path: file.path,
      mediaType: file.mediaType,
      bytes: file.bytes,
      truncated: file.truncated,
    })),
    skipped: context.skipped,
  };
}

function summarizeKiroArgs(args) {
  const summarized = [];
  for (const arg of args) {
    if (arg.length > 500) {
      summarized.push(`<prompt:${arg.length} chars>`);
    } else {
      summarized.push(arg);
    }
  }
  return summarized;
}

function shouldLogKiroOutput() {
  return process.env.CC_KIRO_LOG_OUTPUT === "1";
}

function splitList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeSlashes(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function relativeToCwd(cwd, targetPath) {
  return normalizeSlashes(path.relative(cwd, targetPath));
}

function getMediaType(filePath) {
  return MEDIA_TYPES.get(path.extname(filePath).toLowerCase()) ?? "text/plain";
}

function isIgnoredPath(relativePath) {
  return relativePath
    .split("/")
    .some((segment) => IGNORED_PATH_SEGMENTS.has(segment));
}

function isBinaryCandidate(filePath, buffer) {
  if (KNOWN_BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return true;
  }
  return buffer.includes(0);
}

function parsePositiveInteger(rawValue, flagName) {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flagName} must be a positive integer. Received: ${rawValue}`);
  }
  return value;
}

function takeOptionValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flagName}.`);
  }
  return value;
}

export function classifyKiroOutput(output) {
  if (QUOTA_PATTERNS.some((p) => p.test(output))) {
    const reasonMatch = output.match(/QUOTA_EXAUSTED\s+reason="([^"]+)"/);
    const reason = reasonMatch ? reasonMatch[1] : "quota or rate limit reached";
    return { type: "QUOTA_EXAUSTED", reason, exitCode: EXIT_QUOTA_EXAUSTED };
  }
  if (AUTH_PATTERNS.some((p) => p.test(output))) {
    return {
      type: "AUTH_REQUIRED",
      reason: "authentication required - run `kiro-cli login` or set KIRO_API_KEY for headless mode",
      exitCode: EXIT_AUTH_REQUIRED,
    };
  }
  return null;
}

function emitStructuredSignal(type, reason, model, _stdout) {
  const signal = { status: type, reason, model };
  if (type === "QUOTA_EXAUSTED") signal.retry = "--continue";
  _stdout.write(JSON.stringify(signal) + "\n");
}

export function parseCliArgs(argv) {
  const parsed = {
    dirs: [],
    addDirs: [],
    cwd: undefined,
    files: [],
    format: "text",
    model: undefined,
    listModels: false,
    modelFormat: "json",
    effort: undefined,
    kiroAgent: undefined,
    trustTools: undefined,
    timeout: undefined,
    interactive: false,
    readOnly: false,
    continueConversation: false,
    conversationId: undefined,
    skipPermissions: true,
    maxFiles: DEFAULT_MAX_FILES,
    maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    printCommand: false,
    outputFile: undefined,
    outputDir: undefined,
    parallel: false,
    subagentModel: undefined,
    task: "",
    help: false,
  };

  const taskTokens = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--") {
      taskTokens.push(...argv.slice(index + 1));
      break;
    }

    switch (token) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "--task":
        parsed.task = takeOptionValue(argv, index, token);
        index += 1;
        break;
      case "--dirs":
        parsed.dirs.push(...splitList(takeOptionValue(argv, index, token)));
        index += 1;
        break;
      case "--add-dir":
        parsed.addDirs.push(takeOptionValue(argv, index, token));
        index += 1;
        break;
      case "--cwd":
        parsed.cwd = takeOptionValue(argv, index, token);
        index += 1;
        break;
      case "--files":
        parsed.files.push(...splitList(takeOptionValue(argv, index, token)));
        index += 1;
        break;
      case "--model":
        parsed.model = takeOptionValue(argv, index, token);
        index += 1;
        break;
      case "--list-models":
        parsed.listModels = true;
        break;
      case "--model-format":
        parsed.modelFormat = takeOptionValue(argv, index, token);
        index += 1;
        break;
      case "--effort":
        parsed.effort = takeOptionValue(argv, index, token);
        index += 1;
        break;
      case "--agent":
      case "--kiro-agent":
        parsed.kiroAgent = takeOptionValue(argv, index, token);
        index += 1;
        break;
      case "--trust-tools":
        parsed.trustTools = takeOptionValue(argv, index, token);
        parsed.skipPermissions = false;
        index += 1;
        break;
      case "--timeout":
        parsed.timeout = takeOptionValue(argv, index, token);
        index += 1;
        break;
      case "--interactive":
        parsed.interactive = true;
        break;
      case "--read-only":
        parsed.readOnly = true;
        parsed.skipPermissions = false;
        if (parsed.trustTools === undefined) parsed.trustTools = "fs_read";
        break;
      case "--continue":
      case "-c":
        parsed.continueConversation = true;
        break;
      case "--conversation":
        parsed.conversationId = takeOptionValue(argv, index, token);
        index += 1;
        break;
      case "--sandbox":
        // Kept as a compatibility no-op; Kiro controls permissions through trusted tools.
        break;
      case "--skip-permissions":
        parsed.skipPermissions = true;
        parsed.trustTools = undefined;
        break;
      case "--format": {
        const format = takeOptionValue(argv, index, token);
        if (!SUPPORTED_FORMATS.has(format)) {
          throw new Error(
            `Unsupported --format value "${format}". Expected one of: ${[
              ...SUPPORTED_FORMATS,
            ].join(", ")}`,
          );
        }
        parsed.format = format;
        index += 1;
        break;
      }
      case "--max-files":
        parsed.maxFiles = parsePositiveInteger(takeOptionValue(argv, index, token), token);
        index += 1;
        break;
      case "--max-file-bytes":
        parsed.maxFileBytes = parsePositiveInteger(takeOptionValue(argv, index, token), token);
        index += 1;
        break;
      case "--print-command":
        parsed.printCommand = true;
        break;
      case "--generate-imagem":
      case "--generate-image":
        throw new Error(
          "--generate-image is not supported by the Kiro bridge.",
        );
      case "--parallel":
        parsed.parallel = true;
        break;
      case "--subagent-model":
        parsed.subagentModel = takeOptionValue(argv, index, token);
        parsed.parallel = true;
        index += 1;
        break;
      case "--output-file":
        parsed.outputFile = takeOptionValue(argv, index, token);
        index += 1;
        break;
      case "--output-dir":
        parsed.outputDir = takeOptionValue(argv, index, token);
        index += 1;
        break;
      default:
        taskTokens.push(token);
        break;
    }
  }

  if (!parsed.task) {
    parsed.task = taskTokens.join(" ").trim();
  }

  if (!parsed.help && !parsed.listModels && !parsed.task) {
    throw new Error("A task is required.\n\n" + USAGE);
  }

  return parsed;
}

function walkDirSync(dir, baseCwd = dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (IGNORED_PATH_SEGMENTS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDirSync(fullPath, baseCwd));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function escapeRegex(raw) {
  return raw.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern) {
  const normalized = normalizeSlashes(pattern);
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*") {
      if (next === "*") {
        const afterGlobstar = normalized[index + 2];
        if (afterGlobstar === "/") {
          source += "(?:.*\\/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function collectDirectoryMatches(cwd, dirPath) {
  const absoluteDir = path.resolve(cwd, dirPath.replace(/[\\/]+$/, ""));
  return walkDirSync(absoluteDir);
}

function collectPatternMatches(cwd, patterns) {
  if (patterns.length === 0) return [];
  const workspaceRoot = path.resolve(cwd);
  const matchers = patterns.map(globToRegExp);
  return walkDirSync(workspaceRoot).filter((absolutePath) => {
    const rel = relativeToCwd(workspaceRoot, absolutePath);
    return matchers.some((m) => m.test(rel));
  });
}

export async function collectContextFiles({
  cwd,
  dirs = [],
  patterns = [],
  maxFiles,
  maxFileBytes,
}) {
  const workspaceRoot = path.resolve(cwd);
  const allMatches = new Set();

  for (const dirPath of dirs) {
    for (const match of collectDirectoryMatches(cwd, dirPath)) {
      allMatches.add(path.resolve(workspaceRoot, match));
    }
  }

  for (const match of collectPatternMatches(cwd, patterns)) {
    allMatches.add(path.resolve(workspaceRoot, match));
  }

  const included = [];
  const skipped = [];
  const sortedMatches = [...allMatches].sort((left, right) => left.localeCompare(right));

  for (const absolutePath of sortedMatches) {
    const relativePath = relativeToCwd(cwd, absolutePath);

    if (isIgnoredPath(relativePath)) {
      skipped.push({ path: relativePath, reason: "ignored-path" });
      continue;
    }

    if (included.length >= maxFiles) {
      skipped.push({ path: relativePath, reason: "max-files-exceeded" });
      continue;
    }

    try {
      const stat = await fsp.stat(absolutePath);
      if (!stat.isFile()) {
        skipped.push({ path: relativePath, reason: "not-a-file" });
        continue;
      }

      const fileBuffer = await fsp.readFile(absolutePath);
      if (isBinaryCandidate(absolutePath, fileBuffer)) {
        skipped.push({ path: relativePath, reason: "unsupported-extension" });
        continue;
      }

      const truncated = fileBuffer.length > maxFileBytes;
      const trimmedBuffer = truncated ? fileBuffer.subarray(0, maxFileBytes) : fileBuffer;

      let content;
      try {
        content = truncated
          ? trimmedBuffer.toString("utf8")
          : new TextDecoder("utf-8", { fatal: true }).decode(trimmedBuffer);
      } catch {
        skipped.push({ path: relativePath, reason: "encoding-error" });
        continue;
      }

      included.push({
        path: relativePath,
        mediaType: getMediaType(absolutePath),
        bytes: fileBuffer.length,
        truncated,
        content,
      });
    } catch (error) {
      skipped.push({
        path: relativePath,
        reason: error instanceof Error ? `read-error: ${error.message}` : "read-error",
      });
    }
  }

  return { included, skipped };
}

export function buildParallelismBlock({ parallel = false, subagentModel } = {}) {
  if (!parallel) return "";
  const modelLine = subagentModel
    ? `- Configure each subagent to use the model "${subagentModel}" when Kiro exposes per-agent model control.\n`
    : "";
  const decompositionVerb = subagentModel ? "MUST" : "MAY";
  const spawnConstraint = subagentModel
    ? "- Each independent part of the task MUST be handled by a dedicated subagent."
    : "- Spawn subagents only for genuinely independent work; keep shared or sequential steps in the main agent.";
  return `

<parallelism>
- You ${decompositionVerb} decompose this task into independent subtasks and run them concurrently using Kiro's
  native subagent or crew capabilities when they are available in this session.
${spawnConstraint}
- Decide the number of subagents yourself based on how many independent subparts the task has.
${modelLine}- Wait for every subagent to finish before concluding.
- Aggregate the subagents' outputs into one final report, and list each subagent's purpose.
</parallelism>`;
}

export function buildKiroPrompt({ task, context, parallel = false, subagentModel }) {
  const inventoryLines = [];

  if (context.included.length > 0) {
    inventoryLines.push("Included files:");
    for (const file of context.included) {
      inventoryLines.push(
        `- ${file.path} | ${file.mediaType} | ${file.bytes} bytes | truncated=${file.truncated}`,
      );
    }
  } else {
    inventoryLines.push("Included files: none");
  }

  if (context.skipped.length > 0) {
    inventoryLines.push("Skipped files:");
    for (const skipped of context.skipped) {
      inventoryLines.push(`- ${skipped.path} (${skipped.reason})`);
    }
  }

  const fileBlocks =
    context.included.length === 0
      ? "No inline file payloads were collected."
      : context.included
          .map(
            (file) => `<file path="${file.path}" media_type="${file.mediaType}" truncated="${file.truncated}">
${file.content.replaceAll("</", "<\\/")}
</file>`,
          )
          .join("\n\n");

  return `<context_inventory>
${inventoryLines.join("\n")}
</context_inventory>

<context_files>
${fileBlocks}
</context_files>

<task>
${task}
</task>

<constraints>
- You are an agentic coding assistant running through Kiro CLI. Complete the task fully using your available tools.
- Use Kiro's file read, file write, grep/search, and shell tools when needed.
- Use the provided inline context when relevant; cite file paths when referencing it.
- If inline context is partial or truncated, read the full files before acting.
- Complete the entire task without stopping mid-way. Report all changes made at the end.
- If you hit a quota or rate limit, immediately output on its own line and then stop:
  QUOTA_EXAUSTED reason="<specific reason>" model="<model name>"
</constraints>${buildParallelismBlock({ parallel, subagentModel })}`;
}

export function buildKiroArgs({
  prompt,
  model,
  listModels = false,
  modelFormat = "json",
  effort,
  kiroAgent,
  trustTools,
  interactive = false,
  continueConversation = false,
  conversationId,
  skipPermissions = false,
} = {}) {
  const args = ["chat"];
  if (listModels) {
    args.push("--list-models", "--format", modelFormat);
    return args;
  }
  if (!interactive) args.push("--no-interactive", "--wrap", "never");
  if (continueConversation) args.push("--resume");
  if (conversationId) args.push("--resume-id", conversationId);
  if (kiroAgent) args.push("--agent", kiroAgent);
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (skipPermissions) {
    args.push("--trust-all-tools");
  } else if (trustTools !== undefined) {
    args.push(`--trust-tools=${trustTools}`);
  }
  args.push(prompt);
  return args;
}

export function resolveKiroExe(_spawnSync = spawnSync, _fs = fs) {
  const isWin = process.platform === "win32";
  const whichCmd = isWin ? "where" : "which";
  const result = _spawnSync(whichCmd, ["kiro-cli"], { encoding: "utf8", shell: false });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  if (result.status === 0 && stdout.trim()) {
    return stdout.trim().split(/\r?\n/)[0];
  }
  if (isWin) {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Local"),
      "Kiro-Cli",
      "kiro-cli.exe",
    );
  }

  const home = process.env.HOME ?? "";
  for (const candidate of [path.join(home, ".local", "bin", "kiro-cli"), "/usr/local/bin/kiro-cli"]) {
    try {
      _fs.accessSync(candidate, _fs.constants.X_OK);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return "kiro-cli";
}

export function loadNodePty() {
  const require = createRequire(import.meta.url);
  try {
    return require("node-pty");
  } catch {
    return null;
  }
}

export function stripAnsi(raw) {
  return raw
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

const CONPTY_TIMEOUT_MS = 600_000;

function parseTimeoutMs(timeout) {
  if (!timeout) return CONPTY_TIMEOUT_MS;
  const match = String(timeout).trim().match(/^(\d+)(ms|s|m|h)?(?:0s)?$/);
  if (!match) return CONPTY_TIMEOUT_MS;
  const value = Number.parseInt(match[1], 10);
  const unit = match[2] ?? "ms";
  if (unit === "h") return value * 60 * 60 * 1000;
  if (unit === "m") return value * 60 * 1000;
  if (unit === "s") return value * 1000;
  return value;
}

function buildKiroMissingError() {
  const err = new Error(
    "Kiro CLI (kiro-cli) is not installed or not on PATH.\n" +
      "Install it with:\n" +
      "  macOS/Linux:  curl -fsSL https://cli.kiro.dev/install | bash\n" +
      "  Windows:      irm 'https://cli.kiro.dev/install.ps1' | iex\n" +
      "Then authenticate with `kiro-cli login`. Headless mode requires KIRO_API_KEY.",
  );
  err.code = "EKIROMISSING";
  return err;
}

// Canonical Kiro model id for each Claude model family. These are the single
// source of truth used both by resolveAutoModel and by the natural-language
// alias normalizer below. Update these when Kiro ships new model versions.
export const CANONICAL_MODELS = {
  opus: "claude-opus-4.7",
  sonnet: "claude-sonnet-4",
  haiku: "claude-haiku-4",
};

const MODEL_FAMILIES = Object.keys(CANONICAL_MODELS);

// Converts a natural-language or shorthand model reference into the canonical
// Kiro model id. This guarantees that a request like "use claude opus" (which a
// host LLM may forward as --model opus, "claude opus", or "Claude Opus 4.7")
// reaches kiro-cli as a valid id. Unknown ids (e.g. third-party models) are
// passed through unchanged so the contract never silently drops a valid value.
export function normalizeModel(raw) {
  if (raw == null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  if (lower === "auto") return "auto";

  // Normalize spacing/separators and drop an optional leading "claude" token so
  // "Claude Opus 4.7", "claude-opus-4.7", and "opus 4.7" all compare equally.
  const compact = lower
    .replace(/[\s_]+/g, "-")
    .replace(/^claude-?/, "");

  // Family-only alias: "opus" -> "claude-opus-4.7".
  if (CANONICAL_MODELS[compact]) return CANONICAL_MODELS[compact];

  // Family + explicit version: "opus-4.7" -> "claude-opus-4.7".
  for (const family of MODEL_FAMILIES) {
    if (compact === family || compact.startsWith(`${family}-`)) {
      return `claude-${compact}`;
    }
  }

  // Unknown model id: keep it but normalize internal whitespace to hyphens.
  return trimmed.replace(/\s+/g, "-");
}

export function resolveAutoModel(context) {
  const totalBytes = context.included.reduce((sum, f) => sum + f.bytes, 0);
  if (totalBytes < 32_768) return "auto";
  if (totalBytes < 262_144) return CANONICAL_MODELS.sonnet;
  return CANONICAL_MODELS.opus;
}

export function checkKiroConnectivity(kiroExe, _spawnSync = spawnSync) {
  const result = _spawnSync(kiroExe, ["--version"], {
    encoding: "utf8",
    shell: false,
    timeout: 5_000,
  });

  if (result.error) {
    logEvent("kiro.connectivity.check", { kiroExe, ok: false, errorCode: result.error.code });
    if (result.error.code === "ENOENT") {
      throw buildKiroMissingError();
    }
    throw result.error;
  }

  const version = result.stdout?.trim() || result.stderr?.trim() || "(unknown)";
  const ok = result.status === 0;
  logEvent("kiro.connectivity.check", { kiroExe, ok, version, exitCode: result.status });

  if (!ok) {
    throw new Error(
      `Kiro CLI responded with exit code ${result.status} to --version. ` +
        "It may require authentication - run `kiro-cli login` to complete setup.\n" +
        `Binary: ${kiroExe}`,
    );
  }
}

export async function spawnViaConPty(
  kiroExe,
  kiroArgs,
  pty,
  timeoutMs = CONPTY_TIMEOUT_MS,
  _stdout = process.stdout,
  outputAccumulator = null,
  cwd = process.cwd(),
) {
  return new Promise((resolve, reject) => {
    let wroteOutput = false;
    let lastOutput = "";
    let term;
    logEvent("kiro.conpty.spawn.start", {
      kiroExe,
      timeoutMs,
      args: summarizeKiroArgs(kiroArgs),
      cwd,
    });
    try {
      term = pty.spawn(kiroExe, kiroArgs, {
        name: "xterm-color",
        cols: 220,
        rows: 30,
        cwd,
        env: process.env,
      });
    } catch (err) {
      logEvent("kiro.conpty.spawn.error", {
        message: err instanceof Error ? err.message : String(err),
      });
      reject(err);
      return;
    }

    const timeoutFn = () => {
      try { term.kill(); } catch { /* already dead */ }
      logEvent("kiro.conpty.timeout", { timeoutMs });
      const timeoutErr = new Error(
        `kiro-cli did not respond within ${timeoutMs / 1000}s.\n` +
        "Check authentication (`kiro-cli login` or KIRO_API_KEY), network connectivity, and task scope.",
      );
      timeoutErr.code = "ETIMEDOUT";
      reject(timeoutErr);
    };
    let timer = setTimeout(timeoutFn, timeoutMs);

    term.onData((data) => {
      const clean = stripAnsi(data);
      if (clean) {
        clearTimeout(timer);
        timer = setTimeout(timeoutFn, timeoutMs);
        wroteOutput = true;
        lastOutput = clean;
        if (outputAccumulator !== null) outputAccumulator.push(clean);
        if (shouldLogKiroOutput()) {
          logEvent("kiro.output.chunk", { text: clean });
        }
        _stdout.write(clean);
      }
    });
    term.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (wroteOutput && !lastOutput.endsWith("\n")) {
        _stdout.write("\n");
      }
      logEvent("kiro.conpty.spawn.exit", { exitCode: exitCode ?? 1 });
      resolve(exitCode ?? 1);
    });
  });
}

function renderKiroCommand(args) {
  return ["kiro-cli", ...args.map((arg) => JSON.stringify(arg))].join(" ");
}

function printResolvedCommands(kiroArgs, _stdout = process.stdout) {
  _stdout.write(renderKiroCommand(kiroArgs) + "\n");
}

export async function main(argv = process.argv.slice(2), {
  _spawnSync = spawnSync,
  _loadNodePty = loadNodePty,
  _conPtyTimeoutMs = CONPTY_TIMEOUT_MS,
  _stdout = process.stdout,
  _stderr = process.stderr,
  _isTTY = Boolean(process.stdout.isTTY),
} = {}) {
  try {
    logEvent("bridge.start", {
      provider: "kiro",
      flags: argv.filter((a) => a.startsWith("--")),
      taskLength: argv.join(" ").length,
    });
    const parsed = parseCliArgs(argv);
    logEvent("bridge.args.parsed", summarizeParsedArgs(parsed));

    if (parsed.help) {
      _stdout.write(USAGE);
      logEvent("bridge.help", {});
      return EXIT_SUCCESS;
    }

    if (parsed.listModels) {
      const kiroArgs = buildKiroArgs({
        listModels: true,
        modelFormat: parsed.modelFormat,
      });
      logEvent("bridge.kiro.args.built", {
        args: summarizeKiroArgs(kiroArgs),
        listModels: true,
      });

      if (parsed.printCommand) {
        printResolvedCommands(kiroArgs, _stdout);
        logEvent("bridge.print-command", { args: summarizeKiroArgs(kiroArgs) });
        return EXIT_SUCCESS;
      }

      const kiroExe = resolveKiroExe(_spawnSync);
      checkKiroConnectivity(kiroExe, _spawnSync);
      const result = _spawnSync(kiroExe, kiroArgs, {
        stdio: "pipe",
        encoding: "utf8",
        cwd: process.cwd(),
      });
      if (result.error) {
        if (result.error.code === "ENOENT") throw buildKiroMissingError();
        throw result.error;
      }
      const output = stripAnsi((result.stdout ?? "") + (result.stderr ?? ""));
      _stdout.write(output);
      return result.status ?? EXIT_ERROR;
    }

    if (parsed.parallel && !parsed.outputFile && !_isTTY) {
      const tmpDir = process.env.TEMP ?? process.env.TMPDIR ?? "/tmp";
      parsed.outputFile = path.join(tmpDir, `kiro-parallel-${Date.now()}.txt`);
      logEvent("bridge.parallel.auto-output-file", { path: parsed.outputFile });
    }

    const spawnCwd = path.resolve(parsed.cwd ?? process.cwd());
    const contextDirs = [...parsed.dirs, ...parsed.addDirs];
    const context = await collectContextFiles({
      cwd: spawnCwd,
      dirs: contextDirs,
      patterns: parsed.files,
      maxFiles: parsed.maxFiles,
      maxFileBytes: parsed.maxFileBytes,
    });
    logEvent("bridge.context.collected", summarizeContext(context));

    const defaultModel = process.env.CLAUDE_PLUGIN_OPTION_DEFAULT_MODEL;
    const requestedModel = parsed.model ?? defaultModel;
    let model = normalizeModel(requestedModel);
    const modelSource = parsed.model ? "flag" : (defaultModel ? "env" : "default");
    if (model === "auto") {
      const contextBytes = context.included.reduce((s, f) => s + f.bytes, 0);
      model = resolveAutoModel(context);
      logEvent("bridge.model.resolved", { model, source: "auto", contextBytes });
    } else {
      logEvent("bridge.model.resolved", {
        model: model ?? "(kiro-default)",
        requested: requestedModel ?? "(none)",
        normalized: requestedModel !== undefined && model !== requestedModel,
        source: modelSource,
      });
    }

    const subagentModel = normalizeModel(parsed.subagentModel);

    let prompt = buildKiroPrompt({
      task: parsed.task,
      context,
      parallel: parsed.parallel,
      subagentModel,
    });

    if (process.platform === "win32" && prompt.length > 28_000) {
      const fallbackContext = {
        included: [],
        skipped: context.included.map((f) => ({ path: f.path, reason: "prompt-overflow-windows" })),
      };
      logEvent("bridge.prompt.overflow", {
        promptLength: prompt.length,
        limit: 28_000,
        droppedFiles: context.included.length,
      });
      _stderr.write(
        `Warning: prompt (${prompt.length} chars) exceeds Windows CLI limit. ` +
          `Dropped ${context.included.length} inline file(s); Kiro will inspect files from cwd if needed.\n`,
      );
      prompt = buildKiroPrompt({
        task: parsed.task,
        context: fallbackContext,
        parallel: parsed.parallel,
        subagentModel,
      });
    }

    const effort = parsed.effort ?? process.env.CLAUDE_PLUGIN_OPTION_DEFAULT_EFFORT;
    const timeout = parsed.timeout ?? process.env.CLAUDE_PLUGIN_OPTION_TIMEOUT;
    const kiroArgs = buildKiroArgs({
      prompt,
      model,
      effort,
      kiroAgent: parsed.kiroAgent,
      trustTools: parsed.trustTools,
      interactive: parsed.interactive,
      continueConversation: parsed.continueConversation,
      conversationId: parsed.conversationId,
      skipPermissions: parsed.skipPermissions,
    });
    logEvent("bridge.kiro.args.built", {
      args: summarizeKiroArgs(kiroArgs),
      timeout,
      readOnly: parsed.readOnly,
      cwd: spawnCwd,
    });

    if (parsed.printCommand) {
      printResolvedCommands(kiroArgs, _stdout);
      logEvent("bridge.print-command", { args: summarizeKiroArgs(kiroArgs) });
      return EXIT_SUCCESS;
    }

    const kiroExe = resolveKiroExe(_spawnSync);
    checkKiroConnectivity(kiroExe, _spawnSync);

    try {
      const ptyModule = _loadNodePty();

      if (parsed.interactive) {
        if (!ptyModule) {
          throw new Error(
            "--interactive requires PTY support (node-pty) which is not available in this environment.\n" +
              "Use the default headless mode (omit --interactive) or run Kiro directly in an interactive terminal.",
          );
        }
        if (!_isTTY) {
          logEvent("bridge.interactive.no-tty");
          _stderr.write(
            "Warning: --interactive is running without a terminal (no TTY detected). " +
              "Kiro may hang waiting for user input. " +
              "Use the default headless mode unless you have an interactive terminal attached.\n",
          );
        }
      }

      if (ptyModule) {
        const outputChunks = [];
        const ptyOutputStream = parsed.outputFile ? { write: () => {} } : _stdout;
        let ptyExitCode;
        try {
          ptyExitCode = await spawnViaConPty(
            kiroExe,
            kiroArgs,
            ptyModule,
            timeout ? parseTimeoutMs(timeout) : _conPtyTimeoutMs,
            ptyOutputStream,
            outputChunks,
            spawnCwd,
          );
        } catch (err) {
          if (err?.code === "ENOENT" || String(err).includes("not found")) {
            throw buildKiroMissingError();
          }
          throw err;
        }
        const fullOutput = outputChunks.join("");
        if (parsed.outputFile) {
          const resolvedOutputFile = path.resolve(parsed.outputFile);
          await fsp.mkdir(path.dirname(resolvedOutputFile), { recursive: true });
          await fsp.writeFile(resolvedOutputFile, fullOutput, "utf8");
          logEvent("bridge.output.file", { path: resolvedOutputFile, bytes: fullOutput.length });
          _stdout.write(resolvedOutputFile + "\n");
        }
        const sig = classifyKiroOutput(fullOutput);
        if (sig) {
          emitStructuredSignal(sig.type, sig.reason, model, _stdout);
          logEvent("bridge.classified", { type: sig.type, reason: sig.reason, model, exitCode: sig.exitCode });
          return sig.exitCode;
        }
        return ptyExitCode;
      }

      logEvent("kiro.spawnsync.start", { kiroExe, args: summarizeKiroArgs(kiroArgs), cwd: spawnCwd });
      const result = _spawnSync(kiroExe, kiroArgs, {
        stdio: "pipe",
        encoding: "utf8",
        cwd: spawnCwd,
      });
      if (result.error) {
        logEvent("kiro.spawnsync.error", {
          code: result.error.code,
          message: result.error.message,
        });
        if (result.error.code === "ENOENT") {
          throw buildKiroMissingError();
        }
        throw result.error;
      }
      const capturedOutput = stripAnsi((result.stdout ?? "") + (result.stderr ?? ""));
      if (parsed.outputFile) {
        const resolvedOutputFile = path.resolve(parsed.outputFile);
        await fsp.mkdir(path.dirname(resolvedOutputFile), { recursive: true });
        await fsp.writeFile(resolvedOutputFile, capturedOutput, "utf8");
        logEvent("bridge.output.file", { path: resolvedOutputFile, bytes: capturedOutput.length });
        _stdout.write(resolvedOutputFile + "\n");
      } else {
        if (result.stdout) _stdout.write(stripAnsi(result.stdout));
        if (result.stderr) _stderr.write(stripAnsi(result.stderr));
      }
      const sig = classifyKiroOutput(capturedOutput);
      if (sig) {
        emitStructuredSignal(sig.type, sig.reason, model, _stdout);
        logEvent("bridge.classified", { type: sig.type, reason: sig.reason, model, exitCode: sig.exitCode });
        return sig.exitCode;
      }
      logEvent("kiro.spawnsync.exit", { status: result.status ?? 1 });
      return result.status ?? EXIT_ERROR;
    } finally {
      // no provider-level settings patching is needed for Kiro
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent("bridge.error", { message });
    const logPath = process.env.CC_KIRO_LOG_PATH || process.env.CC_ANTIGRAVITY_LOG_PATH || resolveDefaultLogPath();
    _stderr.write(`${message}\nPlugin log: ${logPath}\n`);
    if (error?.code === "ETIMEDOUT") return EXIT_TIMEOUT;
    if (error?.code === "EKIROMISSING") return EXIT_KIRO_MISSING;
    return EXIT_ERROR;
  }
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const exitCode = await main();
  process.exit(exitCode);
}
