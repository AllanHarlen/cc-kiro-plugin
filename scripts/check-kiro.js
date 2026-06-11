#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { logEvent } from "./utils.js";

const isWin = process.platform === "win32";
const whichCmd = isWin ? "where" : "which";

const whichResult = spawnSync(whichCmd, ["kiro-cli"], { encoding: "utf8", shell: false });
const kiroPath = whichResult.stdout.trim().split(/\r?\n/)[0].trim();
const installed = whichResult.status === 0 && kiroPath;

if (!installed) {
  logEvent("kiro.check.not_found");
  process.stderr.write(
    "Warning: Kiro CLI (kiro-cli) was not found on PATH. " +
      "Install and authenticate it before using cc-kiro-plugin.\n",
  );
  process.exit(0);
}

const versionResult = spawnSync(kiroPath, ["--version"], {
  encoding: "utf8",
  shell: false,
  timeout: 5_000,
});

const version = versionResult.stdout?.trim() || versionResult.stderr?.trim() || "(unknown)";
const versionOk = versionResult.status === 0;

if (!versionOk) {
  logEvent("kiro.check.version_failed", {
    kiroPath,
    exitCode: versionResult.status,
    stderr: versionResult.stderr?.trim(),
  });
  process.stderr.write(
    `Warning: Kiro CLI found at ${kiroPath} but did not respond to --version ` +
      `(exit code ${versionResult.status}). ` +
      "It may not be properly installed. Try `kiro-cli doctor` or reinstall Kiro CLI.\n",
  );
  process.exit(0);
}

logEvent("kiro.check.ok", { kiroPath, version });
