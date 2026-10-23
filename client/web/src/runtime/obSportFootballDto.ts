// [changmen 扩展] DTO 与盘口转换不读取会话或缓存；时钟由调用方注入，保留原读取位置。
import type { ClientMatchDto } from "@/types/esport";
import { resolveObFootballGame } from "@/runtime/footballLeague";
import { dedupeObPlaySelectionRows, extractObPlaySelections, isObBoardMarket, listBetsFromObPlayData, OB_FOOTBALL_ID_BASE, playsFromObMatchRow } from "@/runtime/obSportOdds";
import { FOOTBALL_LIVE_LOOKBACK_MS } from "@/runtime/sportBoardFilter";
import type { ScheduleMeta, ClientMarketRow } from "./obSportFootballResponse";
import { isObElectronicFootball } from "./obSportFootballResponse";

function stableObMatchId(mid: string): number {
  let h = 2166136261;
  for (let i = 0; i < mid.length; i++) {
    h ^= mid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return OB_FOOTBALL_ID_BASE + ((h >>> 0) % 9_000_000);
}

export function startTimeMs(raw: unknown): number {
  const n = Number(raw) || 0;
  if (n <= 0)
    return 0;
  return n > 1e12 ? n : n * 1000;
}

function isOutcomeLabel(name: string) {
  return /^(大|小|大球|小球|over|under|o\/u)$/i.test(String(name || "").trim());
}

function displayBetName(marketCode: string, line: number | null | undefined) {
  const raw = String(marketCode || "").toLowerCase();
  const ht = raw.startsWith("ht_");
  const code = ht ? raw.slice(3) : raw;
  const prefix = ht ? "半场" : "";
  if (code === "spreads") {
    const n = Number(line);
    if (!Number.isFinite(n))
      return `${prefix}让球`;
    return `${prefix}让球 ${n > 0 ? `+${n}` : String(n)}`;
  }
  if (code === "totals") {
    const n = Number(line);
    return Number.isFinite(n) ? `${prefix}大小 ${n}` : `${prefix}大小球`;
  }
  return ht ? "半场胜负" : "全场胜负";
}

function isFootballListMarket(code: string, hpid?: string) {
  return isObBoardMarket(hpid, code);
}

function obListGame(tid: string, tn: string, tnjc: string): string {
  const official = String(tnjc || tn || "").trim();
  return official || resolveObFootballGame(tid, tn, tnjc);
}

/** 滚球菜单场次必须留在板上；联赛袋 mgt 经常不是本场开赛时间（0、过旧、或指向今晚下一场）。 */
function clampLiveStart(startTime: number, isLive: boolean | undefined, now: number): number {
  if (!isLive)
    return startTime;
  if (!(startTime > 0) || startTime > now)
    return now;
  if (startTime < now - FOOTBALL_LIVE_LOOKBACK_MS)
    return now - 60_000;
  return startTime;
}

export function buildDto(meta: ScheduleMeta, oddsRow: Record<string, unknown> | null | undefined, readNow: () => number): ClientMatchDto | null {
  const row = oddsRow && typeof oddsRow === "object" ? oddsRow : {};
  if (isObElectronicFootball({ tn: meta.tn, tnjc: meta.tnjc }, row))
    return null;
  const mid = String(meta.mid);
  const matchId = stableObMatchId(mid);
  const tid = String(row.tid || meta.tid || "");
  const tn = String(row.tn || meta.tn || "");
  const tnjc = String(row.tnjc || meta.tnjc || "");
  const game = obListGame(tid, tn, tnjc);
  let home = String(row.mhn || meta.home || "").trim();
  let away = String(row.man || meta.away || "").trim();
  if (isOutcomeLabel(home) || isOutcomeLabel(away)) {
    home = String(meta.home || "").trim();
    away = String(meta.away || "").trim();
  }
  const named = Boolean(home && away && !isOutcomeLabel(home) && !isOutcomeLabel(away));
  if (!named) {
    if (isOutcomeLabel(home) && isOutcomeLabel(away))
      return null;
    home = home || "主队";
    away = away || "客队";
  }
  const startTime = clampLiveStart(
    startTimeMs(row.mgt || row.mgtStr || meta.startTime),
    meta.isLive,
    readNow(),
  );
  const playData = playsFromObMatchRow(row);
  const listBets = listBetsFromObPlayData(playData);
  const bets: NonNullable<ClientMatchDto["Bets"]> = [];
  let seq = 0;
  const seen = new Set<string>();
  for (const b of listBets) {
    const marketCode = String(b.marketCode || "moneyline");
    if (!isFootballListMarket(marketCode, b.hpid))
      continue;
    const uniq = `${marketCode}|${b.line == null ? "" : String(b.line)}`;
    if (seen.has(uniq))
      continue;
    seen.add(uniq);
    seq += 1;
    const betId = matchId * 100 + seq;
    const isTotals = marketCode === "totals" || marketCode === "ht_totals";
    const title = String(b.name || "").trim();
    const name = title && !/^(moneyline|spreads|totals|ob:)/i.test(title)
      ? title
      : displayBetName(marketCode, b.line);
    const src: Record<string, unknown> = {
      Type: "OB",
      BetID: String(b.homeOid || `${mid}-${marketCode}-${seq}`),
      HomeID: String(b.homeOid || `${mid}-h-${seq}`),
      AwayID: String(b.awayOid || `${mid}-a-${seq}`),
      HomeOdds: b.homeOdds,
      AwayOdds: b.awayOdds,
      Status: (b.homeOdds > 0 && b.awayOdds > 0) ? "Normal" : "Locked",
    };
    if (b.drawOdds > 0)
      src.DrawOdds = b.drawOdds;
    if (b.drawOid)
      src.DrawID = b.drawOid;
    bets.push({
      ID: betId,
      MatchID: matchId,
      Map: 0,
      Name: name,
      MarketCode: marketCode,
      Line: b.line,
      HomeID: betId * 10 + 1,
      HomeName: isTotals ? "大" : home,
      AwayID: betId * 10 + 2,
      AwayName: isTotals ? "小" : away,
      Sources: { OB: src as unknown as ClientMatchDto["Bets"][number]["Sources"][string] },
    } as ClientMatchDto["Bets"][number]);
  }
  return {
    ID: matchId,
    Title: named ? `${home} vs ${away}` : `${game || "足球"} ${mid}`,
    Game: game,
    GameID: 0,
    StartTime: startTime || readNow(),
    Matchs: { OB: mid },
    Bets: bets,
  } as ClientMatchDto;
}

/** 赛程占位标题：`亚足联冠军联赛二 5602643`（无 vs、无队名）。 */
export function isObFootballPlaceholderTitle(title: string, mid = "", game = ""): boolean {
  const t = String(title || "").trim();
  if (!t)
    return true;
  if (/\svs\.?\s/i.test(t))
    return false;
  const id = String(mid || "").trim();
  const g = String(game || "").trim();
  if (id && (t === `${g} ${id}` || t === `足球 ${id}` || t.endsWith(` ${id}`)))
    return true;
  return Boolean(id && new RegExp(`(?:^|\\s)${id}$`).test(t));
}

export function mergeMarketRows(lists: ClientMarketRow[][]): ClientMarketRow[] {
  const out: ClientMarketRow[] = [];
  const seen = new Set<string>();
  for (const r of lists.flat()) {
    const oidKey = (r.Selections || []).map(s => s.OddID || s.Name).join(",");
    const key = `${r.hpid}|${r.MarketCode}|${r.Line}|${r.Name}|${oidKey}`;
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function marketsFromRow(_mid: string, row: Record<string, unknown> | null): ClientMarketRow[] {
  if (!row)
    return [];
  const extracted = dedupeObPlaySelectionRows(
    playsFromObMatchRow(row).flatMap(p => extractObPlaySelections(p)),
  ).filter(r => r.selections.length && isObBoardMarket(r.hpid, r.marketCode));
  return mergeMarketRows([
    extracted.map(r => ({
      hpid: r.hpid,
      MarketCode: r.marketCode,
      Name: r.name,
      Line: r.line,
      Period: r.period,
      Selections: r.selections.map(s => ({
        Side: s.side,
        Name: s.name,
        Odds: s.odds,
        OddID: s.oid,
      })),
    })),
  ]);
}
