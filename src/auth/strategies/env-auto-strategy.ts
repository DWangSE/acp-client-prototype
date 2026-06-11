import { AuthStrategy, AuthCredential } from "../interface.js";

export class EnvAutoStrategy implements AuthStrategy {
  readonly type = "env-auto";

  async execute(authMethods: any[], verbose?: boolean): Promise<AuthCredential | null> {
    if (!authMethods || authMethods.length === 0) return null;

    // Try to match env vars to auth methods
    const envMap: Record<string, string> = {
      GEMINI_API_KEY: "gemini-api-key",
      GOOGLE_CLOUD_PROJECT: "vertex-ai",
      DASHSCOPE_API_KEY: "qwen-api-key",
      ANTHROPIC_API_KEY: "anthropic-api-key",
      OPENAI_API_KEY: "openai-api-key",
      CODEX_API_KEY: "codex-api-key",
      MOONSHOT_API_KEY: "moonshot-api-key",
    };

    for (const [envVar, methodId] of Object.entries(envMap)) {
      const hasEnv = !!process.env[envVar];
      const hasMethod = authMethods.some((m) => m.id === methodId);
      
      if (verbose) {
        if (hasEnv && !hasMethod) console.log(`[Auth:Env] Found ${envVar} but agent does not support ${methodId}`);
        if (!hasEnv && hasMethod) console.log(`[Auth:Env] Agent supports ${methodId} but ${envVar} is missing`);
      }

      if (hasEnv && hasMethod) {
        if (verbose) console.log(`[Auth:Env] Auto-selected ${methodId} via ${envVar}`);
        return { methodId };
      }
    }

    // Fallback: if only one method, return it
    if (authMethods.length === 1) {
      const method = authMethods[0];
      // Skip fallback if it's a terminal auth type, as it needs special handling in AutoStrategy
      const isTerminal = method.type === "terminal" || (method._meta && method._meta["terminal-auth"]);
      
      if (!isTerminal) {
        if (verbose) console.log(`[Auth:Env] Only one method available, auto-selecting: ${method.id}`);
        return { methodId: method.id };
      }
    }

    if (verbose) console.log("[Auth:Env] No matching environment variables found for supported methods");
    return null;
  }
}
