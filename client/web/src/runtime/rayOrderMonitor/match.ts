import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import type {
  RayOrderCandidate,
  RayOrderMatchResult,
  RayOrderContext,
} from "./types";

const MAX_ORDER_TIME_DRIFT_MS = 120_000;
const MIN_MATCH_SCORE = 10;
const MIN_UNIQUE_MARGIN = 3;

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\b(vs|v)\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function textMatches(expected: string, actual: string): boolean {
  const left = normalizeText(expected);
  const right = normalizeText(actual);
  if (!left || !right)
    return false;
  return left === right || left.includes(right) || right.includes(left);
}

function scoreCandidate(task: RayOrderContext, order: VenueOrder): RayOrderCandidate | null {
  if (String(order.provider).toUpperCase() !== "RAY")
    return null;

  const timeDiff = Math.abs((Number(order.createAt) || 0) - task.submittedAt);
  if (!Number(order.createAt) || timeDiff > MAX_ORDER_TIME_DRIFT_MS)
    return null;

  const moneyDiff = Math.abs((Number(order.betMoney) || 0) - task.betMoney);
  const moneyTolerance = Math.max(1, Math.abs(task.betMoney) * 0.02);
  if (moneyDiff > moneyTolerance)
    return null;

  const oddsDiff = Math.abs((Number(order.odds) || 0) - task.odds);
  if (task.odds > 0 && oddsDiff > 0.05)
    return null;

  let score = 0;
  const reasons: string[] = [];

  score += moneyDiff <= 0.01 ? 5 : 3;
  reasons.push(`金额差${moneyDiff.toFixed(2)}`);

  if (task.odds > 0) {
    score += oddsDiff <= 0.011 ? 4 : 2;
    reasons.push(`赔率差${oddsDiff.toFixed(3)}`);
  }

  if (timeDiff <= 10_000)
    score += 4;
  else if (timeDiff <= 60_000)
    score += 3;
  else
    score += 1;
  reasons.push(`时间差${Math.round(timeDiff / 1000)}s`);

  if (textMatches(task.item, order.item)) {
    score += 4;
    reasons.push("选项一致");
  }
  if (textMatches(task.match, order.match)) {
    score += 3;
    reasons.push("比赛一致");
  }
  if (textMatches(task.bet, order.bet)) {
    score += 2;
    reasons.push("盘口一致");
  }

  return { order, score, reasons };
}

/** 只在候选唯一且分数足够时绑定；模糊结果宁可等待，不猜单。 */
export function matchRayVenueOrder(
  task: RayOrderContext,
  orders: readonly VenueOrder[],
): RayOrderMatchResult {
  const candidates = orders
    .map(order => scoreCandidate(task, order))
    .filter((candidate): candidate is RayOrderCandidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score || b.order.createAt - a.order.createAt);

  const best = candidates[0];
  if (!best || best.score < MIN_MATCH_SCORE)
    return { kind: "missing", candidates };

  const second = candidates[1];
  if (second && best.score - second.score < MIN_UNIQUE_MARGIN)
    return { kind: "ambiguous", candidates };

  return { kind: "matched", candidate: best, candidates };
}
