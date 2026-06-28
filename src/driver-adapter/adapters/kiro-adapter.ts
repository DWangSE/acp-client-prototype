import { existsSync } from "node:fs";
import path from "node:path";
import { BaseAdapter } from "../base-adapter.js";

export class KiroAdapter extends BaseAdapter {
  constructor() {
    super(
      "kiro",
      "Kiro AI",
      "AWS Kiro AI coding agent CLI",
      "acp",
      "kiro-cli",
      ["acp"],
      "pre-configured"
    );
  }

  override resolveCommand(): { command: string; args: string[] } {
    const resolved = super.resolveCommand();

    // On Windows, if kiro-cli isn't in Node's current PATH
    // we attempt to resolve its standard absolute installation path.
    if (resolved.command === "kiro-cli") {
      const localAppData =
        process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
      const fallbackPath = path.join(localAppData, "Kiro-Cli", "kiro-cli.exe");
      if (existsSync(fallbackPath)) {
        return {
          command: fallbackPath,
          args: resolved.args,
        };
      }
    }

    return resolved;
  }
}
