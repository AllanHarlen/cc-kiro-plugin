import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  main,
  EXIT_SUCCESS,
  EXIT_QUOTA_EXAUSTED,
  EXIT_AUTH_REQUIRED,
  EXIT_TIMEOUT,
  EXIT_KIRO_MISSING,
  EXIT_ERROR,
} from "../scripts/kiro-bridge.js";

function makeStreams() {
  const outChunks = [];
  const errChunks = [];
  return {
    _stdout: { write: (s) => { outChunks.push(String(s)); return true; } },
    _stderr: { write: (s) => { errChunks.push(String(s)); return true; } },
    get stdout() { return outChunks.join(""); },
    get stderr() { return errChunks.join(""); },
  };
}

function fakePtyModule(opts = {}) {
  const exitCode = "exitCode" in opts ? opts.exitCode : 0;
  const { data = "", delayMs = 0, neverExit = false } = opts;
  return {
    spawn: (_exe, _args, _opts) => {
      const dataHandlers = [];
      const exitHandlers = [];
      const term = {
        onData: (fn) => { dataHandlers.push(fn); },
        onExit: (fn) => { exitHandlers.push(fn); },
        write: () => {},
        kill: () => {},
      };
      if (!neverExit) {
        setTimeout(() => {
          if (data) dataHandlers.forEach((fn) => fn(data));
          exitHandlers.forEach((fn) => fn({ exitCode }));
        }, delayMs);
      }
      return term;
    },
  };
}

function fakeSpawnSuccess(calls = []) {
  return (cmd, args = [], opts = {}) => {
    calls.push({ cmd, args, opts });
    if (cmd === "where" || cmd === "which") {
      return { status: 0, stdout: "kiro-cli\n" };
    }
    return { error: null, status: 0, stdout: "", stderr: "" };
  };
}

test("main --help prints usage and returns 0", async () => {
  const io = makeStreams();
  const result = await main(["--help"], io);
  assert.equal(result, EXIT_SUCCESS);
  assert.match(io.stdout, /Usage:/);
});

test("main with no task writes error to stderr and returns EXIT_ERROR", async () => {
  const io = makeStreams();
  const result = await main([], io);
  assert.equal(result, EXIT_ERROR);
  assert.match(io.stderr, /task is required/i);
});

test("main --print-command prints kiro-cli command", async () => {
  const io = makeStreams();
  const result = await main(["--print-command", "analyze this"], io);
  assert.equal(result, EXIT_SUCCESS);
  assert.match(io.stdout, /kiro-cli/);
  assert.match(io.stdout, /--no-interactive/);
  assert.match(io.stdout, /--trust-all-tools/);
});

test("main --list-models --print-command prints Kiro model listing command", async () => {
  const io = makeStreams();
  const result = await main(["--list-models", "--model-format", "json-pretty", "--print-command"], io);
  assert.equal(result, EXIT_SUCCESS);
  assert.match(io.stdout, /--list-models/);
  assert.match(io.stdout, /json-pretty/);
});

test("main --list-models runs without a task", async () => {
  const io = makeStreams();
  let callCount = 0;
  const result = await main(["--list-models"], {
    ...io,
    _spawnSync: (cmd, args = []) => {
      if (cmd === "where" || cmd === "which") return { status: 0, stdout: "kiro-cli\n" };
      callCount += 1;
      if (callCount === 1) return { error: null, status: 0, stdout: "kiro-cli-chat 2.6.1", stderr: "" };
      assert.deepEqual(args, ["chat", "--list-models", "--format", "json"]);
      return { error: null, status: 0, stdout: "[{\"id\":\"claude-sonnet-4\"}]", stderr: "" };
    },
    _loadNodePty: () => null,
  });
  assert.equal(result, EXIT_SUCCESS);
  assert.match(io.stdout, /claude-sonnet-4/);
});

test("main --read-only prints trust-tools instead of trust-all-tools", async () => {
  const io = makeStreams();
  const result = await main(["--read-only", "--print-command", "analyze this"], io);
  assert.equal(result, EXIT_SUCCESS);
  assert.match(io.stdout, /--trust-tools=fs_read/);
  assert.ok(!io.stdout.includes("--trust-all-tools"));
});

test("main --agent prints Kiro custom agent flag", async () => {
  const io = makeStreams();
  const result = await main(["--agent", "reviewer", "--print-command", "analyze this"], io);
  assert.equal(result, EXIT_SUCCESS);
  assert.match(io.stdout, /"--agent" "reviewer"/);
  assert.doesNotMatch(io.stderr, /interactive/i);
});

test("main spawnSync fallback: ENOENT writes install message and returns EXIT_KIRO_MISSING", async () => {
  const io = makeStreams();
  const fakeSpawn = () => ({
    error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
    status: null,
  });
  const result = await main(["analyze this"], {
    ...io,
    _spawnSync: fakeSpawn,
    _loadNodePty: () => null,
  });
  assert.equal(result, EXIT_KIRO_MISSING);
  assert.match(io.stderr, /Kiro CLI/i);
});

