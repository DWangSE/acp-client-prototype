export type HookPoint =
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
  | "post:disconnect";

export interface HookContext {
  point: HookPoint;
  agentId: string;
  data?: any;
}

export interface Hook {
  readonly point: HookPoint;
  readonly priority: number;
  execute(context: HookContext): Promise<void> | void;
}

export type GatePoint =
  | "request:outbound"
  | "response:inbound"
  | "permission"
  | "output"
  | "client-method";

export interface GateContext {
  point: GatePoint;
  agentId: string;
  data: any;
}

export type GateDecision =
  | { action: "pass" }
  | { action: "modify"; value: any }
  | { action: "block"; reason: string };

export interface Gate {
  readonly point: GatePoint;
  readonly priority: number;
  intercept(context: GateContext): Promise<GateDecision> | GateDecision;
}
