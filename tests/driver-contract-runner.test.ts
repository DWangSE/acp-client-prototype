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
