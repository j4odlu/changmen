import type { PodBetTicket } from "./podBetTicket";
import type { PodFixtureMatch } from "./podFixtureMatch";
import type { PodMarketMatch, PodObQuoteCompare } from "./podMarketMatch";
import type { PodFollowLogRow } from "./podFollowLog";
import type { PodFollowPendingState } from "./podFollowPending";
import { podEvPercent } from "./podYabo/ev";

export type PodFollowTableLive = PodBetTicket & {
  fixtureMatch: PodFixtureMatch;
  marketMatch: PodMarketMatch;
  obQuote: PodObQuoteCompare;
  rayFixtureMatch: PodFixtureMatch;
  rayMarketMatch: PodMarketMatch;
  rayQuote: PodObQuoteCompare;
  pmFixtureMatch: PodFixtureMatch;
  pmMarketMatch: PodMarketMatch;
  pmQuote: PodObQuoteCompare;
};

export type PodFollowTableRow = { log: PodFollowLogRow; live?: PodFollowTableLive; pending: PodFollowPendingState };

/** [changmen 扩展] 表格只投影数据；已下/离线记录使用日志快照，避免实时价改写历史。 */
export function podFollowTableValues(row: PodFollowTableRow) {
  const live = row.pending.placed ? undefined : row.live;
  return {
    home: live?.alert.home || row.log.home,
    away: live?.alert.away || row.log.away,
    league: live?.alert.league || row.log.league,
    side: live?.sideLabel || row.log.sideLabel,
    market: live?.marketLabel || row.log.marketLabel,
    dropPct: live?.dropPct ?? row.log.dropPct,
    pinPrevious: live?.pinPrevious ?? row.log.pinPrevious,
    pinCurrent: live?.pinCurrent ?? row.log.pinCurrent,
    nvp: live?.nvp ?? row.log.nvp,
    quote: live?.obQuote.quote ?? row.log.obQuote,
    ev: live?.obQuote.evPercent ?? podEvPercent(row.log.obQuote, row.log.nvp),
    minOdds: live?.minObOdds ?? row.log.minObOdds,
    maxOdds: live?.maxObOdds ?? row.log.maxObOdds,
    obMid: row.pending.placed ? row.log.obMid : row.live?.fixtureMatch.hits[0]?.fixture.obMid || row.log.obMid,
    oid: live?.marketMatch.oid || row.log.oid,
    starts: row.live?.starts || 0,
    at: row.live?.alert.alertedAt || row.log.at,
    accounts: row.pending.receipt?.accounts || "",
    quoteStatus: live?.obQuote.status || (row.log.obQuote > 1 ? "snapshot" : "none"),
  };
}

export function formatPodTableDate(value: number): string {
  if (!(value > 0) || !Number.isFinite(value))
    return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    return "—";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
