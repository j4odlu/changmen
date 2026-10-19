import { resolveHkRelayHttpOrigin, resolveMarketHubHttpOrigin } from "@changmen/client-core/shared/hkRelayOrigin";
import { getChangmenAuthToken } from "../shared/changmenAuthToken";
import { changmenHttpBaseToWs } from "../shared/changmenWsBase";
import { POLYMARKET_MARKET_WS, POLYMARKET_USER_WS } from "./api";
import { getPmMarketWsSourceMode } from "./pmMarketWsMode";
import { getPmUserWsSourceMode } from "./pmUserWsMode";

export const PM_MARKET_WS_FORWARD_PATH = "/esport/ws-forward/PM-MARKET";
export const PM_USER_WS_FORWARD_PATH = "/esport/ws-forward/PM-USER";

function changmenPmWsUrl(path: string, withAuthToken = false, hub = false): string {
  const httpOrigin = hub ? resolveMarketHubHttpOrigin() : resolveHkRelayHttpOrigin();
  const base = changmenHttpBaseToWs(httpOrigin);
  const url = `${base}${path}`;
  if (!withAuthToken)
    return url;
  const token = getChangmenAuthToken();
  if (!token)
    return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/** relay 尽量带 JWT（健康页归属）；无 token 仍返回 URL，避免断采。 */
export function resolvePolymarketMarketWsUrl(): string {
  if (getPmMarketWsSourceMode() === "official") return POLYMARKET_MARKET_WS;
  return changmenPmWsUrl(PM_MARKET_WS_FORWARD_PATH, true, true);
}

export function resolvePolymarketUserWsUrl(): string {
  if (getPmUserWsSourceMode() === "official") return POLYMARKET_USER_WS;
  return changmenPmWsUrl(PM_USER_WS_FORWARD_PATH);
}
