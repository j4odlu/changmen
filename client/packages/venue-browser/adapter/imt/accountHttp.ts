import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { accountHttpRequest, parseJsonLoose, type AccountHttpOptions } from "@changmen/client-core/shared/platformHttp";

export async function accountImtPost<T = unknown>(
  account: PlatformAccount,
  targetUrl: string,
  body: string | null,
  headers: Record<string, string>,
  opts?: AccountHttpOptions,
): Promise<{ status: number; data: T }> {
  const { status, text } = await accountHttpRequest(
    account,
    targetUrl,
    {
      method: "POST",
      body: body ?? "",
      headers,
    },
    opts?.forceDirect ?? false,
  );
  return { status, data: parseJsonLoose(text) as T };
}

export async function accountImtPostJson<T = unknown>(
  account: PlatformAccount,
  targetUrl: string,
  body: unknown,
  headers: Record<string, string>,
  opts?: AccountHttpOptions,
): Promise<{ status: number; data: T }> {
  return accountImtPost(account, targetUrl, JSON.stringify(body), {
    "Content-Type": "application/json; charset=UTF-8",
    ...headers,
  }, opts);
}
