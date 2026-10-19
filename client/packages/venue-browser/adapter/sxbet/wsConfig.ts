import { changmenHttpBaseToWs } from "../shared/changmenWsBase";
import { resolveMarketHubHttpOrigin } from "@changmen/client-core/shared/hkRelayOrigin";

export const SXBET_WS_FORWARD_PATH = "/esport/ws-forward/SXBET-MARKET";

function changmenSxBetWsUrl(path: string): string {
  const base = changmenHttpBaseToWs(resolveMarketHubHttpOrigin());
  return `${base}${path}`;
}

/** SXBet Market WS：VPS hub（apiKey 仅服务端） */
export function resolveSxBetMarketWsUrl(): string {
  return changmenSxBetWsUrl(SXBET_WS_FORWARD_PATH);
}
