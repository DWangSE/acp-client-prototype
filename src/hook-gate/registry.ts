import {
  Hook,
  Gate,
  HookPoint,
  GatePoint,
  HookContext,
  GateContext,
  GateDecision,
} from "./interface.js";

export class HookRegistry {
  private hooks = new Map<HookPoint, Hook[]>();

  register(hook: Hook) {
    const list = this.hooks.get(hook.point) || [];
    list.push(hook);
    list.sort((a, b) => a.priority - b.priority);
    this.hooks.set(hook.point, list);
  }

  async execute(point: HookPoint, context: HookContext): Promise<void> {
    const list = this.hooks.get(point) || [];
    for (const hook of list) {
      await hook.execute(context);
    }
  }
}

export class GateRegistry {
  private gates = new Map<GatePoint, Gate[]>();

  register(gate: Gate) {
    const list = this.gates.get(gate.point) || [];
    list.push(gate);
    list.sort((a, b) => a.priority - b.priority);
    this.gates.set(gate.point, list);
  }

  async intercept(point: GatePoint, context: GateContext): Promise<GateDecision> {
    const list = this.gates.get(point) || [];
    let currentDecision: GateDecision = { action: "pass" };

    for (const gate of list) {
      const decision = await gate.intercept({ ...context, data: currentDecision.action === "modify" ? currentDecision.value : context.data });
      if (decision.action === "block") return decision;
      if (decision.action === "modify") {
        currentDecision = decision;
      }
    }
    return currentDecision;
  }
}
