import { a8PluginGetStore, a8PluginSend, hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { PLATFORMS } from "../shared/platforms";
import { pbHostsFromAccounts } from "./accountHosts";
import { resolvePbAccountVenueMemberId } from "./auth";

/** [changmen 扩展] 官网活标签 tabId；优先按账号快速填充 referer/gateway 查页 */
let cachedTabId: number | undefined;

export function getPbTabIdCached(): number | undefined {
  return cachedTabId;
}

export function setPbTabIdCached(tabId: number | undefined) {
  cachedTabId = tabId;
}

export function parsePbTabIdFromStore(response: unknown): number | undefined {
  if (typeof response === "number") return parsePbLiveTabId(response);
  const root = response as { data?: Record<string, unknown>; response?: { data?: Record<string, unknown> } };
  const direct = root?.data?.[PLATFORMS.PB];
  if (typeof direct === "number") return parsePbLiveTabId(direct);
  const nested = root?.response?.data?.[PLATFORMS.PB];
  if (typeof nested === "number") return parsePbLiveTabId(nested);
  return undefined;
}

/** getPbLiveTab 只认正整数 tabId，避免误用上次 setTab(PB) 的别的皮肤 */
let lastPbLiveTabDebug: unknown;

export function takePbLiveTabDebug(): unknown {
  const debug = lastPbLiveTabDebug;
  lastPbLiveTabDebug = undefined;
  return debug;
}

export function parsePbLiveTabId(response: unknown): number | undefined {
  if (typeof response === "number") {
    if (!Number.isFinite(response) || response <= 0)
      return undefined;
    return response;
  }
  if (response && typeof response === "object") {
    const bag = response as { tabId?: unknown; debug?: unknown };
    if (bag.debug !== undefined)
      lastPbLiveTabDebug = bag.debug;
    return parsePbLiveTabId(bag.tabId);
  }
  return undefined;
}

export async function readPbTabIdFromPlugin(
  account?: Pick<PlatformAccount, "referer" | "gateway" | "provider" | "token" | "venueMemberId">,
): Promise<number | undefined> {
  if (!hasA8PluginRuntime()) return undefined;
  try {
    const hosts = account ? pbHostsFromAccounts([account]) : [];
    if (hosts.length && account) {
      const venueMemberId = resolvePbAccountVenueMemberId(account);
      const live = await a8PluginSend({
        type: "getPbLiveTab",
        data: {
          hosts,
          ...(venueMemberId ? { venueMemberId } : {}),
        },
      });
      const fromQuery = parsePbLiveTabId(live);
      cachedTabId = fromQuery;
      return fromQuery;
    }
    const response = await a8PluginGetStore(PLATFORMS.PB);
    const tabId = parsePbTabIdFromStore(response);
    cachedTabId = tabId;
    return tabId;
  }
  catch {
    cachedTabId = undefined;
    return undefined;
  }
}

export function isPbTabMiss(raw: unknown): boolean {
  const msg = raw instanceof Error
    ? raw.message
    : typeof raw === "string"
      ? raw
      : raw && typeof raw === "object" && "message" in raw
        ? String((raw as { message: unknown }).message)
        : "";
  return /标签页通信失败|Could not establish connection|Receiving end does not exist|活会话|host mismatch/i.test(msg);
}

/** 活标签无应答 / 关页 / 序列化空 Error：回退冻结核，不要当成余额成功 */
export function isPbLiveTabDead(raw: unknown): boolean {
  if (raw == null) return true;
  if (isPbTabMiss(raw)) return true;
  return typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0;
}

/** 标签页 axios 失败会变成字符串；不是 miss 时要原样抛出，禁止再用冻结核重试 */
export function pbLiveTabHardError(raw: unknown): Error | undefined {
  if (typeof raw === "string" && raw && !isPbTabMiss(raw))
    return new Error(raw);
  return undefined;
}

/**
 * F5 空窗重试间隔（首次立即，再跟这些 delay）。
 * 测试可改成 `[0]` 以免真睡。
 */
export const pbLiveTabRetryDelaysMs: number[] = [250, 600, 1200, 2000];

/** 活标签暂时不可用：余额层当瞬时失败，不要 TOKEN ERROR，也不要用过期冻结核 */
export const PB_LIVE_TAB_UNAVAILABLE = "PB 官网标签页暂时不可用";
