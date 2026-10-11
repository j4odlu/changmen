import { a8PluginGet } from "@changmen/client-core/chrome-plugin/bridge";
import {
  POLYMARKET_CLOB_API,
  POLYMARKET_MARKET_WS,
} from "../api";

export const PM_OFFICIAL_PROBE_TIMEOUT_MS = 5_000;

export type PolymarketOfficialProbeResult = {
  reachable: boolean;
  httpOk: boolean;
  marketWsOk: boolean;
};

/** 插件 GET /time 是否像有效 CLOB 时间戳（含 axios-like { data, status }） */
function isClobTimePayload(raw: unknown): boolean {
  if (raw == null)
    return false;
  if (typeof raw === "number")
    return Number.isFinite(raw) && raw > 0;
  if (typeof raw === "string") {
    const n = Number(String(raw).trim());
    return Number.isFinite(n) && n > 0;
  }
  if (typeof raw === "object") {
    // 扩展在 axios 失败时 resolve(err)，不是 reject
    if (raw instanceof Error)
      return false;
    const row = raw as Record<string, unknown>;
    if (typeof row.message === "string" && row.response == null && !("data" in row) && row.status == null)
      return false;
    if ("status" in row) {
      const status = Number(row.status);
      if (Number.isFinite(status) && (status < 200 || status >= 300))
        return false;
    }
    if ("data" in row)
      return isClobTimePayload(row.data);
  }
  return false;
}

/**
 * 经 Chrome 插件实测能否访问 CLOB（比 Market WS onopen 更贴近余额/下单 HTTP）。
 * WS 偶通但本机 REST 不通时，不应选 extension。
 */
export async function probePolymarketClobViaExtension(
  timeoutMs = PM_OFFICIAL_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 超时后仍要吞掉插件 Promise，避免 unhandled rejection
    const pluginPromise = a8PluginGet(`${POLYMARKET_CLOB_API}/time`).catch(() => null);
    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const raw = await Promise.race([pluginPromise, timeoutPromise]);
    return isClobTimePayload(raw);
  }
  catch {
    return false;
  }
  finally {
    if (timer !== undefined)
      clearTimeout(timer);
  }
}

export async function probePolymarketOfficialHttp(
  timeoutMs = PM_OFFICIAL_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof fetch !== "function")
    return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${POLYMARKET_CLOB_API}/time`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    return res.ok;
  }
  catch {
    return false;
  }
  finally {
    clearTimeout(timer);
  }
}

export function probePolymarketOfficialMarketWs(
  timeoutMs = PM_OFFICIAL_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof WebSocket !== "function")
    return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;

    const finish = (ok: boolean) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      }
      catch {
        /* ignore */
      }
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new WebSocket(POLYMARKET_MARKET_WS);
    }
    catch {
      finish(false);
      return;
    }

    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
}

/** 官方 Market WS 可达；httpOk 仅作诊断（页面内 fetch 仍受 CORS 约束，不用于切换 HTTP direct） */
export async function probePolymarketOfficialReachable(
  timeoutMs = PM_OFFICIAL_PROBE_TIMEOUT_MS,
): Promise<PolymarketOfficialProbeResult> {
  const [httpOk, marketWsOk] = await Promise.all([
    probePolymarketOfficialHttp(timeoutMs),
    probePolymarketOfficialMarketWs(timeoutMs),
  ]);
  return {
    reachable: marketWsOk,
    httpOk,
    marketWsOk,
  };
}
