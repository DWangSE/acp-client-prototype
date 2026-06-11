import { AgentAdapter } from "./interface.js";
import { ConnectionType } from "../connection/interface.js";
import { AuthStrategyType } from "../auth/interface.js";

export abstract class BaseAdapter implements AgentAdapter {
  constructor(
    public readonly agentId: string,
    public readonly name: string,
    public readonly description: string,
    public readonly connectionType: ConnectionType,
    protected readonly defaultCommand: string,
    protected readonly defaultArgs: string[],
    protected readonly authStrategy: AuthStrategyType = "none",
    public readonly authEnvMap: Record<string, string> = {}
  ) {}

  resolveCommand(): { command: string; args: string[] } {
    const envCommand = process.env[`${this.agentId.toUpperCase()}_CLI_COMMAND`];
    const envArgs = process.env[`${this.agentId.toUpperCase()}_CLI_ARGS`];

    return {
      command: envCommand || this.defaultCommand,
      args: envArgs ? envArgs.split(" ") : this.defaultArgs,
    };
  }

  resolveEnv(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    // Automatically include mapped auth env vars
    for (const envVar of Object.keys(this.authEnvMap)) {
      if (process.env[envVar]) {
        env[envVar] = process.env[envVar];
      }
    }
    return env;
  }

  resolveAuthStrategy(): AuthStrategyType {
    return this.authStrategy;
  }

  normalizeResponse?(method: string, raw: unknown): unknown {
    return raw;
  }

  parsePtyOutput?(chunk: string): any[] {
    return [];
  }
}
