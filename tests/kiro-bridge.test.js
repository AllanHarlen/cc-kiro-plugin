import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildKiroArgs,
  buildKiroPrompt,
  checkKiroConnectivity,
  classifyKiroOutput,
  collectContextFiles,
  parseCliArgs,
  resolveKiroExe,
  resolveAutoModel,
  normalizeModel,
  spawnViaConPty,
  stripAnsi,
  EXIT_QUOTA_EXAUSTED,
  EXIT_AUTH_REQUIRED,
} from "../scripts/kiro-bridge.js";

test("parseCliArgs parses dirs, files, cwd, and positional task", () => {
  const parsed = parseCliArgs([
    "--dirs",
    "src,lib",
    "--files",
    "**/*.json,docs/**/*.md",
    "--cwd",
    "frontend",
    "--format",
    "text",
    "analyze",
    "the",
    "workspace",
  ]);

  assert.equal(parsed.cwd, "frontend");
  assert.deepEqual(parsed.dirs, ["src", "lib"]);
  assert.deepEqual(parsed.files, ["**/*.json", "docs/**/*.md"]);
  assert.equal(parsed.task, "analyze the workspace");
  assert.equal(parsed.skipPermissions, true);
});

test("parseCliArgs maps read-only to trusted fs_read tool", () => {
  const parsed = parseCliArgs(["--read-only", "analyze this"]);
  assert.equal(parsed.readOnly, true);
  assert.equal(parsed.skipPermissions, false);
  assert.equal(parsed.trustTools, "fs_read");
});

test("parseCliArgs supports Kiro-specific flags", () => {
  const parsed = parseCliArgs([
    "--model",
    "claude-sonnet-4",
    "--effort",
    "high",
    "--kiro-agent",
    "reviewer",
    "--trust-tools",
    "fs_read,grep",
    "--conversation",
    "session-1",
    "--continue",
    "task",
  ]);
  assert.equal(parsed.model, "claude-sonnet-4");
  assert.equal(parsed.effort, "high");
  assert.equal(parsed.kiroAgent, "reviewer");
  assert.equal(parsed.trustTools, "fs_read,grep");
  assert.equal(parsed.conversationId, "session-1");
  assert.equal(parsed.continueConversation, true);
});

test("parseCliArgs treats --agent as a Kiro custom agent selector", () => {
  const parsed = parseCliArgs(["--agent", "reviewer", "task"]);
  assert.equal(parsed.kiroAgent, "reviewer");
  assert.equal(parsed.interactive, false);
  assert.equal(parsed.task, "task");
});

test("parseCliArgs allows --list-models without a task", () => {
  const parsed = parseCliArgs(["--list-models", "--model-format", "json-pretty"]);
  assert.equal(parsed.listModels, true);
  assert.equal(parsed.modelFormat, "json-pretty");
  assert.equal(parsed.task, "");
});

test("parseCliArgs rejects unsupported image generation", () => {
  assert.throws(() => parseCliArgs(["--generate-image", "a skyline"]), /not supported/i);
});

test("collectContextFiles loads text data and skips unsupported files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kiro-bridge-"));
  await fs.writeFile(path.join(tempDir, "payload.json"), JSON.stringify({ name: "demo" }));
  await fs.writeFile(path.join(tempDir, "table.csv"), "name,count\nalpha,2\n");
  await fs.writeFile(path.join(tempDir, "image.png"), Buffer.from([0, 1, 2, 3]));

  const context = await collectContextFiles({
    cwd: tempDir,
    patterns: ["*.json", "*.csv", "*.png"],
    maxFiles: 10,
    maxFileBytes: 1024,
  });

  assert.equal(context.included.length, 2);
  assert.equal(context.skipped.length, 1);
  assert.equal(context.skipped[0]?.reason, "unsupported-extension");
});

