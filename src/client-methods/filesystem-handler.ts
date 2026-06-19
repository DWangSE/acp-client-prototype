import { ClientMethodHandler } from "./interface.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PermissionDeniedError } from "../core/errors.js";

export class FileSystemHandler implements ClientMethodHandler {
  constructor(private readonly baseDir: string) {}

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
    const fullPath = this.resolvePath(dirPath);
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
    const fullPath = this.resolvePath(filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    return { content };
  }

  private async writeFile(filePath: string, content: string) {
    const fullPath = this.resolvePath(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    return {};
  }

  private resolvePath(filePath: string): string {
    const resolved = path.resolve(this.baseDir, filePath);
    if (!resolved.startsWith(this.baseDir)) {
      throw new PermissionDeniedError(
        `Access denied: path ${filePath} is outside of base directory`
      );
    }
    return resolved;
  }
}
