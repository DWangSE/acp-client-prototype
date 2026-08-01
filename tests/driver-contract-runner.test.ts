import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

test("driver contract runner maps stdin DriverPrompt to stdout DriverRunResult JSON", () => {
  const prompt = {
    task_id: "task-contract-smoke",
    run_id: "run-contract-smoke",
    prompt: "Say hello from the driver contract smoke test.",
    created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    schema_version: "v0",
  };

  const result = spawnSync("node", [join(process.cwd(), "dist/src/driver/contract-runner.js")], {
    cwd: process.cwd(),
    input: JSON.stringify(prompt),
    encoding: "utf8",
    env: {
      ...process.env,
      ACP_AGENT_ID: "mock-driver",
      ACP_WORKSPACE: process.cwd(),
      AUTO_APPROVE: "1",
      VERBOSE: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout));

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "succeeded");
  assert.equal(parsed.session_id, "mock-session-id");
  assert.equal(parsed.schema_version, "v0");
  assert.equal(parsed.diagnostics.driver_id, "mock-driver");
  assert.ok(parsed.driver_run_result_id);
  assert.ok(parsed.transcript_ref);
  assert.ok(Array.isArray(parsed.artifacts));
  assert.ok(Array.isArray(parsed.tool_events));
});
test("driver contract runner loads an existing session and returns response and artifact content", () => {
  const prompt = {
    task_id: "task-contract-session",
    run_id: "run-contract-session",
    session_id: "existing-session-id",
    workspace_path: process.cwd(),
    prompt: "Continue session and update the generated file.",
    created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    schema_version: "v0",
  };

  const result = spawnSync("node", [join(process.cwd(), "dist/src/driver/contract-runner.js")], {
    cwd: process.cwd(),
    input: JSON.stringify(prompt),
    encoding: "utf8",
    env: {
      ...process.env,
      ACP_AGENT_ID: "mock-driver",
      ACP_WORKSPACE: process.cwd(),
      AUTO_APPROVE: "1",
      VERBOSE: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.session_id, "existing-session-id");
  assert.match(parsed.response, /continued existing-session-id/i);
  assert.equal(parsed.artifacts.length, 1);
  assert.equal(parsed.artifacts[0].content.kind, "text");
  assert.equal(parsed.artifacts[0].content.target_path, join("generated", "session.txt"));
  assert.match(parsed.artifacts[0].content.content_ref, /^data:text\/plain/);
});

test("driver contract runner emits ACP events on the reserved audit channel", () => {
  const prompt = {
    task_id: "task-contract-events",
    run_id: "run-contract-events",
    prompt: "Emit a streamed message before the final result.",
    created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    schema_version: "v0",
  };

  const result = spawnSync("node", [join(process.cwd(), "dist/src/driver/contract-runner.js")], {
    cwd: process.cwd(),
    input: JSON.stringify(prompt),
    encoding: "utf8",
    env: {
      ...process.env,
      ACP_AGENT_ID: "mock-driver",
      ACP_WORKSPACE: process.cwd(),
      AUTO_APPROVE: "1",
      VERBOSE: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const eventLines = result.stderr
    .split(/\r?\n/)
    .filter((line) => line.startsWith("NEWIDE_DRIVER_EVENT "));
  assert.ok(eventLines.length > 0, result.stderr);
  const firstEvent = JSON.parse(eventLines[0].slice("NEWIDE_DRIVER_EVENT ".length));
  assert.equal(firstEvent.schema_version, "driver-event.v1");
  assert.equal(firstEvent.task_id, prompt.task_id);
  assert.equal(firstEvent.run_id, prompt.run_id);
  assert.ok(firstEvent.event_type);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
});

test("driver contract runner rejects non-array mcp_servers", () => {
  const prompt = {
    task_id: "task-contract-mcp-bad",
    run_id: "run-contract-mcp-bad",
    prompt: "Say hello.",
    mcp_servers: "not-an-array",
    created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    schema_version: "v0",
  };

  const result = spawnSync("node", [join(process.cwd(), "dist/src/driver/contract-runner.js")], {
    cwd: process.cwd(),
    input: JSON.stringify(prompt),
    encoding: "utf8",
    env: {
      ...process.env,
      ACP_AGENT_ID: "mock-driver",
      ACP_WORKSPACE: process.cwd(),
      AUTO_APPROVE: "1",
      VERBOSE: "0",
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mcp_servers must be an array/i);
});

test("driver contract runner accepts valid mcp_servers array", () => {
  const prompt = {
    task_id: "task-contract-mcp-ok",
    run_id: "run-contract-mcp-ok",
    prompt: "Say hello.",
    mcp_servers: [
      { name: "test-server", command: "node", args: ["-e", "console.log(1)"], env: [] },
    ],
    created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    schema_version: "v0",
  };

  const result = spawnSync("node", [join(process.cwd(), "dist/src/driver/contract-runner.js")], {
    cwd: process.cwd(),
    input: JSON.stringify(prompt),
    encoding: "utf8",
    env: {
      ...process.env,
      ACP_AGENT_ID: "mock-driver",
      ACP_WORKSPACE: process.cwd(),
      AUTO_APPROVE: "1",
      VERBOSE: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "succeeded");
});
