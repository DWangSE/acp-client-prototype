import { ClientMethodHandler } from "./interface.js";
import { select } from "@inquirer/prompts";

const NETWORK_TOOL_RE = /\b(WebFetch|WebSearch|Browser|browser_navigate|browser_search)\b/i;
const NETWORK_BASH_RE =
  /\b(curl|wget|httpie|Invoke-WebRequest|iwr|Fetch)\b|\bgh\s+(api|pr|issue|browse|repo)\b|https?:\/\//i;

function blockInternetEnabled(): boolean {
  const raw = process.env.NEWIDE_SWE_EVO_BLOCK_INTERNET?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function toolLabel(params: any): string {
  return [
    params?.title,
    params?.toolCall?.title,
    params?.toolCall?.kind,
    params?.toolCall?.toolName,
    params?.tool_name,
    params?.message,
    params?.toolCall?.description,
  ]
    .filter((v) => typeof v === "string" && v.length > 0)
    .join("\n");
}

function isNetworkPermissionRequest(params: any): boolean {
  const label = toolLabel(params);
  if (NETWORK_TOOL_RE.test(label)) return true;
  if (/\bBash\b|\bTerminal\b|\bshell\b/i.test(label) && NETWORK_BASH_RE.test(label)) {
    return true;
  }
  // Some agents put the command only in nested rawInput / command fields.
  const nested = JSON.stringify(params?.toolCall ?? params ?? {});
  if (NETWORK_TOOL_RE.test(nested)) return true;
  if (/\b(Bash|Terminal|shell)\b/i.test(label) && NETWORK_BASH_RE.test(nested)) return true;
  return false;
}

function denyOutcome(options: any[]): any {
  const reject = options.find((o: any) =>
    /reject|deny|cancel|abort|no/i.test(`${o?.optionId ?? ""} ${o?.name ?? ""} ${o?.label ?? ""}`)
  );
  if (reject?.optionId) {
    return {
      outcome: {
        outcome: "selected",
        optionId: reject.optionId,
      },
    };
  }
  return {
    outcome: {
      outcome: "cancelled",
    },
  };
}

export class PermissionHandler implements ClientMethodHandler {
  constructor(private readonly autoApprove: boolean = false) {}

  async handle(method: string, params: any): Promise<any> {
    if (method === "session/request_permission") {
      const title = params.title || params.toolCall?.title || "Permission Request";
      const message = params.message || params.toolCall?.description || "";
      const options = params.options || [];

      if (blockInternetEnabled() && isNetworkPermissionRequest(params)) {
        console.error(
          `[Permission Denied][NEWIDE_SWE_EVO_BLOCK_INTERNET] ${title}${
            message ? `: ${String(message).slice(0, 200)}` : ""
          }`
        );
        return denyOutcome(options);
      }

      if (this.autoApprove) {
        return {
          outcome: {
            outcome: "selected",
            optionId: options[0]?.optionId || "proceed_once",
          },
        };
      }

      console.log(`\n[Permission Request] ${title}`);
      if (message) console.log(message);

      const choice = await select({
        message: "Choose an action:",
        choices: options.map((o: any) => ({
          name: o.name || o.label || o.optionId,
          value: o.optionId,
        })),
      });

      return {
        outcome: {
          outcome: "selected",
          optionId: choice,
        },
      };
    }
    throw new Error(`Unsupported permission method: ${method}`);
  }
}
