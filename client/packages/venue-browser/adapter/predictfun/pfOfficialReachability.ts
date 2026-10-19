import { PREDICT_FUN_API, PREDICT_FUN_WS } from "./api";
import { resolvePredictFunApiKey } from "./transport";

export const PF_OFFICIAL_PROBE_TIMEOUT_MS = 5_000;

export type PredictFunOfficialProbeResult = {
  reachable: boolean;
  httpOk: boolean;
  marketWsOk: boolean;
};

function officialWsProbeUrl(): string {
  const apiKey = resolvePredictFunApiKey();
  if (!apiKey)
    return PREDICT_FUN_WS;
  const url = new URL(PREDICT_FUN_WS);
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

export async function probePredictFunOfficialHttp(
  timeoutMs = PF_OFFICIAL_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof fetch !== "function")
    return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const apiKey = resolvePredictFunApiKey();
    if (apiKey)
      headers["x-api-key"] = apiKey;
    // 轻量公开端：tags；CORS 可能失败，仅作诊断
    const res = await fetch(`${PREDICT_FUN_API}/v1/tags?first=1`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers,
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

export function probePredictFunOfficialMarketWs(
  timeoutMs = PF_OFFICIAL_PROBE_TIMEOUT_MS,
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
      ws = new WebSocket(officialWsProbeUrl());
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

/** 官方 Market WS 可达则认为可直连；httpOk 仅诊断（页面 fetch 可能被 CORS 挡） */
export async function probePredictFunOfficialReachable(
  timeoutMs = PF_OFFICIAL_PROBE_TIMEOUT_MS,
): Promise<PredictFunOfficialProbeResult> {
  const [httpOk, marketWsOk] = await Promise.all([
    probePredictFunOfficialHttp(timeoutMs),
    probePredictFunOfficialMarketWs(timeoutMs),
  ]);
  return {
    reachable: marketWsOk,
    httpOk,
    marketWsOk,
  };
}
