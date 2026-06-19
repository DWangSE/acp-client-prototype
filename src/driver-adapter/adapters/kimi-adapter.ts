import { BaseAdapter } from "../base-adapter.js";

export class KimiAdapter extends BaseAdapter {
  constructor() {
    super(
      "kimi",
      "Kimi Code",
      "Moonshot Kimi AI coding agent",
      "acp",
      "npx",
      ["-y", "@moonshot-ai/kimi-code", "acp"],
      "auto",
      {
        MOONSHOT_API_KEY: "terminal", // Fallback mapping if they support API keys
      }
    );
  }
}
