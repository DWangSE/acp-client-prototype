import { ClientMethodHandler } from "./interface.js";
import { select } from "@inquirer/prompts";
import { invalidParams, methodNotFound } from "./error-utils.js";

export class PermissionHandler implements ClientMethodHandler {
  constructor(private readonly autoApprove: boolean = false) {}

  async handle(method: string, params: any): Promise<any> {
    if (method === "session/request_permission") {
      const title = params.title || params.toolCall?.title || "Permission Request";
      const message = params.message || params.toolCall?.description || "";
      const options = params.options || [];

      if (!Array.isArray(options) || options.length === 0) {
        throw invalidParams("session/request_permission requires at least one option", {
          options,
        });
      }

      if (this.autoApprove) {
        return {
          outcome: {
            outcome: "selected",
            optionId: options[0].optionId,
          },
        };
      }

      console.log(`\n[Permission Request] ${title}`);
      if (message) console.log(message);

      let choice: string;
      try {
        choice = await select({
          message: "Choose an action:",
          choices: options.map((o: any) => ({
            name: o.name || o.label || o.optionId,
            value: o.optionId,
          })),
        });
      } catch {
        return {
          outcome: {
            outcome: "cancelled",
          },
        };
      }

      return {
        outcome: {
          outcome: "selected",
          optionId: choice,
        },
      };
    }
    throw methodNotFound(method);
  }
}
