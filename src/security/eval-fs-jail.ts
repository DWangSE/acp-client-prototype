import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface ProcessSandboxSpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface WrapProcessSandboxInput {
  command: string;
  args?: string[];
  cwd?: string;
  jailRoot: string;
  env?: Record<string, string | undefined>;
  /** When true, run `command` via `bash -lc` inside the jail (for ACP terminal). */
  shellCommand?: boolean;
}

function envFlagEnabled(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function processSandboxEnabled(): boolean {
  return envFlagEnabled("ACP_PROCESS_SANDBOX");
}

export function resolveProcessSandboxRoot(explicit?: string): string | undefined {
  const fromArg = explicit?.trim();
  if (fromArg) return resolve(fromArg);
  const fromEnv = process.env.ACP_PROCESS_SANDBOX_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);
  return undefined;
}

export function resolveBwrapPath(): string {
  const fromEnv = process.env.ACP_PROCESS_SANDBOX_BWRAP?.trim();
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`ACP_PROCESS_SANDBOX_BWRAP does not exist: ${fromEnv}`);
    }
    return fromEnv;
  }
  for (const candidate of ["/usr/bin/bwrap", "/bin/bwrap"]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "ACP_PROCESS_SANDBOX=1 requires bubblewrap (bwrap), but it was not found on PATH"
  );
}

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function pushRoBind(args: string[], hostPath: string, guestPath = hostPath): void {
  if (!existsSync(hostPath)) return;
  args.push("--ro-bind-try", hostPath, guestPath);
}

function pushBind(args: string[], hostPath: string, guestPath = hostPath): void {
  ensureDir(hostPath);
  args.push("--bind", hostPath, guestPath);
}

function pushTmpfs(args: string[], guestPath: string): void {
  args.push("--tmpfs", guestPath);
}

function listPythonPackageDirs(): string[] {
  const dirs: string[] = [];
  const roots = ["/usr/lib", "/usr/local/lib"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith("python")) continue;
      for (const leaf of ["dist-packages", "site-packages"]) {
        const candidate = join(root, entry.name, leaf);
        if (existsSync(candidate)) dirs.push(candidate);
      }
    }
  }
  // Common non-/usr install prefixes that may still be reachable via binds.
  for (const candidate of [
    "/usr/local/python3.9/lib/python3.9/site-packages",
    "/usr/local/python3.10/lib/python3.10/site-packages",
    "/usr/local/python3.11/lib/python3.11/site-packages",
    "/usr/local/python3.12/lib/python3.12/site-packages",
  ]) {
    if (existsSync(candidate)) dirs.push(candidate);
  }
  return [...new Set(dirs)];
}

function resolveDnsFiles(): string[] {
  const files = ["/etc/resolv.conf", "/etc/nsswitch.conf", "/etc/hosts"];
  const out: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    out.push(file);
    try {
      const real = realpathSync(file);
      if (real !== file && existsSync(real)) out.push(real);
    } catch {
      // ignore broken symlinks
    }
  }
  return [...new Set(out)];
}

function resolveNodeMounts(): { binds: Array<[string, string]>; pathPrefix: string } {
  const binds: Array<[string, string]> = [];
  const execPath = process.execPath;
  binds.push([execPath, execPath]);

  const binDir = dirname(execPath);
  for (const name of ["npm", "npx", "claude", "corepack", "node"]) {
    const candidate = join(binDir, name);
    if (existsSync(candidate)) binds.push([candidate, candidate]);
  }

  // npm/npx/claude are usually symlinks into this tree.
  const nodeModules = join(dirname(binDir), "lib", "node_modules");
  if (existsSync(nodeModules)) binds.push([nodeModules, nodeModules]);

  // Fallback for non-/usr/local layouts: also try the well-known prefix.
  if (binDir !== "/usr/local/bin") {
    for (const name of ["node", "npm", "npx", "claude"]) {
      const candidate = join("/usr/local/bin", name);
      if (existsSync(candidate)) binds.push([candidate, candidate]);
    }
    if (existsSync("/usr/local/lib/node_modules")) {
      binds.push(["/usr/local/lib/node_modules", "/usr/local/lib/node_modules"]);
    }
  }

  const unique = new Map<string, string>();
  for (const [host, guest] of binds) unique.set(guest, host);
  return {
    binds: [...unique.entries()].map(([guest, host]) => [host, guest]),
    pathPrefix: `${binDir}:/usr/local/bin:/usr/bin:/bin`,
  };
}

function resolveNpmCacheDir(): string {
  const fromEnv = process.env.ACP_PROCESS_SANDBOX_NPM_CACHE?.trim();
  if (fromEnv) return ensureDir(resolve(fromEnv));
  return ensureDir(join(tmpdir(), "acp-process-sandbox-npm-cache"));
}

function resolveJailHomeDir(jailRoot: string): string {
  const fromEnv = process.env.ACP_PROCESS_SANDBOX_HOME?.trim();
  if (fromEnv) return ensureDir(resolve(fromEnv));
  const digest = Buffer.from(jailRoot).toString("base64url").slice(0, 24);
  return ensureDir(join(tmpdir(), "acp-process-sandbox-homes", digest));
}

