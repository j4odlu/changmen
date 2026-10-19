import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import { resolvePlanCnyFromVenueStake } from "@changmen/venue-browser/adapter/adaptation";
import { PLATFORMS } from "@changmen/venue-browser/adapter/shared";

/** [A8 可证实] Ly 使用成功腿 option 的金额/odds，不改用实单或 newOdds。
 * [changmen 扩展] PM/PF 仅把场馆金额换回队列使用的 CNY。
 */
export function resolveMakeUpSuccessReference(
  leg: BetOption,
  _venueOrders: VenueOrder[],
  _rejected: boolean,
  account?: PlatformAccount,
  _successOrderId?: string | null,
): { betMoney: number; betOdds: number } {
  const raw = Math.round(Number(leg.betMoney) || 0);
  const betMoney = account && (
    leg.type === PLATFORMS.Polymarket || leg.type === PLATFORMS.PredictFun
  )
    ? resolvePlanCnyFromVenueStake(account, Number(leg.betMoney) || 0)
    : raw;
  const betOdds = Number(leg.odds) || 0;
  return { betMoney, betOdds };
}
