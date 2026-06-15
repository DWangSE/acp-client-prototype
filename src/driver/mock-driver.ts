import type {
  ArtifactRef,
  DriverCapabilities,
  DriverPrompt,
  DriverRunResult,
  DriverRuntimeHandle,
  DriverRunStatus
} from "./interface.js";

export class MockDriver implements DriverRuntimeHandle {
  readonly driver_id = "mock-driver";
  readonly session_id = "mock-session";
  readonly capabilities: DriverCapabilities = {
    supports_acp_extension: false,
    supports_structured_output: true,
    supports_session_load: false,
    supports_tool_events: true,
    supports_permission_events: false
  };

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async sendPrompt(input: DriverPrompt): Promise<DriverRunResult> {
    if (!this.initialized) {
      throw new Error("Driver not initialized. Please call initialize() first.");
    }

    const created_at = new Date().toISOString();
    
    // Determine status from prompt (to support diverse testing flows)
    const isSuccess = !input.prompt.toLowerCase().includes("driver_fail");
    const status: DriverRunStatus = isSuccess ? "succeeded" : "failed";

    const patchArtifact: ArtifactRef = {
      artifact_id: `art-patch-${input.task_id}`,
      type: "patch",
      uri: `artifact://patch/${input.task_id}/mock-driver.patch`,
      sha256: "mock-sha256-hash-value-v0",
      producer_id: this.driver_id,
      task_id: input.task_id,
      metadata: {
        prompt: input.prompt,
        context_pack_id: input.context_pack_ref?.context_pack_id
      },
      created_at,
      schema_version: "v0"
    };

    const transcript = await this.collectTranscript(input.task_id);

    return {
      driver_run_result_id: `driver-res-${input.task_id}`,
      session_id: this.session_id,
      status,
      artifacts: [patchArtifact],
      transcript_ref: transcript,
      tool_events: [
        {
          tool_event_id: `tool-event-${input.task_id}`,
          tool_name: "mock.write_patch",
          status: "completed",
          summary: "MockDriver produced a deterministic patch artifact for testing.",
          created_at,
          schema_version: "v0"
        }
      ],
      diagnostics: {
        driver_id: this.driver_id,
        duration_ms: 12,
        notes: [
          "Mock implementation wrapper for Direction A.",
          `Prompt matched success status: ${isSuccess}`
        ]
      },
      ...(isSuccess ? {} : {
        error: {
          code: "COMPILATION_ERROR",
          message: "Simulated driver compilation failure.",
          retryable: true
        }
      }),
      created_at,
      schema_version: "v0"
    };
  }

  async interrupt(_reason: string): Promise<void> {
    return Promise.resolve();
  }

  async collectTranscript(taskId = "task"): Promise<ArtifactRef> {
    const created_at = new Date().toISOString();
    return {
      artifact_id: `art-transcript-${taskId}`,
      type: "transcript",
      uri: `artifact://transcript/${taskId}/mock-session`,
      producer_id: this.driver_id,
      task_id: taskId,
      created_at,
      schema_version: "v0"
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }
}
