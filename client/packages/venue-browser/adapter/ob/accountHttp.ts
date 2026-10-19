import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { accountHttpRequest, type AccountHttpOptions } from "@changmen/client-core/shared/platformHttp";

/** 对齐 A8 `b0(account)`：GET 也带 form Content-Type */
function obHeaders(account: PlatformAccount): Record<string, string> {
  const mobile = Boolean(account.userAgent && /mobile/i.test(account.userAgent));
  const base: Record<string, string> = {
    "device": mobile ? "2" : "1",
    "lang": "cn",
    "token": account.token || "",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
  if (account.userAgent)
    base["User-Agent"] = account.userAgent;
  if (account.referer)
    base.Referer = account.referer;
  return base;
}

function obUrl(account: PlatformAccount, path: string): string {
  if (!account.gateway)
    throw new Error("账号未配置 gateway");
  return `${account.gateway.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function jsonErrorMessage(status: number, text: string): string {
  let message = text.slice(0, 160) || `HTTP ${status}`;
  if (text.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { error?: string; msg?: string };
      message = parsed.msg || parsed.error || message;
    }
    catch {
      /* keep text slice */
    }
  }
  return message;
}

export async function accountGet<T = unknown>(
  account: PlatformAccount,
  path: string,
  opts?: AccountHttpOptions,
): Promise<T> {
  const res = await accountHttpRequest(
    account,
    obUrl(account, path),
    { method: "GET", headers: obHeaders(account) },
    opts?.forceDirect ?? false,
  );
  if (res.status >= 400)
    throw new Error(jsonErrorMessage(res.status, res.text));
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
    obUrl(account, path),
    {
      method: "POST",
      headers: obHeaders(account),
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