function parseExtraRoBinds(): string[] {
  const raw = process.env.ACP_PROCESS_SANDBOX_EXTRA_RO_BINDS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
    return parsed.filter((part): part is string => typeof part === "string" && existsSync(part));
  } catch (error) {
    throw new Error(
      `Invalid ACP_PROCESS_SANDBOX_EXTRA_RO_BINDS_JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function parseImmutableWorkspacePaths(root: string): string[] {
  const raw = process.env.ACP_PROCESS_SANDBOX_RO_PATHS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
    return parsed.flatMap((part) => {
      if (typeof part !== "string" || !part.trim()) return [];
      const candidate = resolve(root, part);
      const relative = candidate.slice(root.length);
      if (candidate !== root && !relative.startsWith("/")) return [];
      return existsSync(candidate) ? [candidate] : [];
    });
  } catch (error) {
    throw new Error(
      `Invalid ACP_PROCESS_SANDBOX_RO_PATHS_JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Build a bubblewrap spawn that can see only:
 * - minimal RO OS/runtime mounts needed to run node/claude
 * - the current evaluation workspace (RW)
 * - private HOME + npm cache
 *
 * Paths outside the workspace are not mounted unless the caller explicitly
 * provides a read-only bind.
 */
export function buildProcessSandboxArgs(jailRoot: string): string[] {
  const root = resolve(jailRoot);
  if (!existsSync(root)) {
    throw new Error(`Eval FS jail root does not exist: ${root}`);
  }

  const args: string[] = [
    "--unshare-all",
    "--share-net",
    "--die-with-parent",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/var/tmp",
    "--tmpfs",
    "/home",
    "--tmpfs",
    "/root",
  ];

  pushRoBind(args, "/usr");
  pushRoBind(args, "/lib");
  pushRoBind(args, "/lib64");
  pushRoBind(args, "/bin");
  pushRoBind(args, "/sbin");
  pushRoBind(args, "/etc/ssl");
  pushRoBind(args, "/etc/passwd");
  pushRoBind(args, "/etc/group");
  for (const dns of resolveDnsFiles()) {
    pushRoBind(args, dns);
  }

  if (envFlagEnabled("ACP_PROCESS_SANDBOX_HIDE_PYTHON_PACKAGES")) {
    for (const pkgDir of listPythonPackageDirs()) {
      pushTmpfs(args, pkgDir);
    }
  }

  const nodeMounts = resolveNodeMounts();
  for (const [host, guest] of nodeMounts.binds) {
    pushRoBind(args, host, guest);
  }

  for (const extra of parseExtraRoBinds()) {
    pushRoBind(args, extra);
  }

  const npmCache = resolveNpmCacheDir();
  const jailHome = resolveJailHomeDir(root);
  pushBind(args, npmCache);
  pushBind(args, jailHome, jailHome);
  // Keep the workspace at the same absolute path so session cwd / prompts stay valid.
  args.push("--bind", root, root);
  for (const immutablePath of parseImmutableWorkspacePaths(root)) {
    pushRoBind(args, immutablePath);
  }

  args.push("--setenv", "HOME", jailHome);
  args.push("--setenv", "TMPDIR", "/tmp");
  args.push("--setenv", "TMP", "/tmp");
  args.push("--setenv", "TEMP", "/tmp");
  args.push("--setenv", "npm_config_cache", npmCache);
  args.push("--setenv", "PATH", nodeMounts.pathPrefix);
  args.push("--setenv", "ACP_PROCESS_SANDBOX_ACTIVE", "1");
  // Avoid leaking the real host home into tools that expand ~ before jail checks.
  args.push("--unsetenv", "USERPROFILE");
  args.push("--chdir", root);

  return args;
}

export function wrapSpawnForProcessSandbox(
  input: WrapProcessSandboxInput
): ProcessSandboxSpawnSpec {
  const jailRoot = resolve(input.jailRoot);
  const bwrap = resolveBwrapPath();
  const jailArgs = buildProcessSandboxArgs(jailRoot);

  const baseEnv = { ...(input.env ?? {}) };
  baseEnv.HOME = undefined; // forced by bwrap --setenv
  baseEnv.npm_config_cache = undefined;
  baseEnv.ACP_PROCESS_SANDBOX_ACTIVE = "1";

  if (input.shellCommand) {
    return {
      command: bwrap,
      args: [...jailArgs, "--", "/bin/bash", "-lc", input.command],
      cwd: jailRoot,
      env: baseEnv,
    };
  }

  const command = input.command;
  const args = input.args ?? [];
  // Resolve bare commands like `npx` against the jail PATH prefix.
  const resolvedCommand =
    command.includes("/") || command.startsWith(".")
      ? command
      : ([
          join(dirname(process.execPath), command),
          `/usr/local/bin/${command}`,
          `/usr/bin/${command}`,
          `/bin/${command}`,
        ].find((candidate) => existsSync(candidate)) ?? command);

  return {
    command: bwrap,
    args: [...jailArgs, "--", resolvedCommand, ...args],
    cwd: jailRoot,
    env: baseEnv,
  };
}

/** Best-effort probe used by ablation startup checks. */
export function assertProcessSandboxAvailable(jailRoot: string): void {
  resolveBwrapPath();
  const root = resolve(jailRoot);
  ensureDir(root);
  // Touch mounts that must exist for agent startup.
  resolveNpmCacheDir();
  resolveJailHomeDir(root);
}