test("main spawnSync fallback calls kiro chat with expected flags and cwd", async () => {
  const io = makeStreams();
  const calls = [];
  const result = await main(["--cwd", ".", "--model", "claude-sonnet-4", "analyze this"], {
    ...io,
    _spawnSync: fakeSpawnSuccess(calls),
    _loadNodePty: () => null,
  });
  assert.equal(result, EXIT_SUCCESS);
  const taskArgs = calls[2]?.args ?? [];
  assert.deepEqual(taskArgs.slice(0, 4), ["chat", "--no-interactive", "--wrap", "never"]);
  assert.ok(taskArgs.includes("--model"));
  assert.ok(taskArgs.includes("--trust-all-tools"));
  assert.equal(path.resolve(calls[2]?.opts?.cwd), process.cwd());
});

test("main spawnSync fallback classifies auth output", async () => {
  const io = makeStreams();
  let callCount = 0;
  const result = await main(["analyze this"], {
    ...io,
    _spawnSync: (cmd) => {
      if (cmd === "where" || cmd === "which") return { status: 0, stdout: "kiro-cli\n" };
      callCount += 1;
      if (callCount === 1) return { error: null, status: 0, stdout: "kiro-cli-chat 2.6.1", stderr: "" };
      return { error: null, status: 1, stdout: "", stderr: "KIRO_API_KEY is required" };
    },
    _loadNodePty: () => null,
  });
  assert.equal(result, EXIT_AUTH_REQUIRED);
  assert.match(io.stdout, /AUTH_REQUIRED/);
});

test("main spawnSync fallback forwards captured stdout and stderr without output-file", async () => {
  const io = makeStreams();
  let callCount = 0;
  const result = await main(["analyze this"], {
    ...io,
    _spawnSync: (cmd) => {
      if (cmd === "where" || cmd === "which") return { status: 0, stdout: "kiro-cli\n" };
      callCount += 1;
      if (callCount === 1) return { error: null, status: 0, stdout: "kiro-cli-chat 2.6.1", stderr: "" };
      return { error: null, status: 0, stdout: "normal output\n", stderr: "warning output\n" };
    },
    _loadNodePty: () => null,
  });
  assert.equal(result, EXIT_SUCCESS);
  assert.match(io.stdout, /normal output/);
  assert.match(io.stderr, /warning output/);
});

test("main ConPTY: exitCode 0 resolves to 0 and writes output to stdout", async () => {
  const io = makeStreams();
  const calls = [];
  const result = await main(["analyze this"], {
    ...io,
    _spawnSync: fakeSpawnSuccess(calls),
    _loadNodePty: () => fakePtyModule({ exitCode: 0, data: "analysis result\n" }),
    _conPtyTimeoutMs: 5_000,
  });
  assert.equal(result, EXIT_SUCCESS);
  assert.match(io.stdout, /analysis result/);
});

test("main ConPTY: timeout returns EXIT_TIMEOUT", async () => {
  const io = makeStreams();
  const result = await main(["analyze this"], {
    ...io,
    _spawnSync: fakeSpawnSuccess(),
    _loadNodePty: () => fakePtyModule({ neverExit: true }),
    _conPtyTimeoutMs: 50,
  });
  assert.equal(result, EXIT_TIMEOUT);
  assert.match(io.stderr, /did not respond/i);
});

test("main ConPTY: quota output returns EXIT_QUOTA_EXAUSTED and emits JSON signal", async () => {
  const io = makeStreams();
  const result = await main(["analyze this"], {
    ...io,
    _spawnSync: fakeSpawnSuccess(),
    _loadNodePty: () => fakePtyModule({ exitCode: 1, data: "Error: rate limit exceeded. Retry later.\n" }),
    _conPtyTimeoutMs: 5_000,
  });
  assert.equal(result, EXIT_QUOTA_EXAUSTED);
  assert.match(io.stdout, /QUOTA_EXAUSTED/);
});

test("main --parallel without --output-file in non-TTY context writes temp output file", async () => {
  const io = makeStreams();
  const result = await main(["--parallel", "create two reports"], {
    ...io,
    _spawnSync: fakeSpawnSuccess(),
    _loadNodePty: () => fakePtyModule({ exitCode: 0, data: "Report A done.\nReport B done.\n" }),
    _isTTY: false,
    _conPtyTimeoutMs: 5_000,
  });

  assert.equal(result, EXIT_SUCCESS);
  const outputPath = io.stdout.trim().split("\n").at(-1);
  assert.ok(outputPath.includes("kiro-parallel-"));
  const content = await fs.readFile(outputPath, "utf8");
  assert.match(content, /Report/);
  await fs.unlink(outputPath).catch(() => {});
});

test("main --parallel with explicit --output-file does not auto-generate another path", async () => {
  const tmpFile = path.join(os.tmpdir(), `kiro-explicit-${Date.now()}.txt`);
  const io = makeStreams();

  await main(["--parallel", "--output-file", tmpFile, "create two reports"], {
    ...io,
    _spawnSync: fakeSpawnSuccess(),
    _loadNodePty: () => fakePtyModule({ exitCode: 0, data: "done\n" }),
    _isTTY: false,
    _conPtyTimeoutMs: 5_000,
  });

  assert.equal(io.stdout.trim(), tmpFile);
  await fs.unlink(tmpFile).catch(() => {});
});
