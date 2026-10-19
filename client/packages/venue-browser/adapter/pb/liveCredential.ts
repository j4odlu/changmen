import { a8PluginGetStore, hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import {
  parsePbVenueIdentity,
  pbAccountUsesLiveTab,
  pbVenueMemberIdsEqual,
  resolvePbAccountVenueMemberId,
} from "./auth";

/** 扩展 storage：part888 页写入的活 localStorage 快照（与 GetConfig.token 同形） */
export const PB_LIVE_CREDENTIAL_STORE_KEY = "PB_LIVE_CREDENTIAL";

export interface PbLiveCredential {
  token: string;
  gateway?: string;
  referer?: string;
  capturedAt?: number;
}

function pbHost(raw: string | undefined): string {
  if (!raw) return "";
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
    return host;
  }
  catch {
    return String(raw).replace(/^www\./i, "").toLowerCase();
  }
}

export function parsePbLiveCredential(response: unknown): PbLiveCredential | undefined {
  const root = response as {
    data?: Record<string, unknown>;
    response?: { data?: Record<string, unknown> };
  };
  const nested = root?.data?.[PB_LIVE_CREDENTIAL_STORE_KEY]
    ?? root?.response?.data?.[PB_LIVE_CREDENTIAL_STORE_KEY];
  const bag = (nested && typeof nested === "object"
    ? nested
    : (root?.data && typeof root.data.token === "string" ? root.data : root)) as Record<string, unknown> | undefined;
  if (!bag || typeof bag !== "object")
    return undefined;
  const token = typeof bag.token === "string" ? bag.token : "";
  if (!token.trim())
    return undefined;
  return {
    token,
    gateway: typeof bag.gateway === "string" ? bag.gateway : undefined,
    referer: typeof bag.referer === "string" ? bag.referer : undefined,
    capturedAt: typeof bag.capturedAt === "number" ? bag.capturedAt : undefined,
  };
}

/**
 * [changmen 扩展] 把官网活快照写进账号 token。
 * 515 / 会员不一致 / 站点不一致：不写，避免破坏 A8 k0 或串号。
 * 绑定 ID 已知但页面解析不出，也不写。
 */
export function applyPbLiveCredentialToAccount(
  account: Pick<PlatformAccount, "token" | "gateway" | "referer" | "venueMemberId">,
  cred: PbLiveCredential,
): boolean {
  if (!pbAccountUsesLiveTab(account))
    return false;
  if (!pbAccountUsesLiveTab({ token: cred.token }))
    return false;

  const liveId = parsePbVenueIdentity(cred.token)?.venueMemberId || "";
  const accId = resolvePbAccountVenueMemberId(account);
  if (accId && (!liveId || !pbVenueMemberIdsEqual(liveId, accId)))
    return false;

  const accHost = pbHost(account.gateway);
  const liveHost = pbHost(cred.gateway);
  if (accHost && liveHost && accHost !== liveHost)
    return false;

  let changed = false;
  if (account.token !== cred.token) {
    account.token = cred.token;
    changed = true;
  }
  if (cred.gateway && account.gateway !== cred.gateway) {
    account.gateway = cred.gateway;
    changed = true;
  }
  if (cred.referer && account.referer !== cred.referer) {
    account.referer = cred.referer;
    changed = true;
  }
  return changed;
}

let lastApplyAt = 0;
const APPLY_MIN_MS = 8_000;

export async function applyPbLiveCredentialFromPlugin(
  account: PlatformAccount,
): Promise<boolean> {
  if (!pbAccountUsesLiveTab(account) || !hasA8PluginRuntime())
    return false;
  const now = Date.now();
  if (now - lastApplyAt < APPLY_MIN_MS)
    return false;
  try {
    const response = await a8PluginGetStore(PB_LIVE_CREDENTIAL_STORE_KEY);
    const cred = parsePbLiveCredential(response);
    if (!cred)
      return false;
    const changed = applyPbLiveCredentialToAccount(account, cred);
    lastApplyAt = now;
    return changed;
  }
  catch {
    return false;
  }
}

export function resetPbLiveCredentialApplyClockForTest() {
  lastApplyAt = 0;
}
