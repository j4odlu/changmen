import { getPfMarketWsSourceMode, setPfMarketWsSourceMode, type PfMarketWsSourceMode } from "./pfMarketWsMode";
import { probePredictFunOfficialReachable } from "./pfOfficialReachability";
import { resolvePfHttpMode, setPfHttpMode, type PfHttpMode } from "./pfTransportMode";
import { resolvePredictFunApiKey } from "./transport";

const PF_TRANSPORT_MANUAL_OVERRIDE_KEY = "changmen:pf:transport-manual-override";

export type PfAutoTransportApplyResult = {
  applied: boolean;
  skippedManualOverride: boolean;
  reachable: boolean;
  httpMode: PfHttpMode;
  marketWsMode: PfMarketWsSourceMode;
};

const routingListeners = new Set<(result: PfAutoTransportApplyResult) => void>();

function readManualOverride(): boolean {
  try {
    return globalThis.localStorage?.getItem(PF_TRANSPORT_MANUAL_OVERRIDE_KEY) === "1";
  }
  catch {
    return false;
  }
}

export function isPfTransportManualOverride(): boolean {
  return readManualOverride();
}

export function markPfTransportManualOverride(): void {
  try {
    globalThis.localStorage?.setItem(PF_TRANSPORT_MANUAL_OVERRIDE_KEY, "1");
  }
  catch {
    /* ignore */
  }
}

export function clearPfTransportManualOverride(): void {
  try {
    globalThis.localStorage?.removeItem(PF_TRANSPORT_MANUAL_OVERRIDE_KEY);
  }
  catch {
    /* ignore */
  }
}

/** @internal vitest */
export function resetPfTransportManualOverrideForTests(): void {
  clearPfTransportManualOverride();
}

export function onPfAutoTransportApplied(
  listener: (result: PfAutoTransportApplyResult) => void,
): () => void {
  routingListeners.add(listener);
  return () => routingListeners.delete(listener);
}

function notifyRoutingApplied(result: PfAutoTransportApplyResult) {
  for (const listener of routingListeners)
    listener(result);
}

function applyModes(marketWsOk: boolean): Omit<
  PfAutoTransportApplyResult,
  "applied" | "skippedManualOverride"
> {
  // 主网 REST（含预检 orderbook）强制 x-api-key。浏览器无 VITE_ Key 时勿走 direct，
  // 否则 401 被吞成「orderbook 为空」；改 VPS 中继，由服务端注入 PREDICT_FUN_API_KEY。
  const browserHasApiKey = Boolean(resolvePredictFunApiKey());

  if (marketWsOk && browserHasApiKey) {
    // 对齐 PM：官方 WS 可达则直连行情；HTTP 走浏览器直连官方（无 PF 插件档）
    setPfHttpMode("direct");
    setPfMarketWsSourceMode("official");
    return {
      reachable: true,
      httpMode: "direct",
      marketWsMode: "official",
    };
  }

  if (marketWsOk && !browserHasApiKey) {
    // WS 可官方，但 REST 无 Key → HTTP 仍走 VPS（服务端带 Key）
    setPfHttpMode("vps");
    setPfMarketWsSourceMode("official");
    return {
      reachable: true,
      httpMode: "vps",
      marketWsMode: "official",
    };
  }

  setPfHttpMode("vps");
  setPfMarketWsSourceMode("changmen");
  return {
    reachable: false,
    httpMode: "vps",
    marketWsMode: "changmen",
  };
}

/**
 * 登录后：探测 Predict.fun 官方 Market WS。
 * - 可达：WS 官方 + HTTP direct
 * - 不可达：WS changmen + HTTP vps（http-relay）
 * 用户曾手动点角标切换时跳过（直到 logout 清除）。
 */
export async function applyPfAutoTransportOnLogin(): Promise<PfAutoTransportApplyResult> {
  if (readManualOverride()) {
    return {
      applied: false,
      skippedManualOverride: true,
      reachable: getPfMarketWsSourceMode() === "official",
      httpMode: resolvePfHttpMode(),
      marketWsMode: getPfMarketWsSourceMode(),
    };
  }

  const probe = await probePredictFunOfficialReachable();
  const modes = applyModes(probe.marketWsOk);
  const result: PfAutoTransportApplyResult = {
    applied: true,
    skippedManualOverride: false,
    ...modes,
  };
  notifyRoutingApplied(result);
  if (import.meta.env?.DEV) {
    console.info("[PF transport] auto route on login", {
      marketWsOk: probe.marketWsOk,
      httpOk: probe.httpOk,
      ...modes,
    });
  }
  return result;
}

/** logout 时清除手动覆盖，下次登录重新探测 */
export function resetPfTransportRoutingOnLogout(): void {
  clearPfTransportManualOverride();
}
