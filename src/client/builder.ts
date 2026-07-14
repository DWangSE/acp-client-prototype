import { AcpClient, AcpClientOptions } from "./acp-client.js";
import { ADAPTER_REGISTRY } from "../driver-adapter/registry.js";
import { AcpConnection } from "../connection/acp-connection.js";
import { PtyConnection } from "../connection/pty-connection.js";
import { AuthLayer } from "../auth/auth-layer.js";
import { MemorySessionStore } from "../session/memory-session-store.js";
import { ClientMethodRouter } from "../client-methods/router.js";
import { ClientInterceptors } from "../hook-gate/interface.js";
import { FileSystemHandler } from "../client-methods/filesystem-handler.js";
import { PermissionHandler } from "../client-methods/permission-handler.js";
import { TerminalHandler } from "../client-methods/terminal-handler.js";
import { ClientMethodHandler } from "../client-methods/interface.js";
import { loadExtensionConfig } from "../client-methods/extension-loader.js";

export class AcpClientBuilder {
  private agentId?: string;
  private verbose: boolean = false;
  private extensionConfigPath?: string;
  private handlers: Record<string, ClientMethodHandler> = {};
  private autoApprove: boolean = false;
  private sandboxDir: string = process.cwd();
  private interceptors?: ClientInterceptors;

  withAgent(agentId: string): this {
    this.agentId = agentId;
    return this;
  }

  withVerbose(verbose: boolean): this {
    this.verbose = verbose;
    return this;
  }

  withAutoApprove(autoApprove: boolean): this {
    this.autoApprove = autoApprove;
    return this;
  }

  withSandboxDir(sandboxDir: string): this {
    this.sandboxDir = sandboxDir;
    return this;
  }

  withExtensionConfig(configPath: string): this {
    this.extensionConfigPath = configPath;
    return this;
  }

  registerExtensionHandler(methodName: string, handler: ClientMethodHandler): this {
    this.handlers[methodName] = handler;
    return this;
  }

  withInterceptors(interceptors: ClientInterceptors): this {
    this.interceptors = interceptors;
    return this;
  }

  build(): AcpClient {
    if (!this.agentId) {
      throw new Error("Agent ID must be specified using 'withAgent()'");
    }

    const adapter = ADAPTER_REGISTRY.getAdapter(this.agentId);
    if (!adapter) {
      throw new Error(`Unknown agent: ${this.agentId}`);
    }

    const connection = adapter.connectionType === "acp" ? new AcpConnection() : new PtyConnection();
    const authLayer = new AuthLayer();
    const sessionManager = new MemorySessionStore();
    const methodRouter = new ClientMethodRouter();

    // Register default handlers
    methodRouter.register("fs", new FileSystemHandler(this.sandboxDir));
    methodRouter.register(
      "session",
      new PermissionHandler(this.autoApprove || process.env.AUTO_APPROVE === "1")
    );
    methodRouter.register("terminal", new TerminalHandler(this.sandboxDir));

    // Register user defined handlers
    for (const [method, handler] of Object.entries(this.handlers)) {
      methodRouter.register(method, handler);
    }

    // Load extensions config if present
    const experimentalCapabilities: Record<string, any> = {};
    if (this.extensionConfigPath) {
      try {
        const methods = loadExtensionConfig(this.extensionConfigPath);
        for (const m of methods) {
          experimentalCapabilities[m.name] = {
            description: m.description,
            params: m.params || {},
          };
        }
      } catch (err) {
        if (this.verbose) {
          console.error(
            `[ClientBuilder] Failed to load extension config: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        throw err;
      }
    }

    const options: AcpClientOptions & { experimentalCapabilities?: Record<string, any> } = {
      adapter,
      connection,
      authLayer,
      sessionManager,
      methodRouter,
      interceptors: this.interceptors,
      verbose: this.verbose,
      experimentalCapabilities,
    };

    return new AcpClient(options);
  }
}
