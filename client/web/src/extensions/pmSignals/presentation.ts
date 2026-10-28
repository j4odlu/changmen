import type { PmUpSignal } from "./upDetector";
import type { BrowserPmOddsDropSignal } from "./downSettings";
import type { PmOddsDropVenueSnapshot } from "./downVenueSnapshot";

export type SignalDirection = "down" | "up";
export type SignalFilter = "all" | SignalDirection;

export interface SignalQuote {
  venue: string;
  sideLabel: string;
  odds: number;
  percent: number;
}

/** [changmen 扩展] 统一展示模型；同向价差与双边套利保持各自计算口径。 */
export interface OddsSignal {
  id: string;
  direction: SignalDirection;
  matchId: number | null;
  betId: number | null;
  matchTitle: string;
  marketTitle: string;
  venue: string;
  sideLabel: string;
  beforeOdds: number;
  currentOdds: number;
  changePct: number;
  windowMs: number;
  detectedAt: number;
  quotes: SignalQuote[];
  sourceLabel: string;
}

export function presentDropSignal(
  signal: BrowserPmOddsDropSignal,
  identity: PmOddsDropVenueSnapshot | null = signal.venueSnapshot,
): OddsSignal {
  const venue = signal.referenceVenue === "Polymarket" ? "PM" : signal.referenceVenue;
  // 缺少触发快照时只允许补全归属，不能将后来的实时赔率标成历史报价。
  const snapshot = signal.venueSnapshot;
  const quotes: SignalQuote[] = [];
  for (const [key, label] of [["pm", "PM"], ["ob", "OB"], ["ray", "RAY"], ["pb", "PB"]] as const) {
    const quote = snapshot?.[key];
    if (label !== venue && quote && Number.isFinite(quote.odds) && quote.odds > 1) {
      quotes.push({ venue: label, sideLabel: snapshot!.sideLabel, odds: quote.odds, percent: quote.evPercent });
    }
  }
  quotes.sort((a, b) => b.odds - a.odds);
  return {
    id: `down:${signal.id}`, direction: "down",
    matchId: identity?.matchId ?? signal.selection?.matchId ?? null,
    betId: identity?.betId ?? signal.selection?.betId ?? null,
    matchTitle: identity?.matchTitle ?? `${venue} 未合场盘口`,
    marketTitle: identity?.marketTitle ?? `盘口 ${signal.assetId.slice(0, 12)}…`,
    venue, sideLabel: identity?.sideLabel ?? "方向待识别",
    beforeOdds: signal.beforeOdds, currentOdds: signal.currentOdds,
    changePct: signal.dropPct, windowMs: signal.windowMs, detectedAt: signal.detectedAt,
    quotes,
    sourceLabel: signal.referenceVenue !== "Polymarket" ? "浏览器只读"
      : signal.sourceMode === "official" ? "官方直连" : "VPS转发",
  };
}

export function presentUpSignal(signal: PmUpSignal): OddsSignal {
  return {
    id: `up:${signal.id}`, direction: "up", matchId: signal.matchId, betId: signal.betId,
    matchTitle: signal.matchTitle, marketTitle: signal.marketTitle,
    venue: "PM", sideLabel: signal.pmSideLabel,
    beforeOdds: signal.beforeOdds, currentOdds: signal.pmOdds,
    changePct: signal.risePct, windowMs: signal.detectedAt - signal.baselineAt,
    detectedAt: signal.detectedAt,
    quotes: [{ venue: signal.target.provider, sideLabel: signal.targetSideLabel, odds: signal.target.odds, percent: signal.arbPct }],
    sourceLabel: "PM 原始行情",
  };
}

export function filterSignals(signals: readonly OddsSignal[], filter: SignalFilter): OddsSignal[] {
  return signals.filter(signal => filter === "all" || signal.direction === filter)
    .sort((a, b) => b.detectedAt - a.detectedAt);
}

export function signedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function signalAge(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
}
