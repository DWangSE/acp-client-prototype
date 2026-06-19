import { AuthStrategy, AuthCredential } from "../interface.js";
import { EnvAutoStrategy } from "./env-auto-strategy.js";
import { InteractiveStrategy } from "./interactive-strategy.js";
import spawn from "cross-spawn";

/**
 * Smart Auto Strategy:
 * 1. Tries to match environment variables (EnvAutoStrategy)
 * 2. Handles special "terminal-auth" types found in metadata
 * 3. If no match found but methods are available, falls back to Interactive (InteractiveStrategy)
 */
export class AutoStrategy implements AuthStrategy {
  readonly type = "auto";
  private envAuto = new EnvAutoStrategy();
  private interactive = new InteractiveStrategy();

  async execute(authMethods: any[], verbose?: boolean): Promise<AuthCredential | null> {
    if (!authMethods || authMethods.length === 0) {
      if (verbose) console.log("[Auth:Auto] No auth methods available from agent");
      return null;
    }

    // 1. Try Env Auto
    if (verbose) console.log("[Auth:Auto] Attempting environment-based auto-selection...");
    const envCred = await this.envAuto.execute(authMethods, verbose);
    if (envCred) {
      if (verbose) console.log(`[Auth:Auto] Auto-selected method: ${envCred.methodId}`);
      return envCred;
    }

    // 2. Special Check: Terminal Auth (Kimi style)
    const terminalMethod = authMethods.find(
      (m) => m.type === "terminal" || (m._meta && m._meta["terminal-auth"])
    );

    if (terminalMethod) {
      const terminalInfo = terminalMethod._meta?.["terminal-auth"] || terminalMethod;
      let command = terminalInfo.command;
      let args = terminalInfo.args || [];

      if (command) {
        // Windows fix: if command is a .mjs or .js file, we need to run it with node
        if (process.platform === "win32" && (command.endsWith(".mjs") || command.endsWith(".js"))) {
          args = [command, ...args];
          command = "node";
        }

        if (verbose)
          console.log(
            `[Auth:Auto] Found terminal-auth for ${terminalMethod.id}. Executing: ${command} ${args.join(" ")}`
          );
        console.log("\n══════════════════════════════════════════════════════════════");
        console.log(`Authentication required for ${terminalMethod.name || terminalMethod.id}`);
        console.log("Launching terminal login flow...");
        console.log("══════════════════════════════════════════════════════════════\n");

        const result = spawn.sync(command, args, {
          stdio: "inherit",
          env: { ...process.env, ...(terminalInfo.env || {}) },
        });

        console.log("\n══════════════════════════════════════════════════════════════");
        if (result.status === 0) {
          if (verbose) console.log("[Auth:Auto] Terminal login completed successfully");
          return { methodId: terminalMethod.id };
        } else {
          console.log(`Terminal login exited with code ${result.status}`);
          return { methodId: terminalMethod.id };
        }
      }
    }

    // 3. Fallback to Interactive
    if (verbose)
      console.log(
        "[Auth:Auto] No environment match or terminal-auth found, falling back to interactive selection"
      );
    return await this.interactive.execute(authMethods, verbose);
  }
}
