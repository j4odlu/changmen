import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { AccountHttpOptions } from "@changmen/client-core/shared/platformHttp";
import { buildTfAccountHeaders, tfGatewayUrl } from "./auth";
import { accountHttpRequest, parseJsonLoose } from "@changmen/client-core/shared/platformHttp";

export type TfAccountHttpOptions = AccountHttpOptions & {
  /** 对齐 A8 ly(account, !0)：合并 tf-authorization / public-token */
  signed?: boolean;
};

/** TF 账号 HTTP：默认 ly(account) 无签名；getOrders 等传 signed: true */
export async function accountTfGet<T = unknown>(
  account: PlatformAccount,
  path: string,
  opts?: TfAccountHttpOptions,
): Promise<{ status: number; data: T }> {
  if (!account.gateway || !account.token)
    return { status: 401, data: {} as T };
  const url = tfGatewayUrl(account.gateway, path);
  const headers = await buildTfAccountHeaders(account.token, { signed: opts?.signed });
  const { status, text } = await accountHttpRequest(
    account,
    url,
    { method: "GET", headers },
    opts?.forceDirect ?? false,
  );
  return { status, data: parseJsonLoose(text) as T };
}

export async function accountTfPost<T = unknown>(
  account: PlatformAccount,
  path: string,
  body: unknown,
  opts?: TfAccountHttpOptions,
): Promise<{ status: number; data: T }> {
  if (!account.gateway || !account.token)
    return { status: 401, data: {} as T };
  const url = tfGatewayUrl(account.gateway, path);
  const headers = await buildTfAccountHeaders(account.token, { signed: opts?.signed });
  const { status, text } = await accountHttpRequest(
    account,
    url,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    },
    opts?.forceDirect ?? false,
  );
  return { status, data: parseJsonLoose(text) as T };
}
