import { AgentAdapter } from "./interface.js";
import { GeminiAdapter } from "./adapters/gemini-adapter.js";
import { AiderAdapter } from "./adapters/aider-adapter.js";
import { ClaudeAdapter } from "./adapters/claude-adapter.js";
import { CodexAdapter } from "./adapters/codex-adapter.js";
import { KimiAdapter } from "./adapters/kimi-adapter.js";
import { CodebuddyAdapter } from "./adapters/codebuddy-adapter.js";
import { CopilotAdapter } from "./adapters/copilot-adapter.js";
import { OpencodeAdapter } from "./adapters/opencode-adapter.js";
import { GooseAdapter } from "./adapters/goose-adapter.js";
import { KiroAdapter } from "./adapters/kiro-adapter.js";
import { MockAdapter } from "./adapters/mock-adapter.js";

class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();

  constructor() {
    this.register(new GeminiAdapter());
    this.register(new AiderAdapter());
    this.register(new ClaudeAdapter());
    this.register(new CodexAdapter());
    this.register(new KimiAdapter());
    this.register(new CodebuddyAdapter());
    this.register(new CopilotAdapter());
    this.register(new OpencodeAdapter());
    this.register(new GooseAdapter());
    this.register(new KiroAdapter());
    this.register(new MockAdapter());
  }

  register(adapter: AgentAdapter) {
    this.adapters.set(adapter.agentId, adapter);
  }

  getAdapter(agentId: string): AgentAdapter | undefined {
    return this.adapters.get(agentId);
  }

  listAdapters(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }
}

// singleton instance of the registry
export const ADAPTER_REGISTRY = new AdapterRegistry();
