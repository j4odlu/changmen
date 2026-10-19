import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { accountHttpRequest, parseJsonLoose, type AccountHttpOptions } from "@changmen/client-core/shared/platformHttp";

function iaHeaders(account: PlatformAccount): Record<string, string> {
  return {
    "token": account.token || "",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
}

function iaUrl(account: PlatformAccount, path: string): string {
  if (!account.gateway)
    throw new Error("账号未配置 gateway");
  return `${account.gateway.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** IA：form POST + token 头（对齐 A8 EYe / Qh） */
export async function accountIaPost<T = unknown>(
  account: PlatformAccount,
  path: string,
  body: string,
  opts?: AccountHttpOptions,
): Promise<T> {
  const res = await accountHttpRequest(
    account,
    iaUrl(account, path),
    {
      method: "POST",
      body,
      headers: iaHeaders(account),
    },
    opts?.forceDirect ?? false,
  );
  return parseJsonLoose(res.text) as T;
}
