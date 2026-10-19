/** [A8 可证实] `CYe` 经 `mr.post` + `Cr.http`；无 proxyId / forceDirect 时 `Zn.post`，否则 PROXY relay */

import { a8PluginPost, hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import { accountIaPost } from "./accountHttp";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

export const IA_BET_PLUGIN_REQUIRED_MSG =
  "IA 下注需要 Gamebet 扩展（对齐 A8 Zn）：加载 changmen/chrome-extension，或使用 Electron 启动（内嵌扩展）";

/** A8 `e0(t)` */
export function iaBetHeaders(account: PlatformAccount): Record<string, string> {
  return {
    token: account.token || "",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
}

/** A8 `cy(t,e)` */
export function iaGatewayPath(account: PlatformAccount, path: string): string {
  const base = String(account.gateway ?? "").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function unwrapPluginResponse<T>(response: unknown): T {
  if (response && typeof response === "object" && "data" in response) {
    return (response as { data?: unknown }).data as T;
  }
  return response as T;
}

export type IaMrPostOptions = {
  /** A8 `mr.post` 第 6 参 `!0`：checkBet / getOrders 强制 Zn，不走 PROXY */
  forceDirect?: boolean;
};

/**
 * A8 `mr.post(this.account, url, body, { headers: e0(...) }, Cr.http, forceDirect?)`
 *
 * | proxyId | forceDirect | 通道 |
 * |---------|-------------|------|
 * | 有 | 否 | PROXY（accountIaPost → http-relay + x-proxy-url） |
 * | 无 / 任意 | 是 | Zn（a8PluginPost） |
 * | 无 | 否 | Zn |
 */
export async function iaMrPost<T>(
  account: PlatformAccount,
  path: string,
  body: string,
  opts?: IaMrPostOptions,
): Promise<T> {
  const forceDirect = opts?.forceDirect ?? false;
  if (account.proxyId && !forceDirect) {
    return accountIaPost<T>(account, path, body);
  }
  if (!hasA8PluginRuntime()) {
    throw new Error(IA_BET_PLUGIN_REQUIRED_MSG);
  }
  const url = iaGatewayPath(account, path);
  const raw = await a8PluginPost(url, body, { headers: iaBetHeaders(account) });
  return unwrapPluginResponse<T>(raw);
}
