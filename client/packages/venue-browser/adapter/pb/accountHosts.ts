/**
 * [changmen 扩展] 从 PB 投注账号 referer（否则 gateway）取主机。
 * 不改 A8 ACCOUNT 形状；只读已有字段。
 */

const HOSTS_GATE_KEY = "__CM_PB_ACCOUNT_HOSTS__";

type HostsHost = typeof globalThis & { [HOSTS_GATE_KEY]?: string[] };

function hostsHost(): HostsHost {
  return globalThis as HostsHost;
}

export function pbHostFromUrl(raw?: string): string | undefined {
  const text = String(raw || "").trim();
  if (!text)
    return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return host || undefined;
  }
  catch {
    return undefined;
  }
}

export function normalizePbAccountHosts(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const host = pbHostFromUrl(typeof item === "string" ? item : String(item || ""));
    if (!host || seen.has(host))
      continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

export function pbHostsFromAccounts(
  accounts: Array<{ provider?: string; referer?: string; gateway?: string }>,
): string[] {
  const raw: string[] = [];
  for (const acc of accounts || []) {
    if (String(acc?.provider || "").toUpperCase() !== "PB")
      continue;
    const host = pbHostFromUrl(acc.referer) || pbHostFromUrl(acc.gateway);
    if (host)
      raw.push(host);
  }
  return normalizePbAccountHosts(raw);
}

export function hostnameMatchesPbAccountHosts(hostname: string, hosts: string[]): boolean {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!h)
    return false;
  for (const host of hosts) {
    if (h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`))
      return true;
  }
  return false;
}

export function setPbAccountPageHosts(hosts: string[]): void {
  hostsHost()[HOSTS_GATE_KEY] = normalizePbAccountHosts(hosts);
}

export function hasPbAccountPageHostsBeenSet(): boolean {
  return Array.isArray(hostsHost()[HOSTS_GATE_KEY]);
}

export function getPbAccountPageHosts(): string[] {
  return normalizePbAccountHosts(hostsHost()[HOSTS_GATE_KEY] || []);
}

export function resetPbAccountPageHostsForTests(): void {
  delete hostsHost()[HOSTS_GATE_KEY];
}
