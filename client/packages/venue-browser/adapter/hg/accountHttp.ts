import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { accountHttpRequest, parseJsonLoose, type AccountHttpOptions } from "@changmen/client-core/shared/platformHttp";

export async function accountHgPost<T = unknown>(
  account: PlatformAccount,
  targetUrl: string,
  body: string,
  headers: Record<string, string>,
  opts?: AccountHttpOptions,
): Promise<{ status: number; data: T }> {
  const { status, text } = await accountHttpRequest(
    account,
    targetUrl,
    {
      method: "POST",
      body,
      headers,
    },
    opts?.forceDirect ?? false,
  );
  return { status, data: parseJsonLoose(text) as T };
}
