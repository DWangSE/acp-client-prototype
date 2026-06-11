import * as pty from "node-pty";
import { EventEmitter, on } from "node:events";
import {
  AgentConnection,
  ConnectionOptions,
  ConnectionEvent,
  InitializeResult,
  SessionRecord,
  TurnController,
} from "./interface.js";
import { PtyError } from "../core/errors.js";
import type { ClientCapabilities } from "../core/types.js";

export class PtyConnection implements AgentConnection {
  readonly type = "pty";
  private ptyProcess: pty.IPty | null = null;
  private eventEmitter = new EventEmitter();
  private verbose = false;

  get isConnected(): boolean {
    return !!this.ptyProcess;
  }

  setMethodRouter(_router: { route(method: string, params: any): Promise<any> }): void {
    // PTY doesn't support structured client methods yet
  }

  async connect(options: ConnectionOptions): Promise<void> {
    this.verbose = options.verbose ?? false;
    this.ptyProcess = pty.spawn(options.command, options.args, {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env } as any,
    });

    this.ptyProcess.onData((data) => {
      if (this.verbose) {
          console.log(`\x1b[32m[PTY Output]\x1b[0m ${data}`);
      }
      this.emitEvent("agent_message_chunk", { content: { type: "text", text: data } });
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.emitEvent("disconnect", { code: exitCode, signal });
      this.ptyProcess = null;
    });
  }

  private emitEvent(type: ConnectionEvent["type"], payload: any) {
    const event: ConnectionEvent = { type, payload };
    this.eventEmitter.emit("event", event);
  }

  async disconnect(): Promise<void> {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
  }

  async initialize(_params: {
    protocolVersion: number;
    clientCapabilities: ClientCapabilities;
    clientInfo?: { name: string; version: string };
  }): Promise<InitializeResult> {
    return {
      protocolVersion: 1,
      agentCapabilities: {},
      agentInfo: { name: "PTY Agent", version: "1.0.0" },
    };
  }

  async authenticate(_methodId: string, _authMethod: any): Promise<void> {
    // PTY typically uses env vars for auth
  }

  async createSession(_cwd: string): Promise<SessionRecord> {
    return { sessionId: "pty_session" };
  }

  async sendPrompt(_sessionId: string, message: string): Promise<TurnController> {
    if (!this.ptyProcess) throw new PtyError("Not connected");

    if (this.verbose) {
        console.log(`\x1b[34m[PTY Input]\x1b[0m ${message}`);
    }
    this.ptyProcess.write(message + "\r");

    // PTY result handling is complex. For now, it stays open until disconnect.
    const resultPromise = new Promise(() => {});

    return new PtyTurnController(resultPromise, this.eventEmitter, this);
  }

  async cancel(_sessionId: string): Promise<void> {
    if (this.verbose) {
        console.log(`\x1b[34m[PTY Input]\x1b[0m ^C`);
    }
    this.ptyProcess?.write("\x03");
  }

  async *onEvent(): AsyncIterable<ConnectionEvent> {
    for await (const [event] of on(this.eventEmitter, "event")) {
      yield event as ConnectionEvent;
    }
  }
}

class PtyTurnController implements TurnController {
  constructor(
    public readonly result: Promise<any>,
    private eventEmitter: EventEmitter,
    private connection: PtyConnection
  ) {}

  async cancel(): Promise<void> {
    await this.connection.cancel("pty_session");
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ConnectionEvent> {
    const iterator = on(this.eventEmitter, "event");
    for await (const [event] of iterator) {
      yield event as ConnectionEvent;
    }
  }
}
