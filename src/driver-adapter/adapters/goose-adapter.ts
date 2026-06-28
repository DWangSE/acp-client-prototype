import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { BaseAdapter } from "../base-adapter.js";

export class GooseAdapter extends BaseAdapter {
  constructor() {
    super(
      "goose",
      "Goose",
      "Block/Square Goose AI coding agent",
      "acp",
      "goose",
      ["acp"],
      "pre-configured",
      {
        GOOSE_PATH_ROOT: "goose-path-root",
        GOOSE_PROVIDER: "goose-provider",
        GOOSE_MODEL: "goose-model",
        GOOSE_DISABLE_KEYRING: "goose-disable-keyring",
      }
    );
  }

  override resolveEnv(): Record<string, string | undefined> {
    const env = super.resolveEnv();

    // Default GOOSE_DISABLE_KEYRING to "1" if not specified, to force Goose
    // to write plaintext configuration/secrets locally in the project sandbox (.goose/config/secrets.yaml)
    // instead of writing globally to the OS secure keyring.
    if (env.GOOSE_PATH_ROOT && env.GOOSE_DISABLE_KEYRING === undefined) {
      env.GOOSE_DISABLE_KEYRING = "1";
    }

    if (env.GOOSE_PATH_ROOT) {
      const configPath = path.resolve(env.GOOSE_PATH_ROOT, "config", "config.yaml");
      if (!existsSync(configPath)) {
        console.log(
          `\n\x1b[33m[Goose Local Setup]\x1b[0m Local configuration file not found at: ${configPath}`
        );
        console.log(`\x1b[32mLaunching interactive Goose configuration page locally...\x1b[0m\n`);

        const result = spawnSync("goose", ["configure"], {
          stdio: "inherit",
          env: {
            ...process.env,
            ...env,
          },
        });

        if (result.status !== 0) {
          console.error(
            `\x1b[31m[Goose Local Setup Error]\x1b[0m "goose configure" exited with status ${result.status}`
          );
        } else {
          console.log(
            `\n\x1b[32m[Goose Local Setup] Local configuration generated successfully!\x1b[0m\n`
          );
        }
      }
    }

    return env;
  }
}
