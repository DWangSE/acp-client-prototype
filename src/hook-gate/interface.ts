export type HookPoint =
  // ACP Client Lifecycle Hooks
  | "pre:connect"
  | "post:connect"
  | "pre:initialize"
  | "post:initialize"
  | "pre:authenticate"
  | "post:authenticate"
  | "pre:session:create"
  | "post:session:create"
  | "pre:prompt"
  | "post:prompt"
  | "pre:disconnect"
  | "post:disconnect"
  // Driver / Agent Runtime Hooks
  | "agent.pre_tool_use"
  | "agent.post_tool_use"
  | "agent.post_tool_use_fail"
  | "agent.checkpoint"
  | "agent.session_start"
  | "agent.session_end"
  | "lifecycle.human_gate";

export interface HookContext {
  point: HookPoint;
  agentId: string;
  data?: any;
}

export type GatePoint =
  | "request:outbound"
  | "response:inbound"
  | "permission"
  | "output"
  | "client-method"
  // Driver / Agent Runtime Gates
  | "lint"
  | "type_check"
  | "format_check"
  | "build_check"
  | "test"
  | "security_scan"
  | "human_approval_wait";

/**
 * Pure Interceptors interface for ACP Client/Driver.
 * The Client does not hold Registries, and instead exposes these
 * direct, unary callbacks to delegate decision-making to the external Policy Engine.
 */
export interface ClientInterceptors {
  output?: (event: any) => Promise<any | null> | any | null;
  permission?: (request: any) => Promise<boolean> | boolean;
}

export interface GateRequest {
  gate_id: string;
  gate_point: string;
  subject_id: string;
  priority: number;
  denying: boolean;
  timeout_ms: number;
  created_at: string;
  payload?: Record<string, any>;
}

export interface GateResult {
  gate_result_id: string;
  gate_point: string;
  subject_id: string;
  decision: "allow" | "deny" | "ask" | "defer";
  reason: string;
  required_actions: string[];
  audit_ref: string;
  target_state?: string;
  created_at: string;
}
