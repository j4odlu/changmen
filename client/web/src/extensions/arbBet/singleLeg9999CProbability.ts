import type { BetSide, ViewBet, ViewMatch } from "@/models/match";
import { readPrematchProbability } from "@/shared/pmPrematchProbability";

/** [changmen 扩展] 复用 C 行同盘口、同 token 的赛前概率；返回真下单腿被过滤的原因。 */
export function explain9999CProbabilityRejection(
  bet: ViewBet,
  match: ViewMatch,
  target: BetSide | undefined,
): string | null {
  const prefix = "9999 C 行过滤：";
  if (bet.marketCode || !(bet.round >= 0))
    return `${prefix}当前盘口无 C 行`;
  const pm = bet.items.find(item => item.type === "Polymarket");
  if (!pm)
    return `${prefix}当前盘口无 PM C 行数据`;
  const result = readPrematchProbability(pm.homeId, pm.awayId, match.pmPrematch);
  if (result.status !== "ready") {
    const reasons = {
      waiting: "等待 VPS 历史价",
      pending: "等待登记开赛时间",
      missing: "暂无有效历史数据",
      error: "VPS 查询失败",
    };
    return `${prefix}${reasons[result.status]}`;
  }
  const { home, away } = result.value;
  if (home === away)
    return `${prefix}主客赛前概率相同（${home.toFixed(1)}%）`;
  if (!target)
    return `${prefix}无法确定实际下单方向`;
  const live = target === "Home" ? home : away;
  const opposite = target === "Home" ? away : home;
  return live > opposite ? null
    : `${prefix}实际下单${target === "Home" ? "主队" : "客队"} ${live.toFixed(1)}%，低于对侧 ${opposite.toFixed(1)}%`;
}
