import type { BetOption } from "@changmen/client-core/models/betOption";
import { getVenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import { getPolymarketPmSportBlockReasonFromOption } from "../../../pmSportGuard";

/** [changmen 扩展] 动态 FOK 只消费本地已知否决信息；价格及整笔深度由本轮 /book 判断。 */
export function resolveOptimizedFokBlockReason(option: BetOption): string | null {
  const local = getPolymarketPmSportBlockReasonFromOption(option);
  if (local) return local;
  if (getVenueOddsEntry("Polymarket", option.itemId)?.isLock) return "PM 当前盘口已锁定，请新建投注尝试";
  return null;
}
