import { ClientMethodHandler } from "./interface.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { RequestError } from "@agentclientprotocol/sdk";
import { WorkspaceBoundary } from "../security/workspace-boundary.js";

export class FileSystemHandler implements ClientMethodHandler {
  private readonly boundary: WorkspaceBoundary;

  constructor(baseDir: string) {
    this.boundary = new WorkspaceBoundary(baseDir);
  }

  async handle(method: string, params: any): Promise<any> {
    switch (method) {
      case "fs/read_text_file":
        return await this.readFile(params.path);
      case "fs/write_text_file":
        return await this.writeFile(params.path, params.content);
      case "fs/list_directory":
        return await this.listDirectory(params.path);
      default:
        throw new Error(`Unsupported FS method: ${method}`);
    }
  }

  private async listDirectory(dirPath: string) {
    const fullPath = await this.boundary.resolveExisting(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return {
      entries: entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      })),
    };
  }

  private async readFile(filePath: string) {
    try {
      const fullPath = await this.boundary.resolveExisting(filePath);
      const content = await fs.readFile(fullPath, "utf-8");
      return { content };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw RequestError.resourceNotFound(filePath);
      }
      throw err;
    }
  }

  private async writeFile(filePath: string, content: string) {
    const fullPath = await this.boundary.resolveWritable(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    return {};
  }
}
