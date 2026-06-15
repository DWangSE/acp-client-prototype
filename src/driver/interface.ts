export type ArtifactType =
  | "patch"
  | "diff"
  | "test_log"
  | "review"
  | "decision_packet"
  | "checkpoint"
  | "context"
  | "transcript"
  | "driver_result"
  | "audit"
  | "merge_authorization";

export interface ArtifactRef {
  artifact_id: string;
  type: ArtifactType;
  uri: string;
  sha256?: string;
  producer_id: string;
  task_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  schema_version: string;
}

export interface ContextPackRef {
  context_pack_id: string;
  uri: string;
  task_id?: string;
  schema_version: string;
}

export interface DriverCapabilities {
  supports_acp_extension: boolean;
  supports_structured_output: boolean;
  supports_session_load: boolean;
  supports_tool_events: boolean;
  supports_permission_events: boolean;
}

export interface DriverPrompt {
  task_id: string;
  run_id: string;
  prompt: string;
  context_pack_ref?: ContextPackRef;
  created_at: string;
  schema_version: string;
}

export interface DriverToolEvent {
  tool_event_id: string;
  tool_name: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  summary: string;
  created_at: string;
  schema_version: string;
}

export interface DriverError {
  code: string;
  message: string;
  retryable: boolean;
}

export type DriverRunStatus = "succeeded" | "failed" | "cancelled" | "interrupted";

export interface DriverRunResult {
  driver_run_result_id: string;
  session_id: string;
  status: DriverRunStatus;
  artifacts: ArtifactRef[];
  transcript_ref: ArtifactRef;
  tool_events: DriverToolEvent[];
  diagnostics: {
    driver_id: string;
    duration_ms: number;
    notes: string[];
  };
  error?: DriverError;
  created_at: string;
  schema_version: string;
}

export interface DriverRuntimeHandle {
  driver_id: string;
  session_id: string;
  capabilities: DriverCapabilities;
  sendPrompt(input: DriverPrompt): Promise<DriverRunResult>;
  interrupt(reason: string): Promise<void>;
  collectTranscript(taskId?: string): Promise<ArtifactRef>;
}
