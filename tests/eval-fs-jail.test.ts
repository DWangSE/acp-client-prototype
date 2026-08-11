import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import {
  assertProcessSandboxAvailable,
  buildProcessSandboxArgs,
  processSandboxEnabled,
  resolveBwrapPath,
  wrapSpawnForProcessSandbox,
} from "../src/security/eval-fs-jail.js";

let root = "";
let workspace = "";
let sibling = "";
let outsideCache = "";
let outsideData = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "acp-eval-fs-jail-"));
  workspace = path.join(root, "workspace");
  sibling = path.join(root, "sibling-solved");
  outsideCache = path.join(root, "outside-cache", "objects");
  outsideData = path.join(root, "outside-data", "private.jsonl");
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.join(workspace, ".claude"), { recursive: true });
  await fs.mkdir(path.join(workspace, ".git"), { recursive: true });
  await fs.mkdir(sibling, { recursive: true });
  await fs.mkdir(path.dirname(outsideCache), { recursive: true });
  await fs.mkdir(path.dirname(outsideData), { recursive: true });
  await fs.writeFile(path.join(workspace, "in-workspace.txt"), "workspace-ok\n");
  await fs.writeFile(path.join(workspace, ".claude", "settings.json"), "{}\n");
  await fs.writeFile(path.join(workspace, ".git", "config"), "[core]\n");
  await fs.writeFile(path.join(sibling, "secret-fix.txt"), "LEAK\n");
  await fs.writeFile(outsideCache, "private-cache\n");
  await fs.writeFile(outsideData, JSON.stringify({ secret: "PRIVATE" }) + "\n");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("processSandboxEnabled reads ACP_PROCESS_SANDBOX", () => {
  const previous = process.env.ACP_PROCESS_SANDBOX;
  try {
    process.env.ACP_PROCESS_SANDBOX = "1";
    assert.equal(processSandboxEnabled(), true);
    process.env.ACP_PROCESS_SANDBOX = "0";
    assert.equal(processSandboxEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.ACP_PROCESS_SANDBOX;
    else process.env.ACP_PROCESS_SANDBOX = previous;
  }
});

test("process sandbox can read workspace but not unmounted host paths", () => {
  const previousReadOnly = process.env.ACP_PROCESS_SANDBOX_RO_PATHS_JSON;
  process.env.ACP_PROCESS_SANDBOX_RO_PATHS_JSON = JSON.stringify([
    ".claude/settings.json",
    ".git/config",
  ]);
  assertProcessSandboxAvailable(workspace);
  const bwrap = resolveBwrapPath();
  const jailed = wrapSpawnForProcessSandbox({
    command: process.execPath,
    args: [
      "-e",
      `
const fs = require("fs");
const assert = require("assert");
assert.equal(fs.readFileSync(${JSON.stringify(path.join(workspace, "in-workspace.txt"))}, "utf8").trim(), "workspace-ok");
for (const p of ${JSON.stringify([
        path.join(workspace, ".claude", "settings.json"),
        path.join(workspace, ".git", "config"),
      ])}) {
  assert.throws(() => fs.writeFileSync(p, "tampered"));
}
for (const p of ${JSON.stringify([sibling, outsideCache, outsideData])}) {
  let saw = false;
  try { fs.accessSync(p); saw = true; } catch {}
  assert.equal(saw, false, "should not see " + p);
}
// Parent dirs may exist as empty mount scaffolding; secrets under them must not.
console.log("jail-ok");
`,
    ],
    jailRoot: workspace,
    env: {},
  });

  assert.equal(jailed.command, bwrap);
  assert.ok(jailed.args.includes(workspace));

  const result = spawnSync(jailed.command, jailed.args, {
    encoding: "utf8",
    env: { ...process.env, ...jailed.env },
  });
  assert.equal(result.status, 0, `stderr=${result.stderr}\nstdout=${result.stdout}`);
  assert.match(result.stdout, /jail-ok/);
  if (previousReadOnly === undefined) delete process.env.ACP_PROCESS_SANDBOX_RO_PATHS_JSON;
  else process.env.ACP_PROCESS_SANDBOX_RO_PATHS_JSON = previousReadOnly;
});

test("buildProcessSandboxArgs binds only the configured workspace", () => {
  const args = buildProcessSandboxArgs(workspace);
  const bindIdx = args.lastIndexOf("--bind");
  assert.notEqual(bindIdx, -1);
  assert.equal(args[bindIdx + 1], workspace);
  assert.equal(args[bindIdx + 2], workspace);
  assert.ok(!args.includes(sibling));
  assert.ok(!args.includes(outsideCache));
});
