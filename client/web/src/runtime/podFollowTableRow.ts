import type { PodBetTicket } from "./podBetTicket";
import type { PodFixtureMatch } from "./podFixtureMatch";
import type { PodMarketMatch, PodObQuoteCompare } from "./podMarketMatch";
import type { PodFollowLogRow } from "./podFollowLog";
import type { PodFollowVenueLog } from "./podFollowLog";
import type { PodFollowPendingState } from "./podFollowPending";
import { podEvPercent } from "./podYabo/ev";
import { formatPodFixtureMatch } from "./podFixtureMatch";
import { formatPodMarketMatch } from "./podMarketMatch";

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

export type PodFollowTableRow = { log: PodFollowLogRow; live?: PodFollowTableLive; pending: PodFollowPendingState;
  venueStates?: Record<string, { placed: boolean; label: string; detail: string; tone: string; accountIds: number[]; plannedStake: string; submittedAt: number }> };

/** [changmen 扩展] 场馆报价分别展示；OB 已下快照不被实时价覆盖，其它场馆明确标为当前报价。 */
export function podFollowTableQuotes(row: PodFollowTableRow) {
  return podFollowTableVenues(row).map(venue => ({ ...venue, venue: venue.label }));
}

function formatRecordedMarket(record: Pick<PodFollowVenueLog, "marketCode" | "side" | "line">) {
  const code = record.marketCode;
  const period = /^(?:ht|1h)_/.test(code) ? "半场" : "全场";
  const kind = /spreads/.test(code) ? "让球" : /totals/.test(code) ? "大小" : /moneyline/.test(code) ? "独赢" : "盘口";
  const side = record.side === "home" ? "主" : record.side === "away" ? "客" : record.side === "over" ? "大" : record.side === "under" ? "小" : record.side === "draw" ? "和" : "";
  return `${period}${kind} · ${side}${record.line == null ? "" : ` ${record.line > 0 ? "+" : ""}${record.line}`}`;
}

/** [changmen 扩展] 每个场馆的比赛、盘口、价、状态和回执共用一个展示条目，禁止交叉读取。 */
export function podFollowTableVenues(row: PodFollowTableRow) {
  const live = row.live;
  const sources = [
    ["OB", live?.fixtureMatch, live?.marketMatch, live?.obQuote],
    ["Polymarket", live?.pmFixtureMatch, live?.pmMarketMatch, live?.pmQuote],
    ["RAY", live?.rayFixtureMatch, live?.rayMarketMatch, live?.rayQuote],
  ] as const;
  const out = sources.flatMap(([venue, fixture, market, quote]) => {
    const saved = row.log.venues?.[venue];
    const legacy = venue === "OB" && row.pending.placed && !saved?.submittedAt;
    const snapshot = !!saved?.submittedAt || legacy;
    if (!saved && !legacy && fixture?.status !== "matched") return [];
    if (live && !snapshot && fixture?.status !== "matched") return [];
    const historical = !live;
    const useSaved = !!saved && (snapshot || historical);
    const values = podFollowTableValues(row);
    const state = row.venueStates?.[venue];
    const match = fixture?.hits[0]?.fixture;
    return [{ venue: venue as string, label: venue === "Polymarket" ? "PM" : venue,
      quote: useSaved ? saved.quote : legacy ? values.quote : quote?.quote || 0,
      ev: useSaved ? saved.ev : legacy ? values.ev : quote?.evPercent || 0,
      nvp: useSaved ? saved.nvp : legacy ? values.nvp : ((market?.nvp || 0) > 1 ? market!.nvp : live?.nvp || 0),
      minOdds: useSaved ? saved.minOdds : legacy ? values.minOdds : quote?.minObOdds || 0,
      maxOdds: useSaved ? saved.maxOdds : legacy ? values.maxOdds : quote?.maxObOdds || 0,
      status: snapshot || historical ? "snapshot" : quote?.status || "none",
      snapshot, historical, matchId: useSaved ? saved.matchId : legacy ? row.log.obMid : match?.providers?.[venue] || (venue === "OB" ? match?.obMid : venue === "Polymarket" ? match?.pmMid : "") || "",
      fixtureId: useSaved ? saved.fixtureId : match?.id || 0,
      oid: useSaved ? saved.oid : legacy ? row.log.oid : market?.oid || "",
      marketText: useSaved ? formatRecordedMarket(saved) : legacy ? formatRecordedMarket({ marketCode: row.log.marketCode, side: row.log.boardSide, line: row.log.boardLine }) : market ? formatPodMarketMatch(market) : "盘口未对上",
      fixtureText: snapshot || historical ? "记录赛事" : fixture ? formatPodFixtureMatch(venue === "OB" ? fixture : {
        ...fixture, hits: fixture.hits.map(hit => ({ ...hit, fixture: { ...hit.fixture, obMid: "" } })),
      }) : "赛事未找到",
      stateLabel: state?.label || (snapshot ? "已提交" : historical ? "未下 · 已离线" : "未下"),
      stateDetail: saved?.submittedAt ? saved.note : state?.detail || "",
      stateTone: state?.tone || (snapshot ? "ok" : "idle"),
      submitted: snapshot || !!state?.placed,
      submittedAt: saved?.submittedAt || state?.submittedAt || 0,
      accountIds: state?.accountIds || [], plannedStake: state?.plannedStake || "",
      receipt: saved?.submittedAt ? saved.note : legacy ? row.pending.receipt?.accounts || row.log.placeNote : "",
    }];
  });
  if (!out.length && !live) {
    const values = podFollowTableValues(row);
    out.push({ venue: "历史", label: "历史", quote: values.quote, ev: values.ev, nvp: values.nvp,
      minOdds: values.minOdds, maxOdds: values.maxOdds, status: "snapshot", snapshot: false, historical: true,
      matchId: row.log.obMid, fixtureId: 0, oid: row.log.oid, marketText: "记录盘口", fixtureText: "场馆未记录",
      stateLabel: "未下 · 已离线", stateDetail: "", stateTone: "idle", submitted: false, submittedAt: 0,
      accountIds: [], plannedStake: "", receipt: "" });
  }
  return out;
}

/** [changmen 扩展] 表格只投影数据；已下/离线记录使用日志快照，避免实时价改写历史。 */
export function podFollowTableValues(row: PodFollowTableRow) {
  const live = row.pending.placed || Object.values(row.log.venues || {}).some(record => record.submittedAt > 0) ? undefined : row.live;
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
    starts: row.log.starts || row.live?.starts || 0,
    at: row.log.alertedAt || row.live?.alert.alertedAt || row.log.at,
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
