import { ClientMethodHandler } from "./interface.js";
import spawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";

export class TerminalHandler implements ClientMethodHandler {
  private terminals = new Map<string, ChildProcess>();
  private nextId = 1;

  async handle(method: string, params: any): Promise<any> {
    switch (method) {
      case "terminal/create": {
        const id = `term_${this.nextId++}`;
        // ACP spec: command is a string, often executed in a shell
        const proc = spawn(params.command, [], {
          shell: true,
          cwd: params.cwd || process.cwd(),
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
