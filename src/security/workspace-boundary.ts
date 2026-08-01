import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PermissionDeniedError } from "../core/errors.js";

export class WorkspaceBoundary {
  readonly root: string;
  private readonly realRoot: Promise<string>;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.realRoot = fs.realpath(this.root);
  }

  async resolveExisting(candidate: string): Promise<string> {
    const resolved = this.resolveLexically(candidate);
    const realPath = await fs.realpath(resolved);
    this.assertInside(await this.realRoot, realPath, candidate);
    return resolved;
  }

  async resolveWritable(candidate: string): Promise<string> {
    const resolved = this.resolveLexically(candidate);
    const existingAncestor = await this.findExistingAncestor(resolved);
    const realAncestor = await fs.realpath(existingAncestor);
    this.assertInside(await this.realRoot, realAncestor, candidate);
    return resolved;
  }

  private resolveLexically(candidate: string): string {
    const resolved = path.resolve(this.root, candidate);
    this.assertInside(this.root, resolved, candidate);
    return resolved;
  }

  private async findExistingAncestor(candidate: string): Promise<string> {
    let current = candidate;
    while (true) {
      try {
        await fs.lstat(current);
        return current;
      } catch (error) {
        if (!isMissing(error)) throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        current = parent;
      }
    }
  }

  private assertInside(root: string, candidate: string, requested: string): void {
    const relative = path.relative(root, candidate);
    if (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    ) {
      return;
    }
    throw new PermissionDeniedError(`Access denied: path ${requested} is outside of workspace`);
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
