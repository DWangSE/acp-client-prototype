import { ClientMethodHandler } from "./interface.js";
import spawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";
import { WorkspaceBoundary } from "../security/workspace-boundary.js";

const TERMINAL_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "USER",
  "LOGNAME",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
] as const;

export function createTerminalEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of TERMINAL_ENV_KEYS) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("LC_") && value !== undefined) result[key] = value;
  }
  return result;
}

export class TerminalHandler implements ClientMethodHandler {
  private terminals = new Map<string, ChildProcess>();
  private nextId = 1;
  private readonly boundary: WorkspaceBoundary;

  constructor(workspace = process.cwd()) {
    this.boundary = new WorkspaceBoundary(workspace);
  }

  async handle(method: string, params: any): Promise<any> {
    switch (method) {
      case "terminal/create": {
        const id = `term_${this.nextId++}`;
        const cwd = await this.boundary.resolveExisting(params.cwd ?? ".");
        // ACP spec: command is a string, often executed in a shell
        const proc = spawn(params.command, [], {
          shell: true,
          cwd,
          env: { ...createTerminalEnv(process.env), PWD: cwd },
          stdio: "inherit", // For now, simple inherit. Real IDEs capture output.
        });

        this.terminals.set(id, proc);

        return { terminalId: id };
      }

      case "terminal/wait_for_exit": {
        const proc = this.terminals.get(params.terminalId);
        if (!proc) throw new Error(`Terminal ${params.terminalId} not found`);

        return new Promise((resolve) => {
          if (proc.exitCode !== null) {
            resolve({ exitCode: proc.exitCode });
          } else {
            proc.on("exit", (code) => {
              resolve({ exitCode: code ?? 0 });
            });
          }
        });
      }

      default:
        throw new Error(`Unsupported terminal method: ${method}`);
    }
  }
}
