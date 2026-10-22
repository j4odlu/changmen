import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { accountHttpRequest, type AccountHttpOptions } from "@changmen/client-core/shared/platformHttp";

/** [A8 可证实] index0706.js l1：原样发送 account.token，不补前缀或去空格。 */
function rayHeaders(account: PlatformAccount): Record<string, string> {
  return {
    "authorization": account.token!,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
}

function rayUrl(account: PlatformAccount, path: string): string {
  return `${account.gateway}${path.startsWith("/") ? path : `/${path}`}`;
}

/** [A8 可证实] rHe.betting 使用 qs.stringify 的 RFC3986 表单编码（空格为 %20）。 */
function encodeRayFormPart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
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
    { preserveAcceptedResponse: true },
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
      body: Object.entries(body).map(([key, value]) => `${encodeRayFormPart(key)}=${encodeRayFormPart(String(value))}`).join("&"),
    },
    opts?.forceDirect ?? false,
    { preserveAcceptedResponse: true },
  );
  try {
    return JSON.parse(res.text) as T;
  }
  catch {
    throw new Error(`Invalid JSON: ${res.text.slice(0, 120)}`);
  }
}
