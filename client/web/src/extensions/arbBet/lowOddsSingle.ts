import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ViewBet, ViewMatch } from "@/models/match";
import { readPrematchProbability } from "@/shared/pmPrematchProbability";

/** [changmen 扩展] LOS 仅筛选已选定的低赔腿；不能改下另一腿或消耗盘口次数。 */
export function explainLowOddsCProbabilityRejection(bet: ViewBet, match: ViewMatch, target: BetOption["target"]): string | null {
  const prefix = "LOS C 行过滤：";
  if (bet.marketCode || !(bet.round >= 0)) return `${prefix}当前盘口无 C 行`;
  const pm = bet.items.find(item => item.type === "Polymarket");
  if (!pm) return `${prefix}当前盘口无 PM C 行数据`;
  const result = readPrematchProbability(pm.homeId, pm.awayId, match.pmPrematch);
  if (result.status !== "ready") {
    const reasons = { waiting: "等待 VPS 历史价", pending: "等待登记开赛时间", missing: "暂无有效历史数据", error: "VPS 查询失败" };
    return `${prefix}${reasons[result.status]}`;
  }
  const { home, away } = result.value;
  if (home === away) return `${prefix}主客赛前概率相同（${home.toFixed(1)}%）`;
  if (target !== "Home" && target !== "Away") return `${prefix}无法确定实际下单方向`;
  const selected = target === "Home" ? home : away;
  const opposite = target === "Home" ? away : home;
  return selected > opposite ? null : `${prefix}低赔腿 ${selected.toFixed(1)}%，低于对侧 ${opposite.toFixed(1)}%`;
}

/** [changmen 扩展] 仅在双腿预检成功后调用；newOdds 是场馆确认价，缺失时沿用冻结赔率。 */
export function lowOddsExecutionSide(a: BetOption, b: BetOption): "A" | "B" | null {
  const odds = (leg: BetOption) => Number(leg.newOdds) > 0 ? Number(leg.newOdds) : Number(leg.odds);
  const x = odds(a), y = odds(b);
  if (![x, y].every(n => Number.isFinite(n) && n > 1) || Math.abs(x - y) <= 1e-9)
    return null;
  return x < y ? "A" : "B";
}

export function lowOddsMarketKeys(owner: string, match: ViewMatch, bet: ViewBet, legs: BetOption[]): string[] {
  if (!owner || !Number.isFinite(match.id) || !Number.isFinite(bet.id))
    return [];
  const keys = [`row:${match.id}:${bet.id}`];
  for (const leg of legs) {
    if (leg.type && leg.matchId && leg.betId)
      keys.push(`source:${leg.type}:${leg.matchId}:${leg.betId}`);
  }
  return [...new Set(keys.map(key => JSON.stringify([owner, key])))];
}

const STORAGE_KEY = "LowOddsSingleSubmitted:v1";
const LOCK_KEY = "changmen:low-odds-single-submit:v1";

function readSubmitted(): Set<string> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return new Set();
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some(key => typeof key !== "string"))
    throw new Error("🎯 盘口次数记录异常，暂停提交");
  return new Set(parsed);
}

/** 存储不可用时阻止新增提交；不以空集合覆盖损坏的次数记录。 */
export function lowOddsMarketSubmitted(keys: string[]): boolean {
  if (!keys.length) return true;
  try {
    const used = readSubmitted();
    return keys.some(key => used.has(key));
  }
  catch { return true; }
}

/**
 * [changmen 扩展] 同浏览器各标签页串行领取提交资格；领取后永不因拒单/未知结果释放。
 * 锁内只写提交标记，不等待场馆网络。若在领取后崩溃，保守保留一次名额。
 */
export async function claimLowOddsMarket(keys: string[]): Promise<boolean> {
  if (!keys.length || typeof navigator === "undefined" || !navigator.locks)
    throw new Error("🎯 当前浏览器不支持安全的盘口次数锁，未提交");
  return navigator.locks.request(LOCK_KEY, () => {
    const used = readSubmitted();
    if (keys.some(key => used.has(key))) return false;
    for (const key of keys) used.add(key);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...used]));
    return true;
  });
}
