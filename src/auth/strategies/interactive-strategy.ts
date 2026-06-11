import { AuthStrategy, AuthCredential } from "../interface.js";
import { select } from "@inquirer/prompts";

export class InteractiveStrategy implements AuthStrategy {
  readonly type = "interactive";

  async execute(authMethods: any[], verbose?: boolean): Promise<AuthCredential | null> {
    if (!authMethods || authMethods.length === 0) {
      if (verbose) console.log("[Auth:Interactive] No auth methods available");
      return null;
    }

    if (authMethods.length === 1) {
      if (verbose) console.log(`[Auth:Interactive] Only one method available, auto-selecting: ${authMethods[0].id}`);
      return { methodId: authMethods[0].id };
    }

    if (verbose) console.log("[Auth:Interactive] Prompting user for method selection...");
    const choices = authMethods.map((m) => ({
      name: m.name || m.id,
      value: m.id,
      description: m.description,
    }));

    const methodId = await select({
      message: "Select an authentication method:",
      choices,
    });

    return { methodId };
  }
}