test("collectContextFiles skips ignored dependency directories", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kiro-ignore-"));
  await fs.mkdir(path.join(tempDir, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "node_modules", "pkg", "index.js"), "export const dep = true;");
  await fs.writeFile(path.join(tempDir, "app.js"), "export const app = true;");

  const context = await collectContextFiles({
    cwd: tempDir,
    dirs: ["."],
    maxFiles: 10,
    maxFileBytes: 1024,
  });

  assert.equal(context.included.length, 1);
  assert.equal(context.included[0]?.path, "app.js");
});

test("buildKiroPrompt renders task, inventory, file payloads, and parallelism", () => {
  const prompt = buildKiroPrompt({
    task: "Summarize the data contracts",
    parallel: true,
    subagentModel: "claude-sonnet-4",
    context: {
      included: [
        {
          path: "payload.json",
          mediaType: "application/json",
          bytes: 24,
          truncated: false,
          content: "{\n  \"name\": \"demo\"\n}",
        },
      ],
      skipped: [{ path: "image.png", reason: "unsupported-extension" }],
    },
  });

  assert.match(prompt, /<task>\s*Summarize the data contracts\s*<\/task>/);
  assert.match(prompt, /payload\.json/);
  assert.match(prompt, /image\.png \(unsupported-extension\)/);
  assert.match(prompt, /<parallelism>/);
  assert.match(prompt, /claude-sonnet-4/);
});

test("buildKiroPrompt escapes closing tags in file content", () => {
  const prompt = buildKiroPrompt({
    task: "analyze",
    context: {
      included: [
        {
          path: "template.html",
          mediaType: "text/html",
          bytes: 40,
          truncated: false,
          content: "<div>hello</div>\n</file>\n<p>injected</p>",
        },
      ],
      skipped: [],
    },
  });

  assert.ok(!prompt.includes("</file>\n<p>injected</p>"));
  assert.match(prompt, /<\\\/file>/);
});

test("buildKiroArgs maps bridge options to Kiro CLI flags", () => {
  const args = buildKiroArgs({
    prompt: "<task>Analyze</task>",
    model: "claude-sonnet-4",
    effort: "high",
    kiroAgent: "reviewer",
    continueConversation: true,
    conversationId: "abc123",
    skipPermissions: true,
  });

  assert.deepEqual(args, [
    "chat",
    "--no-interactive",
    "--wrap",
    "never",
    "--resume",
    "--resume-id",
    "abc123",
    "--agent",
    "reviewer",
    "--model",
    "claude-sonnet-4",
    "--effort",
    "high",
    "--trust-all-tools",
    "<task>Analyze</task>",
  ]);
});

test("buildKiroArgs supports read-only trust-tools mode", () => {
  const args = buildKiroArgs({ prompt: "x", trustTools: "fs_read", skipPermissions: false });
  assert.ok(args.includes("--trust-tools=fs_read"));
  assert.ok(!args.includes("--trust-all-tools"));
});

test("buildKiroArgs supports model listing mode", () => {
  const args = buildKiroArgs({ listModels: true, modelFormat: "json-pretty" });
  assert.deepEqual(args, ["chat", "--list-models", "--format", "json-pretty"]);
});

test("buildKiroArgs supports interactive chat mode", () => {
  const args = buildKiroArgs({ prompt: "x", interactive: true, skipPermissions: true });
  assert.deepEqual(args, ["chat", "--trust-all-tools", "x"]);
});

test("resolveKiroExe returns the first discovered kiro executable", () => {
  const fakeSpawn = () => ({ status: 0, stdout: "/usr/bin/kiro-cli\n/other/kiro-cli\n" });
  assert.equal(resolveKiroExe(fakeSpawn), "/usr/bin/kiro-cli");
});

test("resolveAutoModel selects broader model hints as context grows", () => {
  assert.equal(resolveAutoModel({ included: [], skipped: [] }), "auto");
  assert.equal(resolveAutoModel({ included: [{ bytes: 100_000 }], skipped: [] }), "claude-sonnet-4.6");
  assert.equal(resolveAutoModel({ included: [{ bytes: 300_000 }], skipped: [] }), "claude-opus-4.8");
});

