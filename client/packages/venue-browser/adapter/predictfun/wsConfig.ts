import { changmenHttpBaseToWs } from "../shared/changmenWsBase";
import { resolveMarketHubHttpOrigin } from "@changmen/client-core/shared/hkRelayOrigin";

import { PREDICT_FUN_WS } from "./api";
import { getPfMarketWsSourceMode } from "./pfMarketWsMode";
import { resolvePredictFunApiKey } from "./transport";

export const PREDICT_FUN_WS_FORWARD_PATH = "/esport/ws-forward/PREDICTFUN-MARKET";

function changmenPredictWsUrl(path: string): string {
  const base = changmenHttpBaseToWs(resolveMarketHubHttpOrigin());
  return `${base}${path}`;
}

/** 官方 Market WS；主网建议带 apiKey（与 VPS hub 上游一致） */
export function resolvePredictFunOfficialMarketWsUrl(): string {
  const apiKey = resolvePredictFunApiKey();
  if (!apiKey)
    return PREDICT_FUN_WS;
  const url = new URL(PREDICT_FUN_WS);
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

/** Predict.fun Market WS：official 直连 / changmen ws-forward hub */
export function resolvePredictFunMarketWsUrl(): string {
  if (getPfMarketWsSourceMode() === "official")
    return resolvePredictFunOfficialMarketWsUrl();
  return changmenPredictWsUrl(PREDICT_FUN_WS_FORWARD_PATH);
}
