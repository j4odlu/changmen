import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import type { PmUpSignal } from "./upDetector";
import type { BrowserPmOddsDropSignal } from "./downSettings";
import type { OddsSignal, SignalDirection } from "./presentation";
import { betOddsDropSignals } from "./downMatchSignals";
import { presentDropSignal, presentUpSignal, signedPercent } from "./presentation";

export const SIGNAL_BADGE_TTL_MS = 30_000;
export interface OddsSignalBadge {
  signalId: string;
  direction: SignalDirection;
  role: "source" | "gap" | "arb";
  label: string;
  /** 触发时的赔率变化；仅触发侧展示，不能用后续实时价改写。 */
  movement?: { beforeOdds: number; currentOdds: number };
  title: string;
  detectedAt: number;
}
export const oddsBadgeKey = (item: Pick<ViewBetItem, "type" | "homeId" | "awayId">, side: BetSide): string => (
  `${item.type}:${side}:${side === "Home" ? item.homeId : item.awayId}`
);

function relativeOddsDescription(value: number): string {
  return value === 0 ? "持平（0.00%）" : `${value > 0 ? "高" : "低"} ${Math.abs(value).toFixed(2)}%`;
}

/** 只读投影：PM 本侧标异动，价差映射同侧，套利映射对侧及精确选项 ID。 */
export function buildOddsSignalBadges(
  match: ViewMatch,
  bet: ViewBet,
  drops: readonly BrowserPmOddsDropSignal[],
  ups: readonly PmUpSignal[],
  now: number,
  display: { down: boolean; up: boolean },
): Map<string, OddsSignalBadge[]> {
  const result = new Map<string, OddsSignalBadge[]>();
  const fresh = (at: number) => now - at < SIGNAL_BADGE_TTL_MS;
  const hasSource = (assetId: string, side: BetSide) => bet.items.some(item => item.type === "Polymarket"
    && (side === "Home" ? item.homeId : item.awayId) === assetId
    && (!item.sourceStatus || item.sourceStatus === "Normal"));
  const attach = (venue: string, itemId: string, side: BetSide, row: OddsSignal, role: OddsSignalBadge["role"], value: number) => {
    const item = bet.items.find(item => item.type === venue && (side === "Home" ? item.homeId : item.awayId) === itemId);
    if (!item || (item.sourceStatus && item.sourceStatus !== "Normal")) return;
    const key = oddsBadgeKey(item, side);
    const badges = result.get(key) ?? [];
    if (badges.some(badge => badge.direction === row.direction && badge.role === role)) return;
    const arrow = row.direction === "down" ? "↓" : "↑";
    const roundedGap = Number(value.toFixed(1));
    const label = role === "source" ? `${arrow}${value.toFixed(1)}%`
      : role === "gap" ? roundedGap === 0 ? "持平0.0%" : `${roundedGap > 0 ? "高+" : "低"}${Math.abs(roundedGap).toFixed(1)}%`
        : `套${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
    const targets = row.quotes.map(quote => `${quote.venue} · ${quote.sideLabel} @${quote.odds.toFixed(3)}，${row.direction === "down" ? `同侧赔率相对 PM ${relativeOddsDescription(quote.percent)}` : `理论套利 ${signedPercent(quote.percent)}`}`).join("；");
    const comparison = role === "gap" ? `${venue} 同侧赔率相对 PM ${relativeOddsDescription(value)}（以 PM 降后赔率 ${row.currentOdds.toFixed(3)} 为基准）\n` : "";
    const title = `${comparison}PM${row.direction === "down" ? "降赔" : "涨赔"} ${row.changePct.toFixed(2)}% · ${row.sideLabel} ${row.beforeOdds.toFixed(3)} → ${row.currentOdds.toFixed(3)}\n${targets || "触发时无其他场馆报价"}\n${new Date(row.detectedAt).toLocaleTimeString("zh-CN", { hour12: false })} 触发快照 · 角标保留30秒 · 点击查看详情`;
    badges.push({
      signalId: row.id, direction: row.direction, role, label, title, detectedAt: row.detectedAt,
      ...(role === "source" ? { movement: { beforeOdds: row.beforeOdds, currentOdds: row.currentOdds } } : {}),
    });
    result.set(key, badges);
  };
  if (display.down) {
    for (const { signal, snapshot } of betOddsDropSignals(match, bet, drops.filter(signal => signal.referenceVenue === "Polymarket" && fresh(signal.detectedAt)))) {
      if (!hasSource(signal.assetId, snapshot.side)) continue;
      const row = presentDropSignal(signal, snapshot);
      attach("Polymarket", signal.assetId, snapshot.side, row, "source", signal.dropPct);
      // 比较报价只来自触发快照；没有选项 ID 的旧记录仍可在浮窗查看。
      const captured = signal.venueSnapshot;
      for (const [key, venue] of [["ob", "OB"], ["ray", "RAY"], ["pb", "PB"]] as const) {
        const quote = captured?.[key];
        if (quote?.itemId) attach(venue, quote.itemId, snapshot.side, row, "gap", quote.evPercent);
      }
    }
  }
  if (display.up) {
    for (const signal of [...ups].sort((a, b) => b.detectedAt - a.detectedAt)) {
      if (!fresh(signal.detectedAt) || signal.matchId !== match.id || signal.betId !== bet.id) continue;
      if (!hasSource(signal.assetId, signal.pmSide)) continue;
      const row = presentUpSignal(signal);
      attach("Polymarket", signal.assetId, signal.pmSide, row, "source", signal.risePct);
      attach(signal.target.provider, signal.target.itemId, signal.targetSide, row, "arb", signal.arbPct);
    }
  }
  return result;
}
