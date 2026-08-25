import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { writeOfflineDnsFiles } from "./package-index-block.js";

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

/**
 * Debian/Ubuntu usr-merge makes /lib -> usr/lib (and /bin -> usr/bin).
 * `--ro-bind /lib /lib` follows the symlink and creates a *second* mount of
 * the same tree, so a later `--tmpfs /usr/lib/python3/dist-packages` does not
 * hide `/lib/python3/dist-packages`. Recreate the host symlink inside the jail
 * instead of bind-mounting the target twice.
 */
function usrMergeSymlinkTarget(guestPath: string): string | undefined {
  try {
    if (!lstatSync(guestPath).isSymbolicLink()) return undefined;
  } catch {
    return undefined;
  }
  const target = readlinkSync(guestPath);
  const normalized = target.replace(/\/+$/, "");
  const allowed = new Set([
    "usr/bin",
    "usr/sbin",
    "usr/lib",
    "usr/lib64",
    "/usr/bin",
    "/usr/sbin",
    "/usr/lib",
    "/usr/lib64",
  ]);
  return allowed.has(normalized) ? target : undefined;
}

function pushUsrMergeOrRoBind(args: string[], guestPath: string): void {
  if (!existsSync(guestPath)) return;
  const symlinkTarget = usrMergeSymlinkTarget(guestPath);
  if (symlinkTarget) {
    args.push("--symlink", symlinkTarget, guestPath);
    return;
  }
  pushRoBind(args, guestPath);
}

function collectPythonPackageDirsUnder(root: string, dirs: string[]): void {
  if (!existsSync(root)) return;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.name.startsWith("python")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    for (const leaf of ["dist-packages", "site-packages"]) {
      const candidate = join(root, entry.name, leaf);
      if (existsSync(candidate)) dirs.push(candidate);
    }
  }
}

