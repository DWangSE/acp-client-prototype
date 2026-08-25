import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Commands that fetch published artifacts (wheels, sdists, lock resolution).
 * Intentionally does not match local `python -m py_compile` / pytest.
 */
export const PACKAGE_INDEX_FETCH_RE =
  /\b(?:pip3?\b[\s\S]{0,160}\b(?:download|install|wheel)\b|python[0-9.]*\s+-m\s*pip\b[\s\S]{0,160}\b(?:download|install|wheel)\b|python[0-9.]*\s+-mpip\b[\s\S]{0,200}\b(?:download|install|wheel)\b|uv\s+(?:pip|add|sync|lock)\b|poetry\s+(?:add|install|update)\b|conda\s+(?:install|fetch)\b)\b/i;

/**
 * In-process download helpers. Kept off `import requests` so local verification
 * of the psf/requests tree still works.
 */
export const SCRIPT_NETWORK_RE =
  /\b(?:from\s+urllib|import\s+urllib|urllib\.request|urlretrieve|urlopen|http\.client|import\s+httpx|import\s+aiohttp|urllib3|socket\.create_connection)\b|\brequests\.(?:get|post|put|patch|delete|head|request|Session)\s*\(/i;

/** files-only NSS so systemd-resolved cannot bypass the stub resolv.conf. */
export const OFFLINE_NSSWITCH = `passwd: files
group: files
shadow: files
hosts: files
networks: files
protocols: files
services: files
`;

export const OFFLINE_RESOLV_CONF = `nameserver 0.0.0.0
options timeout:1 attempts:1
`;

function hostnameFromUrl(raw?: string): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const host = url.hostname.trim().toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}

function isLiteralIp(host: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  // URL.hostname strips brackets from IPv6 literals.
  return host.includes(":");
}

function parseExtraAllowHosts(): string[] {
  const raw = process.env.ACP_PROCESS_SANDBOX_ALLOW_HOSTS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  } catch (error) {
    throw new Error(
      `Invalid ACP_PROCESS_SANDBOX_ALLOW_HOSTS_JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/** Hostnames the jailed agent may resolve. Everything else must fail DNS. */
export function offlineAllowHosts(): string[] {
  const hosts = new Set<string>();
  for (const raw of [process.env.ANTHROPIC_BASE_URL, process.env.OPENAI_BASE_URL]) {
    const host = hostnameFromUrl(raw);
    if (host) hosts.add(host);
  }
  for (const host of parseExtraAllowHosts()) hosts.add(host);
  return [...hosts];
}

export function resolveHostIps(host: string): string[] {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return [];
  if (isLiteralIp(normalized)) return [normalized];
  try {
    const out = execFileSync("getent", ["ahosts", normalized], {
      encoding: "utf8",
      timeout: 8_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ips = new Set<string>();
    for (const line of out.split("\n")) {
      const ip = line.trim().split(/\s+/)[0];
      if (ip) ips.add(ip);
    }
    return [...ips];
  } catch {
    return [];
  }
}

/**
 * /etc/hosts for an offline jail: localhost plus pre-resolved API allowlist.
 * Gold hosts (PyPI, GitHub, mirrors, HuggingFace) are omitted so `hosts: files`
 * NSS cannot resolve them.
 */
export function renderOfflineJailHosts(allow = offlineAllowHosts()): string {
  const lines = ["127.0.0.1 localhost", "::1 localhost ip6-localhost ip6-loopback"];
  for (const host of allow) {
    const normalized = host.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") {
      continue;
    }
    if (isLiteralIp(normalized)) {
      lines.push(`${normalized} ${host}`);
      continue;
    }
    const ips = resolveHostIps(normalized);
    if (ips.length === 0) {
      throw new Error(`ACP_PROCESS_SANDBOX could not resolve allow-listed API host: ${host}`);
    }
    for (const ip of ips) lines.push(`${ip} ${host}`);
  }
  return `${lines.join("\n")}\n`;
}

/** @deprecated Use renderOfflineJailHosts. Kept for in-flight callers. */
export function renderPackageIndexJailHosts(): string {
  return renderOfflineJailHosts();
}

export function writeOfflineDnsFiles(): { hosts: string; resolv: string; nsswitch: string } {
  const dir = join(tmpdir(), "acp-process-sandbox-dns");
  mkdirSync(dir, { recursive: true });
  const hosts = join(dir, "hosts");
  const resolv = join(dir, "resolv.conf");
  const nsswitch = join(dir, "nsswitch.conf");
  writeFileSync(hosts, renderOfflineJailHosts(), "utf8");
  writeFileSync(resolv, OFFLINE_RESOLV_CONF, "utf8");
  writeFileSync(nsswitch, OFFLINE_NSSWITCH, "utf8");
  return { hosts, resolv, nsswitch };
}

/** @deprecated Use writeOfflineDnsFiles. */
export function writePackageIndexJailHostsFile(): string {
  return writeOfflineDnsFiles().hosts;
}
