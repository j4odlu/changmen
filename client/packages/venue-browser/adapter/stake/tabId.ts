import { a8PluginGetStore, hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import { PLATFORMS } from "../shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";

const GET_STORE_TIMEOUT_MS = 4_000;
const GET_STORE_TIMEOUT = {};

/** 对齐 A8 全局 `qs.tabId` */
let cachedTabId: number | undefined;

export function getStakeTabIdCached(): number | undefined {
  return cachedTabId;
}

export function setStakeTabIdCached(tabId: number | undefined) {
  cachedTabId = tabId;
}

function asTabId(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0)
    return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n > 0)
      return n;
  }
  return undefined;
}

/** 对齐 bundle `XZe`：`getStore(Stake)` → `response.data[Stake]`；兼容 storageGet 直接把 tabId 放在 data */
export function parseStakeTabIdFromStore(response: unknown): number | undefined {
  const fromRoot = asTabId(response);
  if (fromRoot)
    return fromRoot;
  const root = response as { data?: unknown; response?: { data?: unknown } } | null;
  const fromData = asTabId(root?.data) ?? asTabId((root?.data as { Stake?: unknown } | undefined)?.[PLATFORMS.Stake]);
  if (fromData)
    return fromData;
  const nested = root?.response?.data;
  return asTabId(nested) ?? asTabId((nested as { Stake?: unknown } | undefined)?.[PLATFORMS.Stake]);
}

export async function readStakeTabIdFromPlugin(): Promise<number | undefined> {
  if (!hasA8PluginRuntime()) return undefined;
  try {
    const response = await Promise.race([
      a8PluginGetStore(PLATFORMS.Stake),
      wait(GET_STORE_TIMEOUT_MS).then(() => GET_STORE_TIMEOUT),
    ]);
    if (response === GET_STORE_TIMEOUT) return undefined;
    return parseStakeTabIdFromStore(response);
  } catch {
    return undefined;
  }
}

/**
 * 对齐 A8 `HHe`：余额/下注只用当前 `qs.tabId`，不等 10×3s。
 * 采集器仍走 `waitForStakeTabId`。
 */
export async function resolveStakeTabIdNow(): Promise<number | undefined> {
  if (cachedTabId) return cachedTabId;
  const tabId = await readStakeTabIdFromPlugin();
  if (tabId) cachedTabId = tabId;
  return tabId;
}

/** 登录后预取 tabId，减少首次 Stake 采集/下注等待 */
export function primeStakeTabId(): void {
  void readStakeTabIdFromPlugin().then((tabId) => {
    if (tabId) cachedTabId = tabId;
  });
}

/** 对齐 A8 `MQ`：最多 10 次、每次间隔 3s */
export function stakeTabIdHint(): string {
  if (!hasA8PluginRuntime()) {
    return "未安装 Gamebet 扩展；Stake 采集/下注需在 Chrome 中打开 stake.com";
  }
  return "未找到Stake标签页";
}

export async function waitForStakeTabId(maxAttempts = 10, intervalMs = 3000): Promise<number | undefined> {
  if (!hasA8PluginRuntime()) return undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tabId = await readStakeTabIdFromPlugin();
    if (tabId) {
      cachedTabId = tabId;
      return tabId;
    }
    if (attempt < maxAttempts - 1) await wait(intervalMs);
  }
  cachedTabId = undefined;
  return undefined;
}
