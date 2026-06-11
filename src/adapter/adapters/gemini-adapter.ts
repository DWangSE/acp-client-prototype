import { BaseAdapter } from "../base-adapter.js";

export class GeminiAdapter extends BaseAdapter {
  constructor() {
    super(
      "gemini",
      "Gemini CLI",
      "Google Gemini AI coding agent",
      "acp",
      "npx",
      ["-y", "@google/gemini-cli", "--acp"],
      "auto",
      {
        GEMINI_API_KEY: "gemini-api-key",
        GOOGLE_CLOUD_PROJECT: "vertex-ai",
      }
    );
  }

  override normalizeResponse(method: string, raw: any): any {
    // Gemini quirk: sometimes returns bare {} for authenticate
    if (method === "authenticate" && raw && Object.keys(raw).length === 0) {
      return { success: true };
    }
    return raw;
  }
}
