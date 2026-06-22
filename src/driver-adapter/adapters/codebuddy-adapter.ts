import { BaseAdapter } from "../base-adapter.js";

export class CodebuddyAdapter extends BaseAdapter {
  constructor() {
    super(
      "codebuddy",
      "CodeBuddy Code",
      "Tencent CodeBuddy AI coding agent",
      "acp",
      "npx",
      ["-y", "--package", "@tencent-ai/codebuddy-code", "codebuddy", "--acp"],
      "auto",
      {
        CODEBUDDY_API_KEY: "codebuddy-api-key",
        TENCENT_API_KEY: "tencent-api-key",
      }
    );
  }
}
