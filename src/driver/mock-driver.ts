import { SCHEMA_VERSION, createId, nowTimestamp, type ArtifactRef } from "../core/types.js";
import type {
  DriverCapabilities,
  DriverPrompt,
  DriverRunResult,
  DriverRuntimeHandle,
  DriverRunStatus,
} from "./interface.js";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

export class MockDriver implements DriverRuntimeHandle {
  readonly driver_id = "mock-driver";
  readonly session_id = "mock-session";
  readonly capabilities: DriverCapabilities = {
    supports_acp_extension: false,
    supports_structured_output: true,
    supports_session_load: false,
    supports_tool_events: true,
    supports_permission_events: false,
  };

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async sendPrompt(input: DriverPrompt): Promise<DriverRunResult> {
    if (!this.initialized) {
      throw new Error("Driver not initialized. Please call initialize() first.");
    }

    const created_at = nowTimestamp();

    // Determine success/failed status from prompt
    const isSuccess = !input.prompt.toLowerCase().includes("driver_fail");
    const status: DriverRunStatus = isSuccess ? "succeeded" : "failed";

    const patchArtifact: ArtifactRef = {
      artifact_id: createId("artifact"),
      type: "patch",
      uri: `artifact://patch/${input.task_id}/mock-driver.patch`,
      sha256: "mock-sha256",
      producer_id: this.driver_id,
      task_id: input.task_id,
      metadata: {
        prompt_length: input.prompt.length,
        context_pack_id: input.context_pack_ref?.context_pack_id,
      },
      created_at,
      schema_version: SCHEMA_VERSION,
    };

    const transcript = await this.collectTranscript(input.task_id);

    return {
      driver_run_result_id: createId("driver_result"),
      session_id: this.session_id,
      status,
      artifacts: [patchArtifact],
      transcript_ref: transcript,
      tool_events: [
        {
          tool_event_id: createId("tool_event"),
          tool_name: "mock.write_patch",
          status: "completed",
          summary: "MockDriver produced a deterministic patch artifact.",
          created_at,
          schema_version: SCHEMA_VERSION,
        },
      ],
      diagnostics: {
        driver_id: this.driver_id,
        duration_ms: 1,
        notes: [
          "Mock implementation wrapper for Direction A.",
          "Mock implementation; no real ACP or PTY session was started.",
        ],
      },
      ...(isSuccess
        ? {}
        : {
            error: {
              code: "COMPILATION_ERROR",
              message: "Simulated driver compilation failure.",
              retryable: true,
            },
          }),
      created_at,
      schema_version: SCHEMA_VERSION,
    };
  }

  async interrupt(_reason: string): Promise<void> {
    return Promise.resolve();
  }

  async collectTranscript(taskId = "task"): Promise<ArtifactRef> {
    const created_at = nowTimestamp();
    return {
      artifact_id: createId("artifact"),
      type: "transcript",
      uri: `artifact://transcript/${taskId}/mock-session`,
      producer_id: this.driver_id,
      task_id: taskId,
      created_at,
      schema_version: SCHEMA_VERSION,
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }
}

export function runAcpMockServer() {
  const writable = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const readable = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(writable, readable);

  new AgentSideConnection((conn) => {
    return {
      initialize: async () => {
        return {
          protocolVersion: 1,
          agentCapabilities: {
            supports_acp_extension: false,
            supports_structured_output: true,
            supports_session_load: false,
            supports_tool_events: true,
            supports_permission_events: false,
          },
          agentInfo: {
            name: "mock-driver-acp",
            version: "1.0.0",
          },
          authMethods: [],
        };
      },
      authenticate: async () => {
        return {};
      },
      newSession: async () => {
        return {
          sessionId: "mock-session-id",
        };
      },
      prompt: async (params: any) => {
        const promptText = params.prompt[0]?.text || "";

        try {
          if (promptText.toLowerCase().includes("write")) {
            const filePath = ".temp/test-write.txt";
            const content = "Filesystem write verification token: XYZ123";

            await conn.writeTextFile({
              sessionId: params.sessionId,
              path: filePath,
              content: content,
            });

            return {
              stopReason: "done",
            };
          } else if (promptText.toLowerCase().includes("read")) {
            const filePath = ".temp/test-read.txt";
            const result = await conn.readTextFile({
              sessionId: params.sessionId,
              path: filePath,
            });

            await conn.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: {
                  type: "text",
                  text: result.content || "",
                },
              },
            });

            return {
              stopReason: "done",
            };
          }
        } catch (err: any) {
          await conn.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: `ERROR:${err.message || String(err)}`,
              },
            },
          });
        }

        return {
          stopReason: "done",
        };
      },
      cancel: async () => {
        // ignore
      },
    };
  }, stream);
}

// Run ACP Mock Server if executed directly
if (
  typeof process !== "undefined" &&
  (process.argv[1]?.endsWith("mock-driver.js") ||
    process.argv[1]?.endsWith("mock-driver.ts") ||
    process.argv.includes("--acp") ||
    process.env.RUN_MOCK_DRIVER === "1")
) {
  runAcpMockServer();
}
