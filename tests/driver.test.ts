import { MockDriver, DriverPrompt } from "../src/index.js";

async function runTests() {
  console.log("==================================================");
  console.log("Testing MockDriver & Direction C RFC Contracts...");
  console.log("==================================================");

  const driver = new MockDriver();

  // 1. Test uninitialized execute throws error
  try {
    await driver.sendPrompt({
      task_id: "task-1",
      run_id: "run-1",
      prompt: "Hello",
      created_at: new Date().toISOString(),
      schema_version: "v0",
    });
    console.error("FAIL: Executing uninitialized driver should have thrown an error!");
    process.exit(1);
  } catch (err: any) {
    console.log("SUCCESS: Uninitialized execute correctly threw error:", err.message);
  }

  // 2. Initialize
  await driver.initialize();
  console.log("SUCCESS: Driver initialized successfully.");

  // 3. Test SUCCESS execution (allow path)
  const successInput: DriverPrompt = {
    task_id: "task-001",
    run_id: "run-001",
    prompt: "Implement a secure endpoint for user authentication.",
    created_at: new Date().toISOString(),
    schema_version: "v0",
  };

  const successResult = await driver.sendPrompt(successInput);
  console.log("\nSuccess execution result status:", successResult.status);
  if (successResult.status === "succeeded") {
    console.log("SUCCESS: Received success status.");
    console.log(`SUCCESS: Created ${successResult.artifacts.length} artifacts.`);
    successResult.artifacts.forEach((art) => {
      console.log(`   Artifact ID: ${art.artifact_id}, Type: ${art.type}, URI: ${art.uri}`);
    });
    console.log(`SUCCESS: Created ${successResult.tool_events.length} tool events.`);
    successResult.tool_events.forEach((evt) => {
      console.log(`   Tool Event [${evt.status}] (${evt.tool_name}): ${evt.summary}`);
    });
  } else {
    console.error("FAIL: Expected success execution status but got:", successResult.status);
    process.exit(1);
  }

  // 4. Test FAILED execution (fail path)
  const failInput: DriverPrompt = {
    task_id: "task-002",
    run_id: "run-002",
    prompt: "Run compiling command. Should driver_fail.",
    created_at: new Date().toISOString(),
    schema_version: "v0",
  };

  const failResult = await driver.sendPrompt(failInput);
  console.log("\nFailed execution result status:", failResult.status);
  if (failResult.status === "failed") {
    console.log("SUCCESS: Received failed status.");
    console.log(`SUCCESS: Diagnostics notes length: ${failResult.diagnostics.notes.length}`);
    failResult.diagnostics.notes.forEach((note) => {
      console.log(`   Diagnostic Note: ${note}`);
    });
    console.log(`SUCCESS: Error state: ${JSON.stringify(failResult.error)}`);
  } else {
    console.error("FAIL: Expected failed execution status but got success.");
    process.exit(1);
  }

  // 5. Shutdown
  await driver.shutdown();
  console.log("\nSUCCESS: Driver shut down successfully.");
  console.log("==================================================");
  console.log("All MockDriver tests passed successfully!");
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
