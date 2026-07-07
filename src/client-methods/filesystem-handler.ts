import { ClientMethodHandler } from "./interface.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  invalidParams,
  mapFsError,
  methodNotFound,
  permissionDenied,
  requireStringParam,
} from "./error-utils.js";

export class FileSystemHandler implements ClientMethodHandler {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  async handle(method: string, params: any): Promise<any> {
    const methodParams = this.requireObjectParams(method, params);

    switch (method) {
      case "fs/read_text_file":
        return await this.readFile(requireStringParam(methodParams, "path", method));
      case "fs/write_text_file":
        return await this.writeFile(
          requireStringParam(methodParams, "path", method),
          requireStringParam(methodParams, "content", method)
        );
      case "fs/list_directory":
        return await this.listDirectory(requireStringParam(methodParams, "path", method));
      default:
        throw methodNotFound(method);
    }
  }

  private async listDirectory(dirPath: string) {
    const fullPath = this.resolvePath(dirPath);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return {
        entries: entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          isFile: e.isFile(),
        })),
      };
    } catch (err) {
      mapFsError(err, dirPath);
    }
  }

  private async readFile(filePath: string) {
    const fullPath = this.resolvePath(filePath);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      return { content };
    } catch (err) {
      mapFsError(err, filePath);
    }
  }

  private async writeFile(filePath: string, content: string) {
    const fullPath = this.resolvePath(filePath);
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
      return {};
    } catch (err) {
      mapFsError(err, filePath);
    }
  }

  private resolvePath(filePath: string): string {
    const resolved = path.resolve(this.baseDir, filePath);
    const relative = path.relative(this.baseDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw permissionDenied(`Access denied: path ${filePath} is outside of base directory`, {
        path: filePath,
        baseDir: this.baseDir,
      });
    }
    return resolved;
  }

  private requireObjectParams(method: string, params: unknown): Record<string, unknown> {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw invalidParams(`${method} requires object params`, { params });
    }

    return params as Record<string, unknown>;
  }
}
