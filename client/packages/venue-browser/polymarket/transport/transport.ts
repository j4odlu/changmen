/** Polymarket Gamma/CLOB REST — 经 pmTransport 按 mode 分流（direct / vps / extension） */

import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { pmTransportHttpGet, pmTransportHttpPost } from "./pmTransport";

const PLUGIN_TIMEOUT_MS = 60_000;

/** Polymarket REST GET */
export async function polymarketPluginGet<T>(
  url: string,
  options?: {
    headers?: Record<string, string>;
    timeout?: number;
    withCredentials?: boolean;
    account?: PlatformAccount;
    l2Path?: string;
  },
): Promise<T> {
  void PLUGIN_TIMEOUT_MS;
  void options?.timeout;
  void options?.withCredentials;
  return pmTransportHttpGet<T>(url, options);
}

/** Polymarket REST POST */
export async function polymarketPluginPost<T>(
  url: string,
  data: unknown,
  options?: {
    headers?: Record<string, string>;
    account?: PlatformAccount;
    l2Path?: string;
  },
): Promise<T> {
  return pmTransportHttpPost<T>(url, data, options);
}

/** 采集/下注 HTTP 在 vps 模式下需登录 changmen；direct/extension 另论 */
export function isPolymarketHttpTransportReady(): boolean {
  return true;
}

/** L2 GET */
export async function polymarketL2Get<T>(
  account: PlatformAccount,
  url: string,
  l2Path: string,
): Promise<T> {
  return polymarketPluginGet<T>(url, { account, l2Path });
}

/** L2 POST */
export async function polymarketL2Post<T>(
  account: PlatformAccount,
  url: string,
  l2Path: string,
  data: unknown,
  _bodyForSignature?: string,
): Promise<T> {
  return polymarketPluginPost<T>(url, data, { account, l2Path });
}
