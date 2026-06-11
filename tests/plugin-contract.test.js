import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function read(path) {
  return fs.readFile(path, "utf8");
}

test("kiro-agent is read-only and cannot use broad Bash", async () => {
  const agent = await read("agents/kiro-agent.md");

  assert.match(agent, /description:[\s\S]*read-only/i);
  assert.match(agent, /tools:\s*\["Bash\(node \*kiro-bridge\.js\* --read-only\*\)", "Glob", "Read"\]/);
  assert.doesNotMatch(agent, /tools:\s*\[[^\]]*"Bash"/, "agent must not expose broad Bash");
  assert.match(agent, /Do not use this agent for tasks that create, edit, delete, move, or format/i);
  assert.match(agent, /Skill\("cc-kiro-plugin:kiro"/);
});

test("kiro-coder is agentic and still restricted to the bridge", async () => {
  const agent = await read("agents/kiro-coder.md");

  assert.match(agent, /name: kiro-coder/);
  assert.match(agent, /tools:\s*\["Bash\(node \*kiro-bridge\.js\*\)", "Glob", "Read"\]/);
  assert.match(agent, /--model <name>|--model/);
  assert.match(agent, /--list-models/);
  assert.doesNotMatch(agent, /tools:\s*\[[^\]]*"Bash"/, "agent must not expose broad Bash");
});

test("coding entry points restrict Bash to the bridge", async () => {
  const command = await read("commands/kiro.md");
  const skill = await read("skills/SKILL.md");

  for (const source of [command, skill]) {
    assert.match(source, /allowed-tools: Bash\(node \*kiro-bridge\.js\*\), Glob, Read/);
    assert.doesNotMatch(source, /allowed-tools: Bash, Glob, Read/);
  }
});

test("plugin manifest exposes Kiro command, agent, and external tool", async () => {
  const manifest = JSON.parse(await read(".claude-plugin/plugin.json"));

  assert.equal(manifest.name, "cc-kiro-plugin");
  assert.deepEqual(manifest.commands, ["./commands/kiro.md"]);
  assert.deepEqual(manifest.agents, ["./agents/kiro-coder.md", "./agents/kiro-agent.md"]);
  assert.equal(manifest.requiresExternalTool.name, "kiro-cli");
});

test("marketplace exposes Kiro metadata", async () => {
  const marketplace = JSON.parse(await read(".claude-plugin/marketplace.json"));
  assert.equal(marketplace.name, "cc-kiro-plugin");
  assert.equal(marketplace.plugins[0].requiresExternalTool.name, "kiro-cli");
  assert.match(marketplace.plugins[0].description, /model/i);
});

test("hook checks Kiro CLI on session start", async () => {
  const hooks = await read("hooks/hooks.json");
  assert.match(hooks, /check-kiro\.js/);
});