function listPythonPackageDirs(): string[] {
  const dirs: string[] = [];
  // Include usr-merge aliases (/lib vs /usr/lib) as distinct guest paths.
  for (const root of ["/usr/lib", "/usr/lib64", "/usr/local/lib", "/lib", "/lib64"]) {
    collectPythonPackageDirsUnder(root, dirs);
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

function parseHidePaths(): string[] {
  const raw = process.env.ACP_PROCESS_SANDBOX_HIDE_PATHS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
    return parsed.filter((part): part is string => typeof part === "string" && part.length > 0);
  } catch (error) {
    throw new Error(
      `Invalid ACP_PROCESS_SANDBOX_HIDE_PATHS_JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/** Host trees that can serve as an unofficial gold-source for SWE-EVO repos. */
const DEFAULT_ORACLE_TREES = ["/usr/local/aegis", "/opt/aegis"];

export function listHostOracleHideDirs(): string[] {
  const dirs = [
    ...listPythonPackageDirs(),
    ...DEFAULT_ORACLE_TREES.filter((dir) => existsSync(dir)),
    ...parseHidePaths().filter((dir) => existsSync(dir)),
  ];
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

/**
 * Native Claude (and getpwuid) ignore $HOME and read /etc/passwd, which maps
 * uid 0 to /root. An empty tmpfs on /root hides eval Claude settings even
 * when ACP_PROCESS_SANDBOX_HOME is set. Bind the jail home over /root and
 * force HOME/CLAUDE_CONFIG_DIR there.
 */
const JAIL_PASSWD_HOME = "/root";
const JAIL_CLAUDE_CONFIG_DIR = "/root/.claude";

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
 *
 * Network namespaces stay shared (`--share-net`) so the model API can reach
 * ANTHROPIC_BASE_URL. When ACP_DENY_NETWORK_TOOLS=1, DNS is default-deny
 * (`hosts: files` + stub resolv.conf): only pre-resolved API allowlist hosts
 * work. HOME is an ephemeral tmpfs so wheels cannot persist across instances.
 * pip is forced offline (`PIP_NO_INDEX`). Memory, embeddings, and Postgres stay
 * in the backend process outside this jail.
 */
export function buildProcessSandboxArgs(jailRoot: string): string[] {
  const root = resolve(jailRoot);
  if (!existsSync(root)) {
    throw new Error(`Eval FS jail root does not exist: ${root}`);
  }

  const denyNetwork = envFlagEnabled("ACP_DENY_NETWORK_TOOLS");
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
  ];

  pushRoBind(args, "/usr");
  // usr-merge: recreate /lib -> usr/lib (etc.) instead of a second bind of /usr/lib.
  pushUsrMergeOrRoBind(args, "/lib");
  pushUsrMergeOrRoBind(args, "/lib64");
  pushUsrMergeOrRoBind(args, "/bin");
  pushUsrMergeOrRoBind(args, "/sbin");
  pushRoBind(args, "/etc/ssl");
  pushRoBind(args, "/etc/passwd");
  pushRoBind(args, "/etc/group");
  for (const dns of resolveDnsFiles()) {
    pushRoBind(args, dns);
  }

  if (envFlagEnabled("ACP_PROCESS_SANDBOX_HIDE_PYTHON_PACKAGES")) {
    const seenReal = new Set<string>();
    for (const pkgDir of listHostOracleHideDirs()) {
      let guest = pkgDir;
      try {
        guest = realpathSync(pkgDir);
      } catch {
        // Hide the lexical path even if realpath fails.
      }
      if (seenReal.has(guest)) continue;
      seenReal.add(guest);
      pushTmpfs(args, guest);
    }
  }

  const nodeMounts = resolveNodeMounts();
  for (const [host, guest] of nodeMounts.binds) {
    pushRoBind(args, host, guest);
  }

  for (const extra of parseExtraRoBinds()) {
    pushRoBind(args, extra);
  }

  const jailHome = resolveJailHomeDir(root);
  ensureDir(join(jailHome, ".claude"));
  const npmCacheGuest = denyNetwork ? "/tmp/npm-cache" : resolveNpmCacheDir();
  if (denyNetwork) {
    // Empty HOME for the process lifetime. Do not bind the host eval Claude
    // home — a shared $HOME is how wheels leaked across instances.
    pushTmpfs(args, JAIL_PASSWD_HOME);
    args.push("--dir", JAIL_CLAUDE_CONFIG_DIR);
    const settings = join(jailHome, ".claude", "settings.json");
    if (existsSync(settings)) {
      args.push("--ro-bind", settings, join(JAIL_CLAUDE_CONFIG_DIR, "settings.json"));
    }
    args.push("--dir", npmCacheGuest);
  } else {
    pushBind(args, npmCacheGuest);
    pushBind(args, jailHome, jailHome);
    // Overlay passwd home so native Claude sees eval settings, not an empty tmpfs.
    pushBind(args, jailHome, JAIL_PASSWD_HOME);
  }
  // Keep the workspace at the same absolute path so session cwd / prompts stay valid.
  args.push("--bind", root, root);
  for (const immutablePath of parseImmutableWorkspacePaths(root)) {
    pushRoBind(args, immutablePath);
  }

  args.push("--setenv", "HOME", JAIL_PASSWD_HOME);
  args.push("--setenv", "CLAUDE_CONFIG_DIR", JAIL_CLAUDE_CONFIG_DIR);
  args.push("--setenv", "TMPDIR", "/tmp");
  args.push("--setenv", "TMP", "/tmp");
  args.push("--setenv", "TEMP", "/tmp");
  args.push("--setenv", "npm_config_cache", npmCacheGuest);
  args.push("--setenv", "PATH", nodeMounts.pathPrefix);
  args.push("--setenv", "ACP_PROCESS_SANDBOX_ACTIVE", "1");
  // Avoid leaking the real host home into tools that expand ~ before jail checks.
  args.push("--unsetenv", "USERPROFILE");
  args.push("--chdir", root);
  applyOfflineNetworkBlock(args);

  return args;
}

function applyOfflineNetworkBlock(args: string[]): void {
  if (!envFlagEnabled("ACP_DENY_NETWORK_TOOLS")) return;
  const dns = writeOfflineDnsFiles();
  args.push("--ro-bind", dns.hosts, "/etc/hosts");
  args.push("--ro-bind", dns.resolv, "/etc/resolv.conf");
  args.push("--ro-bind", dns.nsswitch, "/etc/nsswitch.conf");
  args.push("--setenv", "PIP_NO_INDEX", "1");
  args.push("--setenv", "PIP_DISABLE_PIP_VERSION_CHECK", "1");
  args.push("--setenv", "UV_NO_INDEX", "1");
}

export function wrapSpawnForProcessSandbox(
  input: WrapProcessSandboxInput
): ProcessSandboxSpawnSpec {
  const jailRoot = resolve(input.jailRoot);
  const bwrap = resolveBwrapPath();
  const jailArgs = buildProcessSandboxArgs(jailRoot);

  const baseEnv = { ...(input.env ?? {}) };
  baseEnv.HOME = undefined; // forced by bwrap --setenv
  baseEnv.CLAUDE_CONFIG_DIR = undefined;
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
