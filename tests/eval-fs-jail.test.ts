import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import {
  assertProcessSandboxAvailable,
  buildProcessSandboxArgs,
  listHostOracleHideDirs,
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

test("process sandbox overlays jail home on /root for passwd-based Claude config", async () => {
  const previousHome = process.env.ACP_PROCESS_SANDBOX_HOME;
  const jailHome = path.join(root, "eval-claude-home");
  process.env.ACP_PROCESS_SANDBOX_HOME = jailHome;
  try {
    await fs.mkdir(path.join(jailHome, ".claude"), { recursive: true });
    await fs.writeFile(path.join(jailHome, ".claude", "settings.json"), "jail-settings\n");
    const args = buildProcessSandboxArgs(workspace);
    const homeIdx = args.indexOf("HOME");
    assert.notEqual(homeIdx, -1);
    assert.equal(args[homeIdx - 1], "--setenv");
    assert.equal(args[homeIdx + 1], "/root");
    const configIdx = args.indexOf("CLAUDE_CONFIG_DIR");
    assert.notEqual(configIdx, -1);
    assert.equal(args[configIdx + 1], "/root/.claude");
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--tmpfs") assert.notEqual(args[i + 1], "/root");
    }
    const rootBind = args.findIndex(
      (value, index) => value === "--bind" && args[index + 2] === "/root"
    );
    assert.notEqual(rootBind, -1);
    assert.equal(args[rootBind + 1], jailHome);

    const jailed = wrapSpawnForProcessSandbox({
      command: process.execPath,
      args: [
        "-e",
        `
const fs = require("fs");
const assert = require("assert");
assert.equal(process.env.HOME, "/root");
assert.equal(process.env.CLAUDE_CONFIG_DIR, "/root/.claude");
assert.equal(fs.readFileSync("/root/.claude/settings.json", "utf8").trim(), "jail-settings");
// bwrap runs without --clearenv, so provider env must be inherited.
assert.equal(process.env.ANTHROPIC_MODEL, "deepseek-v4-flash");
console.log("root-home-ok");
`,
      ],
      jailRoot: workspace,
      env: { ANTHROPIC_MODEL: "deepseek-v4-flash" },
    });
    const result = spawnSync(jailed.command, jailed.args, {
      encoding: "utf8",
      env: { ...process.env, ...jailed.env },
    });
    assert.equal(result.status, 0, `stderr=${result.stderr}\nstdout=${result.stdout}`);
    assert.match(result.stdout, /root-home-ok/);
  } finally {
    if (previousHome === undefined) delete process.env.ACP_PROCESS_SANDBOX_HOME;
    else process.env.ACP_PROCESS_SANDBOX_HOME = previousHome;
  }
});

test("offline eval jail uses default-deny DNS and ephemeral HOME", async () => {
  const previousDeny = process.env.ACP_DENY_NETWORK_TOOLS;
  const previousHome = process.env.ACP_PROCESS_SANDBOX_HOME;
  const previousApi = process.env.ANTHROPIC_BASE_URL;
  const jailHome = path.join(root, "eval-claude-home-offline");
  process.env.ACP_DENY_NETWORK_TOOLS = "1";
  process.env.ACP_PROCESS_SANDBOX_HOME = jailHome;
  process.env.ANTHROPIC_BASE_URL = "https://127.0.0.1/v1";
  try {
    await fs.mkdir(path.join(jailHome, ".claude"), { recursive: true });
    await fs.writeFile(path.join(jailHome, ".claude", "settings.json"), "jail-settings\n");
    const args = buildProcessSandboxArgs(workspace);
    assert.equal(args.includes("--share-net"), true);
    const pipIdx = args.indexOf("PIP_NO_INDEX");
    assert.notEqual(pipIdx, -1);
    assert.equal(args[pipIdx + 1], "1");
    assert.ok(args.includes("/etc/nsswitch.conf"));
    assert.equal(args.includes(jailHome), false);

    const jailed = wrapSpawnForProcessSandbox({
      command: "/usr/bin/python3",
      args: [
        "-c",
        `
import os, socket, pathlib
assert os.environ.get("PIP_NO_INDEX") == "1"
assert os.environ.get("HOME") == "/root"
assert pathlib.Path("/root/.claude/settings.json").read_text().strip() == "jail-settings"
pathlib.Path("/root/stolen.whl").write_text("gold")
for host in ("pypi.org", "files.pythonhosted.org", "github.com", "mirrors.aliyun.com", "huggingface.co"):
    failed = False
    try:
        socket.getaddrinfo(host, 443)
    except socket.gaierror:
        failed = True
    assert failed, host
socket.getaddrinfo("localhost", 80)
print("offline-index-ok")
`,
      ],
      jailRoot: workspace,
      env: {},
    });
    const result = spawnSync(jailed.command, jailed.args, {
      encoding: "utf8",
      env: { ...process.env, ...jailed.env },
    });
    assert.equal(result.status, 0, `stderr=${result.stderr}\nstdout=${result.stdout}`);
    assert.match(result.stdout, /offline-index-ok/);
    assert.equal(
      await fs.access(path.join(jailHome, "stolen.whl")).then(
        () => true,
        () => false
      ),
      false
    );
  } finally {
    if (previousDeny === undefined) delete process.env.ACP_DENY_NETWORK_TOOLS;
    else process.env.ACP_DENY_NETWORK_TOOLS = previousDeny;
    if (previousHome === undefined) delete process.env.ACP_PROCESS_SANDBOX_HOME;
    else process.env.ACP_PROCESS_SANDBOX_HOME = previousHome;
    if (previousApi === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previousApi;
  }
});

test("usr-merge /lib is a symlink mount, not a second bind of /usr/lib", () => {
  if (!existsSync("/lib") || !lstatSync("/lib").isSymbolicLink()) return;
  const target = readlinkSync("/lib");
  const args = buildProcessSandboxArgs(workspace);
  const symlinkIdx = args.findIndex(
    (value, index) =>
      value === "--symlink" && args[index + 1] === target && args[index + 2] === "/lib"
  );
  assert.notEqual(symlinkIdx, -1, `expected --symlink ${target} /lib in ${args.join(" ")}`);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--ro-bind" || args[i] === "--ro-bind-try") {
      assert.notEqual(args[i + 2], "/lib", "must not bind /lib as a second copy of /usr/lib");
    }
  }
});

