import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type { Client, SessionNotification } from "@agentclientprotocol/sdk";
import spawn from "cross-spawn";
import { spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter, on } from "node:events";
import { Readable, Writable } from "node:stream";
import {
  AgentConnection,
  ConnectionOptions,
  ConnectionEvent,
  InitializeResult,
  SessionRecord,
  TurnController,
} from "./interface.js";
import { AgentSpawnError, TransportError } from "../core/errors.js";
import type { ClientCapabilities } from "../core/types.js";

export class AcpConnection implements AgentConnection {
  readonly type = "acp";
  private process: ChildProcess | null = null;
  private sdkConn: ClientSideConnection | null = null;
  private eventEmitter = new EventEmitter();
  private methodRouter: { route(method: string, params: any): Promise<any> } | null = null;

  private verbose = false;

  get isConnected(): boolean {
    return !!this.sdkConn;
  }

  setMethodRouter(router: { route(method: string, params: any): Promise<any> }): void {
    this.methodRouter = router;
  }

  async connect(options: ConnectionOptions): Promise<void> {
    this.verbose = options.verbose ?? false;
    this.process = spawn(options.command, options.args, {
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!this.process.stdin || !this.process.stdout) {
      throw new AgentSpawnError("Failed to open stdin/stdout for agent process");
    }

    if (this.verbose) {
      const agentLabel = `${options.command} ${options.args.join(" ")}`;
      this.process.stdout.on("data", (chunk) => {
        const text =
          Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString()
            : String(chunk);
        console.log(`\x1b[32m[Raw Output from ${agentLabel}]\x1b[0m ${text.trim()}`);
      });
      this.process.stderr?.on("data", (chunk) => {
        const text =
          Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString()
            : String(chunk);
        console.log(`\x1b[31m[Raw Stderr from ${agentLabel}]\x1b[0m ${text.trim()}`);
      });
      const originalWrite = this.process.stdin.write.bind(this.process.stdin);
      this.process.stdin.write = (chunk: any, encoding?: any, cb?: any) => {
        const text =
          Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString()
            : String(chunk);
        console.log(`\x1b[34m[Raw Input to ${agentLabel}]\x1b[0m ${text.trim()}`);
        return originalWrite(chunk, encoding, cb);
      };
    }

    // Wrap stdin/stdout into Web Streams
    const writable = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>;
    const readable = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>;

    const stream = ndJsonStream(writable, readable);

    // Define a simple client implementation to handle callbacks from agent
    const clientImpl: Client = {
      sessionUpdate: async (params: SessionNotification) => {
        const updateType = params.update.sessionUpdate;
        this.emitEvent(updateType as any, params);
      },
      requestPermission: async (params) => {
        if (this.methodRouter)
          return await this.methodRouter.route("session/request_permission", params);
        this.emitEvent("permission_request", params);
        return { outcome: "denied" };
      },
      readTextFile: async (params) => {
        if (this.methodRouter) return await this.methodRouter.route("fs/read_text_file", params);
        this.emitEvent("fs/read_text_file" as any, params);
        return { content: "" };
      },
      writeTextFile: async (params) => {
        if (this.methodRouter) return await this.methodRouter.route("fs/write_text_file", params);
        this.emitEvent("fs/write_text_file" as any, params);
        return {};
      },
      createTerminal: async (params) => {
        if (this.methodRouter) return await this.methodRouter.route("terminal/create", params);
        this.emitEvent("terminal/create" as any, params);
        return { terminalId: "term_stub" };
      },
    };

    this.sdkConn = new ClientSideConnection(() => clientImpl, stream);

    this.process.on("exit", (code, signal) => {
      this.emitEvent("disconnect", { code, signal });
      this.sdkConn = null;
    });

    this.process.stderr?.on("data", (data) => {
      this.emitEvent("stderr", data.toString());
    });
  }

  private emitEvent(type: ConnectionEvent["type"], payload: any) {
    const event: ConnectionEvent = { type, payload };
    this.eventEmitter.emit("event", event);
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      const pid = this.process.pid;
      if (process.platform === "win32" && pid) {
        try {
          // On Windows, killing the parent wrapper process (like npx.cmd) doesn't kill the child.
          // We must force kill the entire process tree using taskkill.
          spawnSync("taskkill", ["/F", "/T", "/PID", pid.toString()]);
        } catch (e) {
          if (this.verbose) {
            console.error(`Failed to taskkill process tree for PID ${pid}:`, e);
          }
        }
      } else {
        this.process.kill();
      }
      this.process = null;
    }
    this.sdkConn = null;
  }

  async initialize(params: {
    protocolVersion: number;
    clientCapabilities: ClientCapabilities;
    clientInfo?: { name: string; version: string };
  }): Promise<InitializeResult> {
    if (!this.sdkConn) throw new TransportError("Not connected");
    return (await this.sdkConn.initialize(params)) as InitializeResult;
  }

  async authenticate(methodId: string, authMethod: any): Promise<void> {
    if (!this.sdkConn) throw new TransportError("Not connected");
    await this.sdkConn.authenticate({ methodId, authMethod });
  }

  async createSession(cwd: string): Promise<SessionRecord> {
    if (!this.sdkConn) throw new TransportError("Not connected");
    const resp = await this.sdkConn.newSession({ cwd, mcpServers: [] });
    return { sessionId: resp.sessionId };
  }

  async loadSession(sessionId: string, cwd: string): Promise<SessionRecord> {
    if (!this.sdkConn) throw new TransportError("Not connected");
    await this.sdkConn.loadSession({ sessionId, cwd, mcpServers: [] });
    return { sessionId };
  }

  async sendPrompt(sessionId: string, message: string): Promise<TurnController> {
    if (!this.sdkConn) throw new TransportError("Not connected");

    const promptPromise = this.sdkConn.prompt({
      sessionId,
      prompt: [{ type: "text", text: message }],
    });

    return new AcpTurnController(promptPromise, this.eventEmitter, sessionId, this.sdkConn);
  }

  async cancel(sessionId: string): Promise<void> {
    if (!this.sdkConn) throw new TransportError("Not connected");
    await this.sdkConn.cancel({ sessionId });
  }

  async *onEvent(): AsyncIterable<ConnectionEvent> {
    for await (const [event] of on(this.eventEmitter, "event")) {
      yield event as ConnectionEvent;
    }
  }
}

class AcpTurnController implements TurnController {
  constructor(
    public readonly result: Promise<any>,
    private eventEmitter: EventEmitter,
    private sessionId: string,
    private sdkConn: ClientSideConnection
  ) {}

  async cancel(): Promise<void> {
    await this.sdkConn.cancel({ sessionId: this.sessionId });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ConnectionEvent> {
    const ac = new AbortController();
    this.result.finally(() => ac.abort());

    try {
      const iterator = on(this.eventEmitter, "event", { signal: ac.signal });
      for await (const [event] of iterator) {
        const connEvent = event as ConnectionEvent;
        // Filter by session ID if possible (SessionNotification has sessionId)
        if (connEvent.payload?.sessionId && connEvent.payload.sessionId !== this.sessionId) {
          continue;
        }
        yield connEvent;
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      throw err;
    }
  }
}
