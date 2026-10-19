import type { PmMarketWsSourceMode } from "./pmMarketWsMode";
/**
 * 体育 MARKET WS URL（独立于电竞 `wsConfig.ts`，避免改电竞文件）。
 */
import { resolveMarketHubHttpOrigin } from "@changmen/client-core/shared/hkRelayOrigin";
import { getChangmenAuthToken } from "../shared/changmenAuthToken";
import { changmenHttpBaseToWs } from "../shared/changmenWsBase";
import { POLYMARKET_MARKET_WS } from "./api";
import { getPmMarketWsSourceMode } from "./pmMarketWsMode";

export const PM_SPORT_MARKET_WS_FORWARD_PATH = "/esport/ws-forward/PM-SPORT-MARKET";

function changmenSportPmWsUrl(path: string, withAuthToken = false): string {
  const base = changmenHttpBaseToWs(resolveMarketHubHttpOrigin());
  const url = `${base}${path}`;
  if (!withAuthToken)
    return url;
  const token = getChangmenAuthToken();
  if (!token)
    return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * 足球复用电竞已完成的官方可达性判断，但只读 mode：
 * official → 浏览器直连 PM；changmen → 独立 PM-SPORT relay。
 * 不写电竞 mode、不复用电竞 WS singleton。
 */
export function resolvePolymarketSportMarketWsUrl(
  mode: PmMarketWsSourceMode = getPmMarketWsSourceMode(),
): string {
  if (mode === "official")
    return POLYMARKET_MARKET_WS;
  return changmenSportPmWsUrl(PM_SPORT_MARKET_WS_FORWARD_PATH, true);
}
