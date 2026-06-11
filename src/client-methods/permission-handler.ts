import { ClientMethodHandler } from "./interface.js";
import { select } from "@inquirer/prompts";

export class PermissionHandler implements ClientMethodHandler {
  constructor(private readonly autoApprove: boolean = false) {}

  async handle(method: string, params: any): Promise<any> {
    if (method === "session/request_permission") {
      const title = params.title || params.toolCall?.title || "Permission Request";
      const message = params.message || params.toolCall?.description || "";
      const options = params.options || [];

      if (this.autoApprove) {
        return { 
          outcome: { type: "selected" }, 
          optionId: options[0]?.optionId || "proceed_once" 
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

      // Gemini/ACP V1 expectation: outcome is an object with type: "selected"
      return { 
        outcome: { type: "selected" }, 
        optionId: choice 
      };
    }
    throw new Error(`Unsupported permission method: ${method}`);
  }
}