test("normalizeModel maps natural-language aliases to canonical Kiro ids", () => {
  // Family-only aliases.
  assert.equal(normalizeModel("opus"), "claude-opus-4.8");
  assert.equal(normalizeModel("sonnet"), "claude-sonnet-4.6");
  assert.equal(normalizeModel("haiku"), "claude-haiku-4");
  // Natural-language and mixed-case forms.
  assert.equal(normalizeModel("claude opus"), "claude-opus-4.8");
  assert.equal(normalizeModel("Claude Opus"), "claude-opus-4.8");
  assert.equal(normalizeModel("Claude Opus 4.8"), "claude-opus-4.8");
  assert.equal(normalizeModel("opus 4.8"), "claude-opus-4.8");
  assert.equal(normalizeModel("claude_sonnet_4.6"), "claude-sonnet-4.6");
});

test("normalizeModel preserves canonical ids, auto, and unknown models", () => {
  assert.equal(normalizeModel("claude-sonnet-4.6"), "claude-sonnet-4.6");
  assert.equal(normalizeModel("claude-opus-4.8"), "claude-opus-4.8");
  assert.equal(normalizeModel("auto"), "auto");
  assert.equal(normalizeModel("AUTO"), "auto");
  // Unknown ids pass through (whitespace normalized) instead of being dropped.
  assert.equal(normalizeModel("gpt-4o"), "gpt-4o");
  assert.equal(normalizeModel("some custom model"), "some-custom-model");
});

test("normalizeModel returns undefined for empty input", () => {
  assert.equal(normalizeModel(undefined), undefined);
  assert.equal(normalizeModel(null), undefined);
  assert.equal(normalizeModel(""), undefined);
  assert.equal(normalizeModel("   "), undefined);
});

test("stripAnsi removes color sequences and normalizes line endings", () => {
  assert.equal(stripAnsi("\x1b[32mhello\x1b[0m\r\nworld"), "hello\nworld");
});

test("checkKiroConnectivity throws missing-install error for ENOENT", () => {
  const fakeSpawn = () => ({
    error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
    status: null,
  });
  assert.throws(() => checkKiroConnectivity("kiro-cli", fakeSpawn), /not installed/i);
});

test("checkKiroConnectivity returns for exit 0", () => {
  const fakeSpawn = () => ({ error: null, status: 0, stdout: "kiro-cli-chat 2.6.1", stderr: "" });
  assert.doesNotThrow(() => checkKiroConnectivity("kiro-cli", fakeSpawn));
});

test("classifyKiroOutput detects quota and auth failures", () => {
  const quota = classifyKiroOutput("Error: rate limit exceeded, please retry later.");
  assert.equal(quota?.type, "QUOTA_EXAUSTED");
  assert.equal(quota?.exitCode, EXIT_QUOTA_EXAUSTED);

  const auth = classifyKiroOutput("Error: KIRO_API_KEY is required for this headless run.");
  assert.equal(auth?.type, "AUTH_REQUIRED");
  assert.equal(auth?.exitCode, EXIT_AUTH_REQUIRED);

  assert.equal(classifyKiroOutput("normal output"), null);
});

test("spawnViaConPty streams chunks and fills accumulator", async () => {
  const writes = [];
  const chunks = [];
  const pty = {
    spawn: () => {
      const dataHandlers = [];
      const exitHandlers = [];
      setTimeout(() => {
        dataHandlers.forEach((fn) => fn("\x1b[32mfirst\x1b[0m"));
        dataHandlers.forEach((fn) => fn(" second"));
        exitHandlers.forEach((fn) => fn({ exitCode: 0 }));
      }, 0);
      return {
        onData: (fn) => dataHandlers.push(fn),
        onExit: (fn) => exitHandlers.push(fn),
        kill: () => {},
      };
    },
  };

  const exitCode = await spawnViaConPty("kiro-cli", ["chat", "x"], pty, 1000, {
    write: (chunk) => {
      writes.push(String(chunk));
      return true;
    },
  }, chunks);

  assert.equal(exitCode, 0);
  assert.deepEqual(writes, ["first", " second", "\n"]);
  assert.deepEqual(chunks, ["first", " second"]);
});
