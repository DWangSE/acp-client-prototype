import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { FileSystemHandler } from "../src/client-methods/filesystem-handler.js";
import { TerminalHandler, createTerminalEnv } from "../src/client-methods/terminal-handler.js";

let root = "";
let workspace = "";
let sibling = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "acp-workspace-boundary-"));
  workspace = path.join(root, "project");
  sibling = path.join(root, "project-secrets");
  await fs.mkdir(workspace);
  await fs.mkdir(sibling);
  await fs.symlink(sibling, path.join(workspace, "escape-link"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("filesystem rejects sibling-prefix and symlink workspace escapes", async () => {
  const handler = new FileSystemHandler(workspace);

  await assert.rejects(
    handler.handle("fs/write_text_file", {
      path: path.join("..", path.basename(sibling), "outside.txt"),
      content: "blocked",
    }),
    /outside of workspace/
  );
  await assert.rejects(
    handler.handle("fs/write_text_file", {
      path: path.join("escape-link", "outside.txt"),
      content: "blocked",
    }),
    /outside of workspace/
  );
});

test("terminal rejects cwd outside workspace", async () => {
  const handler = new TerminalHandler(workspace);

  await assert.rejects(
    handler.handle("terminal/create", { command: "pwd", cwd: sibling }),
    /outside of workspace/
  );
});

test("terminal environment excludes provider credentials", () => {
  const env = createTerminalEnv({
    PATH: "/usr/bin",
    HOME: "/tmp/home",
    ANTHROPIC_API_KEY: "secret",
    OPENAI_API_KEY: "secret",
    CODEX_API_KEY: "secret",
  });

  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/tmp/home");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
});
