import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { accountHttpRequest, type AccountHttpOptions } from "@changmen/client-core/shared/platformHttp";

export function normalizeRayAuthorization(token: string | undefined): string {
  const raw = String(token || "").trim();
  if (!raw) return "";
  return raw.startsWith("Bearer ") ? raw : `Bearer ${raw}`;
}

/** [A8 可证实] RAY `kw`：仅 authorization + Content-Type */
function rayHeaders(account: PlatformAccount): Record<string, string> {
  return {
    "authorization": normalizeRayAuthorization(account.token),
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
}

function rayUrl(account: PlatformAccount, path: string): string {
  if (!account.gateway)
    throw new Error("账号未配置 gateway");
  return `${account.gateway.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function accountGet<T = unknown>(
  account: PlatformAccount,
  path: string,
  opts?: AccountHttpOptions,
): Promise<T> {
  const res = await accountHttpRequest(
    account,
    rayUrl(account, path),
    { method: "GET", headers: rayHeaders(account) },
    opts?.forceDirect ?? false,
  );
  try {
    return JSON.parse(res.text) as T;
  }
  catch {
    throw new Error(`Invalid JSON: ${res.text.slice(0, 120)}`);
  }
}

export async function accountPostForm<T = unknown>(
  account: PlatformAccount,
  path: string,
  body: Record<string, string | number>,
  opts?: AccountHttpOptions,
): Promise<T> {
  const res = await accountHttpRequest(
    account,
    rayUrl(account, path),
    {
      method: "POST",
      headers: rayHeaders(account),
      body: new URLSearchParams(
        Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])),
      ).toString(),
    },
    opts?.forceDirect ?? false,
  );
  try {
    return JSON.parse(res.text) as T;
  }
  catch {
    throw new Error(`Invalid JSON: ${res.text.slice(0, 120)}`);
  }
}
