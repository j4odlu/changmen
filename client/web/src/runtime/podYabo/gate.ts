/**
 * 同场同向拦截。对齐 AutoYabo evaluateOutcomeGate：大小同向不加仓、反向不对冲；
 * 让球同队不加仓、对侧拦截。独赢不拦。只看已下/在途，不把未下警报写进闸门。
 */
import type { PodMarketSide } from "@/runtime/podMarketMatch";

export type PodOutcomeMarketType = "Total" | "HDP" | "ML";
export type PodOutcomeDecision = "ALLOW" | "DUPLICATE" | "REVERSE";

export type PodOutcomeGateEntry = {
  obMid: string;
  marketCode: string;
  boardSide: PodMarketSide | null;
};

export type PodOutcomeGateResult = {
  allow: boolean;
  decision: PodOutcomeDecision;
  reason: string;
};

function marketType(code: string): PodOutcomeMarketType | null {
  const raw = String(code || "").toLowerCase();
  if (raw === "totals" || raw === "ht_totals")
    return "Total";
  if (raw === "spreads" || raw === "ht_spreads")
    return "HDP";
  if (raw === "moneyline" || raw === "ht_moneyline")
    return "ML";
  return null;
}

function periodTag(code: string): "HT" | "FT" {
  return String(code || "").toLowerCase().startsWith("ht_") ? "HT" : "FT";
}

/** [changmen 扩展] 同场同市场的执行范围；双向共用，独赢沿用不拦截规则。 */
export function podOutcomeExecutionScope(entry: PodOutcomeGateEntry): string {
  const type = marketType(entry.marketCode);
  return entry.obMid && type && type !== "ML" ? `${entry.obMid}|${periodTag(entry.marketCode)}|${type}` : "";
}

function ouSide(side: PodMarketSide | null): "over" | "under" | null {
  if (side === "over" || side === "under")
    return side;
  return null;
}

function hdpSide(side: PodMarketSide | null): "home" | "away" | null {
  if (side === "home" || side === "away")
    return side;
  return null;
}

function sameMatch(left: PodOutcomeGateEntry, right: PodOutcomeGateEntry): boolean {
  const a = String(left.obMid || "").trim();
  const b = String(right.obMid || "").trim();
  return !!a && a === b;
}

export function evaluatePodOutcomeGate(
  candidate: PodOutcomeGateEntry,
  placed: Iterable<PodOutcomeGateEntry>,
): PodOutcomeGateResult {
  const want = marketType(candidate.marketCode);
  const period = periodTag(candidate.marketCode);
  if (!want || !String(candidate.obMid || "").trim())
    return { allow: true, decision: "ALLOW", reason: "不同市场，可执行交易" };
  if (want === "ML")
    return { allow: true, decision: "ALLOW", reason: "独赢不拦截" };
  for (const row of placed) {
    if (!sameMatch(candidate, row))
      continue;
    if (marketType(row.marketCode) !== want)
      continue;
    if (periodTag(row.marketCode) !== period)
      continue;
    if (want === "Total") {
      const a = ouSide(candidate.boardSide);
      const b = ouSide(row.boardSide);
      if (!a || !b)
        continue;
      if (a === b)
        return { allow: false, decision: "DUPLICATE", reason: `同向拦截加仓(${a})` };
      return { allow: false, decision: "REVERSE", reason: `拦截反向对冲(${b} ↔ ${a})` };
    }
    const a = hdpSide(candidate.boardSide);
    const b = hdpSide(row.boardSide);
    if (!a || !b)
      continue;
    if (a === b)
      return { allow: false, decision: "DUPLICATE", reason: `同向拦截加仓(${a})` };
    return { allow: false, decision: "REVERSE", reason: `反向拦截对冲(${b} ↔ ${a})` };
  }
  return { allow: true, decision: "ALLOW", reason: "不同市场，可执行交易" };
}

export function podOutcomeGateEntryFrom(
  ticket: {
    obMid?: string;
    market?: Pick<PodOutcomeGateEntry, "marketCode" | "boardSide">;
    marketCode?: string;
    boardSide?: PodMarketSide | null;
  },
): PodOutcomeGateEntry {
  return {
    obMid: String(ticket.obMid || "").trim(),
    marketCode: String(ticket.market?.marketCode || ticket.marketCode || "").trim(),
    boardSide: ticket.market?.boardSide ?? ticket.boardSide ?? null,
  };
}
