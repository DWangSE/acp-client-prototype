#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import { AcpClientBuilder, ADAPTER_REGISTRY, ClientMethodHandler } from "../src/index.js";

const DEFAULT_PROMPT = "Say 'Hello World' and briefly introduce yourself.";

class CustomHandler implements ClientMethodHandler {
  async handle(method: string, params: any): Promise<any> {
    if (method === "custom/greet") {
      return { greeting: `Hello ${params.name || "friend"}, styled with ${params.style || "classic"}!` };
    }
    throw new Error(`Method not handled: ${method}`);
  }
}

function printUsage(): void {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     Universal ACP Client Test Runner — V3                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Adapters available:");
  for (const adapter of ADAPTER_REGISTRY.listAdapters()) {
    console.log(`  - ${adapter.agentId.padEnd(12)} (${adapter.name}) [${adapter.connectionType}]`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    return;
  }

  const agentId = args[0];
  const isLoginOnly = args[1] === "/login";
  const prompt = isLoginOnly ? "" : (args.slice(1).join(" ") || DEFAULT_PROMPT);
  const verbose = process.env.VERBOSE === "1";

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     Universal ACP Client (Separated Test Layer)                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`Agent: ${agentId}`);
  console.log(`Prompt: "${prompt}"`);
  console.log();

  // 1. Create client instance via Builder
  const builder = new AcpClientBuilder()
    .withAgent(agentId)
    .withVerbose(verbose)
    .withAutoApprove(process.env.AUTO_APPROVE === "1")
    .withSandboxDir(process.cwd())
    .withExtensionConfig("extensions.yaml")
    .registerExtensionHandler("custom/greet", new CustomHandler());

  const client = builder.build();

  // 2. Track Client States via exposed event emitter
  client.on("stateChange", (newState, oldState) => {
    console.log(`[Test:StateChange] Client state transitioned: ${oldState} -> ${newState}`);
  });

  // 3. Connect to specific I/O output streams
  client.on("agent_message_chunk", (payload) => {
    process.stdout.write(payload.update.content.text);
  });

  client.on("agent_thought_chunk", (payload) => {
    if (verbose) {
      process.stderr.write(`\n[Thought] ${payload.update.content.text}\n`);
    }
  });

  client.on("tool_call", (payload) => {
    console.log(`\n[Tool] Executing tool: ${payload.update.title}`);
  });

  try {
    console.log("[1/4] Initializing...");
    const initResult = await client.initialize({
      experimental: {
        echo: true,
        status: true
      }
    });
    console.log(`      ✓ Protocol v${initResult.protocolVersion}`);
    console.log(`      ✓ ${initResult.agentInfo?.name} v${initResult.agentInfo?.version}`);

    if (isLoginOnly) {
      console.log("[2/4] Performing login only...");
      await client.authenticate();
      console.log(`      ✓ Login process completed`);
      await client.shutdown();
      return;
    }

    console.log("[2/4] Authenticating...");
    await client.authenticate();
    console.log(`      ✓ Authenticated`);

    console.log("[3/4] Creating session...");
    const session = await client.createSession(process.cwd());
    console.log(`      ✓ Session: ${session.sessionId}`);

    console.log("[4/4] Sending prompt...\n");
    console.log("══════════════════════════════════════════════════════════════");
    console.log("Agent Response (Streamed via Client Event Emitter):");
    console.log("══════════════════════════════════════════════════════════════");

    // Send the prompt instruction
    const turn = await client.sendPrompt(prompt);

    // Consume the turn to keep the event loop alive and get final results
    for await (const event of turn) {
      // Event chunk handling is already taken care of by the client.on listeners above!
    }

    const result = await turn.result;
    console.log();
    console.log("══════════════════════════════════════════════════════════════");
    console.log(`Turn complete. Stop reason: ${result?.stopReason || "done"}`);

    await client.shutdown();
  } catch (error) {
    console.error("\n[Test:Error]:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    try { await client.shutdown(); } catch { /* ignore */ }
  }
}

main();
