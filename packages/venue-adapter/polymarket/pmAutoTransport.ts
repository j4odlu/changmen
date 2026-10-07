import { probeGamebetExtension } from "@changmen/client-core/chrome-plugin/bridge";
import { reportVenueWsMeta } from "../shared/venueWsStatus";
import { getPmMarketWsSourceMode, setPmMarketWsSourceMode, type PmMarketWsSourceMode } from "./pmMarketWsMode";
import {
  probePolymarketClobViaExtension,
  probePolymarketOfficialReachable,
} from "./pmOfficialReachability";
import { setPmHttpMode, type PmHttpMode } from "./pmTransportMode";
import { getPmUserWsSourceMode, setPmUserWsSourceMode, type PmUserWsSourceMode } from "./pmUserWsMode";
import {
  applyPmRoutingPreference,
  getPmRoutingPreference,
  type PmRoutingPreference,
} from "./pmRoutingPreference";

const PM_TRANSPORT_MANUAL_OVERRIDE_KEY = "changmen:pm:transport-manual-override";

export type PmAutoTransportApplyResult = {
  applied: boolean;
  skippedManualOverride: boolean;
  reachable: boolean;
  httpMode: PmHttpMode;
  marketWsMode: PmMarketWsSourceMode;
  userWsMode: PmUserWsSourceMode;
  routingPreference: PmRoutingPreference;
};

const routingListeners = new Set<(result: PmAutoTransportApplyResult) => void>();

function readManualOverride(): boolean {
  try {
    return globalThis.localStorage?.getItem(PM_TRANSPORT_MANUAL_OVERRIDE_KEY) === "1";
  }
  catch {
    return false;
  }
}

export function isPmTransportManualOverride(): boolean {
  return readManualOverride();
}

export function markPmTransportManualOverride(): void {
  try {
    globalThis.localStorage?.setItem(PM_TRANSPORT_MANUAL_OVERRIDE_KEY, "1");
  }
  catch {
    /* ignore */
  }
}

export function clearPmTransportManualOverride(): void {
  try {
    globalThis.localStorage?.removeItem(PM_TRANSPORT_MANUAL_OVERRIDE_KEY);
  }
  catch {
    /* ignore */
  }
}

/** @internal vitest */
export function resetPmTransportManualOverrideForTests(): void {
  clearPmTransportManualOverride();
}

export function onPmAutoTransportApplied(
  listener: (result: PmAutoTransportApplyResult) => void,
): () => void {
  routingListeners.add(listener);
  return () => routingListeners.delete(listener);
}

function notifyRoutingApplied(result: PmAutoTransportApplyResult) {
  for (const listener of routingListeners)
    listener(result);
}

/**
 * 角标切到官方 WS 时，才允许 REST 走插件：
 * 插件在线 + 实测 CLOB /time。登录自动路由不再调用本函数。
 */
export async function resolveHttpModeForManualOfficialWs(): Promise<PmHttpMode> {
  const extension = await probeGamebetExtension();
  if (!extension)
    return "vps";
  const clobOk = await probePolymarketClobViaExtension();
  return clobOk ? "extension" : "vps";
}

/**
 * 角标切换 Market WS 时同步 HTTP（用户显式覆盖，不是登录自动升 extension）：
 * - changmen → 强制 vps
 * - official → 再测插件 CLOB，通才 extension
 */
export async function syncPmHttpModeWithMarketWs(
  marketWsMode: PmMarketWsSourceMode,
): Promise<PmHttpMode> {
  const httpMode = marketWsMode === "changmen"
    ? "vps"
    : await resolveHttpModeForManualOfficialWs();
  setPmHttpMode(httpMode);
  return httpMode;
}

async function applyModes(
  marketWsOk: boolean,
): Promise<Omit<PmAutoTransportApplyResult, "applied" | "skippedManualOverride" | "reachable" | "routingPreference"> & { reachable: boolean }> {
  // 查询 HTTP 默认 VPS（官网模式可直连优先）；下单出口由独立偏好决定。
  setPmHttpMode("vps");

  if (marketWsOk) {
    setPmMarketWsSourceMode("official");
    setPmUserWsSourceMode("official");
    return {
      reachable: true,
      httpMode: "vps",
      marketWsMode: "official",
      userWsMode: "official",
    };
  }

  setPmMarketWsSourceMode("changmen");
  setPmUserWsSourceMode("changmen");
  return {
    reachable: false,
    httpMode: "vps",
    marketWsMode: "changmen",
    userWsMode: "changmen",
  };
}

/**
 * 登录后：按用户偏好选择 PM WS。
 * - auto：探测官方 Market WS；可达则 official，不可达则 CHANGMEN relay
 * - official / relay：用户强制选择，不做探测
 * - 查询 HTTP 默认 VPS；不覆盖独立保存的本地/VPS 下单选择
 */
export async function applyPmAutoTransportOnLogin(): Promise<PmAutoTransportApplyResult> {
  const routingPreference = getPmRoutingPreference();
  if (routingPreference !== "auto") {
    setPmHttpMode("vps");
    const mode = applyPmRoutingPreference(routingPreference) ?? getPmMarketWsSourceMode();
    reportVenueWsMeta("pm-market", {
      sourceMode: mode,
      reason: `user_${routingPreference}`,
      routingPreference,
      lastError: "",
    });
    const result: PmAutoTransportApplyResult = {
      applied: false,
      skippedManualOverride: true,
      reachable: mode === "official",
      httpMode: "vps",
      marketWsMode: getPmMarketWsSourceMode(),
      userWsMode: getPmUserWsSourceMode(),
      routingPreference,
    };
    notifyRoutingApplied(result);
    return result;
  }

  const probe = await probePolymarketOfficialReachable();
  const modes = await applyModes(probe.marketWsOk);
  reportVenueWsMeta("pm-market", {
    sourceMode: modes.marketWsMode,
    routingPreference: "auto",
    reason: probe.marketWsOk ? "official_ok" : "official_timeout",
    lastError: probe.marketWsOk ? "" : "official market ws probe failed",
  });
  const result: PmAutoTransportApplyResult = {
    applied: true,
    skippedManualOverride: false,
    routingPreference: "auto",
    ...modes,
  };
  notifyRoutingApplied(result);
  if (import.meta.env?.DEV) {
    console.info("[PM transport] auto route on login", {
      marketWsOk: probe.marketWsOk,
      httpOk: probe.httpOk,
      ...modes,
    });
  }
  return result;
}

/** logout 时只清除旧版手动覆盖；新版 official/relay 用户偏好长期保留 */
export function resetPmTransportRoutingOnLogout(): void {
  clearPmTransportManualOverride();
}
