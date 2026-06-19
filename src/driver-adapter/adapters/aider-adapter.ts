import { BaseAdapter } from "../base-adapter.js";

export class AiderAdapter extends BaseAdapter {
  constructor() {
    super(
      "aider",
      "Aider",
      "AI coding assistant via PTY fallback",
      "pty",
      "aider",
      ["--no-pretty"],
      "pre-configured"
    );
  }

  override resolveEnv(): Record<string, string | undefined> {
    return {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
  }
}