test("hiding host packages covers /lib dist-packages alias and aegis oracle tree", () => {
  const previousHide = process.env.ACP_PROCESS_SANDBOX_HIDE_PYTHON_PACKAGES;
  const previousDeny = process.env.ACP_DENY_NETWORK_TOOLS;
  const previousApi = process.env.ANTHROPIC_BASE_URL;
  process.env.ACP_PROCESS_SANDBOX_HIDE_PYTHON_PACKAGES = "1";
  process.env.ACP_DENY_NETWORK_TOOLS = "1";
  process.env.ANTHROPIC_BASE_URL = "https://127.0.0.1/v1";
  try {
    const hidden = listHostOracleHideDirs();
    if (existsSync("/lib/python3/dist-packages")) {
      assert.ok(hidden.includes("/lib/python3/dist-packages"));
    }
    if (existsSync("/usr/lib/python3/dist-packages")) {
      assert.ok(hidden.includes("/usr/lib/python3/dist-packages"));
    }
    if (existsSync("/usr/local/aegis")) {
      assert.ok(hidden.includes("/usr/local/aegis"));
    }

    const args = buildProcessSandboxArgs(workspace);
    for (const dir of hidden) {
      let guest = dir;
      try {
        guest = realpathSync(dir);
      } catch {
        // keep lexical path
      }
      const tmpfsIdx = args.findIndex(
        (value, index) =>
          value === "--tmpfs" && (args[index + 1] === dir || args[index + 1] === guest)
      );
      assert.notEqual(tmpfsIdx, -1, `expected --tmpfs covering ${dir}`);
    }

    const probePaths = [
      "/lib/python3/dist-packages/requests/__init__.py",
      "/usr/lib/python3/dist-packages/requests/__init__.py",
      "/usr/local/aegis/PythonLoader/third_party/requests/__init__.py",
    ].filter((p) => existsSync(p));
    assert.ok(probePaths.length > 0, "host oracle files must exist for this assertion");

    const jailed = wrapSpawnForProcessSandbox({
      command: "/usr/bin/python3",
      args: [
        "-c",
        `
import os, sys
assert sys.version
for p in ${JSON.stringify(probePaths)}:
    assert not os.path.exists(p), p
print("oracle-hidden-ok")
`,
      ],
      jailRoot: workspace,
      env: {},
    });
    const result = spawnSync(jailed.command, jailed.args, {
      encoding: "utf8",
      env: { ...process.env, ...jailed.env },
    });
    assert.equal(result.status, 0, `stderr=${result.stderr}\nstdout=${result.stdout}`);
    assert.match(result.stdout, /oracle-hidden-ok/);
  } finally {
    if (previousHide === undefined) delete process.env.ACP_PROCESS_SANDBOX_HIDE_PYTHON_PACKAGES;
    else process.env.ACP_PROCESS_SANDBOX_HIDE_PYTHON_PACKAGES = previousHide;
    if (previousDeny === undefined) delete process.env.ACP_DENY_NETWORK_TOOLS;
    else process.env.ACP_DENY_NETWORK_TOOLS = previousDeny;
    if (previousApi === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previousApi;
  }
});
