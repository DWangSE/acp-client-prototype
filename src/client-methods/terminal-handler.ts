import { ClientMethodHandler } from "./interface.js";
import spawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";

interface TerminalExitStatus {
  exitCode?: number | null;
  signal?: string | null;
}

interface TerminalRecord {
  id: string;
  process: ChildProcess;
  output: string;
  outputBytes: number;
  outputByteLimit: number;
  truncated: boolean;
  exitStatus?: TerminalExitStatus;
  exitPromise: Promise<TerminalExitStatus>;
  resolveExit: (status: TerminalExitStatus) => void;
  released: boolean;
}

export interface TerminalHandlerOptions {
  defaultOutputByteLimit?: number;
}

const DEFAULT_OUTPUT_BYTE_LIMIT = 1024 * 1024;

export class TerminalHandler implements ClientMethodHandler {
  private terminals = new Map<string, TerminalRecord>();
  private nextId = 1;
  private defaultOutputByteLimit: number;

  constructor(options: TerminalHandlerOptions = {}) {
    this.defaultOutputByteLimit = options.defaultOutputByteLimit ?? DEFAULT_OUTPUT_BYTE_LIMIT;
  }

  async handle(method: string, params: any): Promise<any> {
    switch (method) {
      case "terminal/create":
        return this.create(params);
      case "terminal/output":
        return this.output(params);
      case "terminal/wait_for_exit":
        return this.waitForExit(params);
      case "terminal/kill":
        return this.kill(params);
      case "terminal/release":
        return this.release(params);
      default:
        throw new Error(`Unsupported terminal method: ${method}`);
    }
  }

  private create(params: any): { terminalId: string } {
    const id = `term_${this.nextId++}`;
    const outputByteLimit = this.normalizeOutputByteLimit(params.outputByteLimit);
    const env = this.normalizeEnv(params.env);

    let resolveExit!: (status: TerminalExitStatus) => void;
    const exitPromise = new Promise<TerminalExitStatus>((resolve) => {
      resolveExit = resolve;
    });

    const args = params.args ?? [];
    const proc = spawn(params.command, args, {
      shell: args.length === 0 && this.shouldUseShell(params.command),
      cwd: params.cwd || process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const record: TerminalRecord = {
      id,
      process: proc,
      output: "",
      outputBytes: 0,
      outputByteLimit,
      truncated: false,
      exitPromise,
      resolveExit,
      released: false,
    };

    const appendOutput = (chunk: Buffer | string) => {
      this.appendOutput(record, chunk);
    };

    proc.stdout?.on("data", appendOutput);
    proc.stderr?.on("data", appendOutput);
    proc.once("exit", (code, signal) => {
      const status = { exitCode: code, signal };
      record.exitStatus = status;
      record.resolveExit(status);
    });
    proc.once("error", (err) => {
      this.appendOutput(record, `\n[terminal error] ${err.message}\n`);
      const status = { exitCode: null, signal: "error" };
      record.exitStatus = status;
      record.resolveExit(status);
    });

    this.terminals.set(id, record);
    return { terminalId: id };
  }

  private output(params: any) {
    const record = this.getTerminal(params.terminalId);
    return {
      output: record.output,
      truncated: record.truncated,
      ...(record.exitStatus ? { exitStatus: record.exitStatus } : {}),
    };
  }

  private async waitForExit(params: any): Promise<TerminalExitStatus> {
    const record = this.getTerminal(params.terminalId);
    const status = record.exitStatus ?? (await record.exitPromise);
    return {
      exitCode: status.exitCode ?? null,
      signal: status.signal ?? null,
    };
  }

  private async kill(params: any): Promise<Record<string, never>> {
    const record = this.getTerminal(params.terminalId);
    await this.killProcess(record);
    return {};
  }

  private async release(params: any): Promise<Record<string, never>> {
    const record = this.getTerminal(params.terminalId);
    record.released = true;
    await this.killProcess(record);
    this.destroyStreams(record.process);
    this.terminals.delete(record.id);
    return {};
  }

  private getTerminal(terminalId: string): TerminalRecord {
    const record = this.terminals.get(terminalId);
    if (!record || record.released) {
      throw new Error(`Terminal ${terminalId} not found`);
    }
    return record;
  }

  private appendOutput(record: TerminalRecord, chunk: Buffer | string): void {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    const bytes = Buffer.byteLength(text, "utf8");
    record.output += text;
    record.outputBytes += bytes;

    if (record.outputBytes > record.outputByteLimit) {
      record.truncated = true;
      while (record.outputBytes > record.outputByteLimit && record.output.length > 0) {
        const firstCodePoint = Array.from(record.output)[0] ?? "";
        record.output = record.output.slice(firstCodePoint.length);
        record.outputBytes -= Buffer.byteLength(firstCodePoint, "utf8");
      }
    }
  }

  private async killProcess(record: TerminalRecord): Promise<void> {
    if (record.exitStatus) return;

    const pid = record.process.pid;
    if (process.platform === "win32" && pid) {
      try {
        await new Promise<void>((resolve) => {
          const killer = spawn("taskkill", ["/T", "/F", "/PID", String(pid)], {
            stdio: "ignore",
            windowsHide: true,
          });
          killer.once("exit", () => resolve());
          killer.once("error", () => resolve());
        });
        return;
      } catch {
        // Fall through to direct process kill.
      }
    }

    try {
      record.process.kill();
    } catch {
      // The process may already be gone.
    }
  }

  private destroyStreams(proc: ChildProcess): void {
    try {
      proc.stdin?.destroy();
      proc.stdout?.destroy();
      proc.stderr?.destroy();
    } catch {
      // ignore cleanup errors
    }
  }

  private normalizeOutputByteLimit(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return this.defaultOutputByteLimit;
    }
    return Math.floor(value);
  }

  private normalizeEnv(value: unknown): Record<string, string> {
    if (!Array.isArray(value)) return {};

    return Object.fromEntries(
      value
        .filter((item) => item && typeof item.name === "string" && typeof item.value === "string")
        .map((item) => [item.name, item.value])
    );
  }

  private shouldUseShell(command: unknown): boolean {
    if (typeof command !== "string") return false;
    return /[<>|&;]/.test(command);
  }
}
