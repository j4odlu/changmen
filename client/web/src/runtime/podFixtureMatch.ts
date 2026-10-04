/**
 * POD 警报 → 足球板赛事。只对场，不对盘、不算价。
 * 拉丁队名 + 开赛时间窗；OB 中文标题用英文旁路 homeEn/awayEn。
 * 唯一且队名几乎全等 → confirmed（才能自动）；其余 matched 仍是猜测，可手点。
 */
import { footballLeagueKey } from "@/runtime/footballLeague";
import type { PodDropAlert } from "@/runtime/podAlerts";
import { aliasPodTeamTokens, expandPodTeamName } from "@/runtime/podTeamAlias";

export const POD_FIXTURE_TIME_WINDOW_MS = 20 * 60 * 1000;

const STOP = new Set([
  "fc", "cf", "sc", "afc", "the", "de", "of", "club", "fk", "sk", "ac", "as", "ud", "cd",
]);

const WEAK = new Set([
  "united", "city", "real", "sport", "sporting", "athletic", "atletico",
  "rangers", "wanderers", "rovers", "youth", "women", "ladies", "reserve",
  "u21", "u23", "ii",
]);

const JUNK_TEAM = /^(大|小|大球|小球|over|under|o\/u|主队|客队)$/i;

export type PodBoardMarket = {
  id: number;
  marketCode: string;
  line: number | null;
  name: string;
  /** 盘口来源；旧 OB 跟单仍只看 ob=true。 */
  venue?: string;
  ob: boolean;
  quoteHome: number;
  quoteAway: number;
  quoteDraw: number;
  /** ViewBetItem homeSubscribeId || homeId；无则空，跟单回落 HTTP 价 */
  oidHome?: string;
  oidAway?: string;
  oidDraw?: string;
  /** PM condition_id / OB market id；按 selection 保留，PM 下单确认必须用。 */
  betIdHome?: string;
  betIdAway?: string;
  betIdDraw?: string;
};

export type PodBoardFixture = {
  id: number;
  title: string;
  game: string;
  startAt: number;
  obMid: string;
  pmMid?: string;
  providers?: Record<string, string>;
  homeName: string;
  awayName: string;
  homeEn?: string;
  awayEn?: string;
  gameEn?: string;
  markets: PodBoardMarket[];
};

export type PodFixtureHit = {
  fixture: PodBoardFixture;
  swapped: boolean;
  score: number;
};

export type PodFixtureMatchStatus = "matched" | "pending" | "none";

export type PodFixtureMatchBasis = "guess" | "confirmed";

export type PodFixtureMatch = {
  status: PodFixtureMatchStatus;
  basis: PodFixtureMatchBasis;
  hits: PodFixtureHit[];
};

function fold(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[''`´]/g, "");
}

function hasLatin(raw: string): boolean {
  return /[a-z]/i.test(raw);
}

function latinTokens(raw: string): string[] {
  return fold(raw)
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !STOP.has(t));
}

function isJunkTeam(name: string): boolean {
  return !String(name || "").trim() || JUNK_TEAM.test(String(name).trim());
}

function splitTitle(title: string): { home: string; away: string } | null {
  const parts = String(title || "").split(/\s+vs\.?\s+/i);
  if (parts.length < 2)
    return null;
  const home = parts[0].trim();
  const away = parts.slice(1).join(" vs ").trim();
  if (!home || !away)
    return null;
  return { home, away };
}

function rawTeamNameScore(left: string, right: string): number {
  if (!left || !right || isJunkTeam(left) || isJunkTeam(right))
    return 0;
  const compactA = fold(left).replace(/[^a-z0-9]+/g, "");
  const compactB = fold(right).replace(/[^a-z0-9]+/g, "");
  if (compactA && compactA === compactB)
    return 1;
  if (!hasLatin(left) || !hasLatin(right))
    return 0;
  const A = aliasPodTeamTokens(latinTokens(left));
  const B = aliasPodTeamTokens(latinTokens(right));
  if (!A.length || !B.length)
    return 0;
  const setB = new Set(B);
  const hits: string[] = [];
  for (const token of A) {
    if (setB.has(token)) {
      hits.push(token);
      continue;
    }
    const prefix = B.find(other => (
      Math.min(token.length, other.length) >= 5
      && (token.startsWith(other) || other.startsWith(token))
    ));
    if (prefix)
      hits.push(token);
  }
  const strong = hits.filter(t => !WEAK.has(t));
  if (!strong.length)
    return 0;
  return strong.length / Math.min(A.filter(t => !WEAK.has(t)).length || A.length, B.filter(t => !WEAK.has(t)).length || B.length);
}

export function teamNameScore(a: string, b: string): number {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  return Math.max(
    rawTeamNameScore(left, right),
    rawTeamNameScore(expandPodTeamName(left), right),
    rawTeamNameScore(left, expandPodTeamName(right)),
    rawTeamNameScore(expandPodTeamName(left), expandPodTeamName(right)),
  );
}

function pairScore(
  alertHome: string,
  alertAway: string,
  boardHome: string,
  boardAway: string,
): { score: number; swapped: boolean } {
  const straight = Math.min(teamNameScore(alertHome, boardHome), teamNameScore(alertAway, boardAway));
  const swapped = Math.min(teamNameScore(alertHome, boardAway), teamNameScore(alertAway, boardHome));
  if (swapped > straight)
    return { score: swapped, swapped: true };
  return { score: straight, swapped: false };
}

function bestPair(
  alertHome: string,
  alertAway: string,
  fixture: PodBoardFixture,
): { score: number; swapped: boolean } {
  const titlePair = pairScore(alertHome, alertAway, fixture.homeName, fixture.awayName);
  const enPair = pairScore(alertHome, alertAway, fixture.homeEn || "", fixture.awayEn || "");
  if (enPair.score > titlePair.score)
    return enPair;
  if (titlePair.score > enPair.score)
    return titlePair;
  if (enPair.score > 0 && titlePair.swapped && !enPair.swapped)
    return enPair;
  return titlePair;
}

function fixtureLeagueKeys(fixture: PodBoardFixture): string[] {
  const keys = [fixture.game, fixture.gameEn]
    .map(game => footballLeagueKey(game))
    .filter(key => key && key !== "unknown_fb");
  return [...new Set(keys)];
}

function asLine(value: unknown): number | null {
  if (value == null || value === "")
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function itemOid(item: Record<string, unknown> | undefined, side: "home" | "away" | "draw"): string {
  if (!item)
    return "";
  if (side === "home")
    return String(item.homeSubscribeId || item.homeId || "").trim();
  if (side === "away")
    return String(item.awaySubscribeId || item.awayId || "").trim();
  return String(item.drawSubscribeId || "").trim();
}

function itemBetId(item: Record<string, unknown> | undefined): string {
  return String(item?.betId || item?.BetID || "").trim();
}

function marketsFromBets(bets: Array<{
  id?: number;
  name?: string;
  marketCode?: string;
  line?: number | null;
  items?: Array<{
    type?: string;
    fallbackHomeOdds?: number;
    fallbackAwayOdds?: number;
    fallbackDrawOdds?: number;
    homeId?: string;
    awayId?: string;
    homeSubscribeId?: string;
    awaySubscribeId?: string;
    drawSubscribeId?: string;
  }>;
}> | undefined): PodBoardMarket[] {
  const out: PodBoardMarket[] = [];
  for (const bet of bets || []) {
    const items = bet.items || [];
    if (!items.length) {
      out.push({
        id: Number(bet.id) || 0,
        marketCode: String(bet.marketCode || "").toLowerCase(),
        line: asLine(bet.line),
        name: String(bet.name || "").trim(),
        ob: false,
        quoteHome: 0,
        quoteAway: 0,
        quoteDraw: 0,
        oidHome: "",
        oidAway: "",
        oidDraw: "",
        betIdHome: "",
        betIdAway: "",
        betIdDraw: "",
      });
      continue;
    }
    for (const quote of items) {
      const venue = String(quote?.type || "").trim();
      if (!venue)
        continue;
      const rec = quote as Record<string, unknown> | undefined;
      out.push({
        id: Number(bet.id) || 0,
        marketCode: String(bet.marketCode || "").toLowerCase(),
        line: asLine(bet.line),
        name: String(bet.name || "").trim(),
        ...(venue !== "OB" ? { venue } : {}),
        ob: venue === "OB",
        quoteHome: Number(quote?.fallbackHomeOdds) || 0,
        quoteAway: Number(quote?.fallbackAwayOdds) || 0,
        quoteDraw: Number(quote?.fallbackDrawOdds) || 0,
        oidHome: itemOid(rec, "home"),
        oidAway: itemOid(rec, "away"),
        oidDraw: itemOid(rec, "draw"),
        betIdHome: itemBetId(rec),
        betIdAway: itemBetId(rec),
        betIdDraw: itemBetId(rec),
      });
    }
  }
  return out;
}

export function fixtureFromViewMatch(row: {
  id: number;
  title: string;
  game: string;
  startAt: number;
  providers?: Record<string, string | number>;
  bets?: Array<{
    id?: number;
    homeName?: string;
    awayName?: string;
    name?: string;
    marketCode?: string;
    line?: number | null;
    items?: Array<{
      type?: string;
      betId?: string;
      fallbackHomeOdds?: number;
      fallbackAwayOdds?: number;
      fallbackDrawOdds?: number;
      homeId?: string;
      awayId?: string;
      homeSubscribeId?: string;
      awaySubscribeId?: string;
      drawSubscribeId?: string;
    }>;
  }>;
}): PodBoardFixture {
  const fromTitle = splitTitle(row.title);
  let home = fromTitle?.home || "";
  let away = fromTitle?.away || "";
  if (isJunkTeam(home) || isJunkTeam(away)) {
    home = "";
    away = "";
  }
  if (!home || !away) {
    for (const bet of row.bets || []) {
      const h = String(bet.homeName || "").trim();
      const a = String(bet.awayName || "").trim();
      if (h && a && !isJunkTeam(h) && !isJunkTeam(a)) {
        home = h;
        away = a;
        break;
      }
    }
  }
  return {
    id: row.id,
    title: String(row.title || "").trim(),
    game: String(row.game || "").trim(),
    startAt: Number(row.startAt) || 0,
    obMid: String(row.providers?.OB || "").trim(),
    ...(String(row.providers?.Polymarket || "").trim()
      ? { pmMid: String(row.providers?.Polymarket || "").trim() }
      : {}),
    providers: Object.fromEntries(
      Object.entries(row.providers || {})
        .map(([venue, id]) => [venue, String(id || "").trim()])
        .filter(([, id]) => Boolean(id)),
    ),
    homeName: home,
    awayName: away,
    markets: marketsFromBets(row.bets),
  };
}

const TEAM_MIN = 0.5;
const CONFIRMED_MIN = 0.99;

/** [changmen 扩展] 搜索命中同一 mid 时补齐身份，不让板上无队名占位行遮住搜索结果。 */
export function mergePodObDiscoveryFixtures(board: PodBoardFixture[], discovered: PodBoardFixture[]): PodBoardFixture[] {
  const rows = [...board];
  const byMid = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.obMid)
      byMid.set(row.obMid, index);
  });
  for (const row of discovered) {
    if (!row.obMid)
      continue;
    const index = byMid.get(row.obMid);
    if (index == null) {
      byMid.set(row.obMid, rows.length);
      rows.push(row);
      continue;
    }
    const current = rows[index];
    rows[index] = {
      ...current,
      startAt: row.startAt > 0 ? row.startAt : current.startAt,
      homeEn: row.homeEn || row.homeName || current.homeEn,
      awayEn: row.awayEn || row.awayName || current.awayEn,
      gameEn: row.gameEn || row.game || current.gameEn,
      markets: current.markets.length ? current.markets : row.markets,
    };
  }
  return rows;
}

function fixtureBasis(hits: PodFixtureHit[]): PodFixtureMatchBasis {
  const hit = hits[0];
  if (hits.length !== 1 || !hit)
    return "guess";
  if (!String(hit.fixture.obMid || "").trim())
    return "guess";
  if (hit.score + 1e-9 < CONFIRMED_MIN)
    return "guess";
  return "confirmed";
}

export function matchPodAlertToFixtures(
  alert: Pick<PodDropAlert, "home" | "away" | "starts" | "league">,
  fixtures: PodBoardFixture[],
  windowMs = POD_FIXTURE_TIME_WINDOW_MS,
): PodFixtureMatch {
  const starts = Number(alert.starts) || 0;
  if (!(starts > 0))
    return { status: "none", basis: "guess", hits: [] };
  const ranked: PodFixtureHit[] = [];
  for (const fixture of fixtures) {
    if (!(fixture.startAt > 0))
      continue;
    if (Math.abs(fixture.startAt - starts) > windowMs)
      continue;
    const pair = bestPair(alert.home, alert.away, fixture);
    if (pair.score < TEAM_MIN)
      continue;
    ranked.push({ fixture, swapped: pair.swapped, score: pair.score });
  }
  ranked.sort((a, b) => b.score - a.score || Number(Boolean(b.fixture.obMid)) - Number(Boolean(a.fixture.obMid)));
  let hits = ranked;
  if (hits.length > 1) {
    const league = footballLeagueKey(alert.league);
    if (league && league !== "unknown_fb") {
      const narrowed = hits.filter(h => fixtureLeagueKeys(h.fixture).includes(league));
      if (narrowed.length)
        hits = narrowed;
    }
  }
  if (hits.length === 1)
    return { status: "matched", basis: fixtureBasis(hits), hits };
  if (hits.length > 1)
    return { status: "pending", basis: "guess", hits };
  return { status: "none", basis: "guess", hits: [] };
}

export function fixtureVenueId(fixture: PodBoardFixture, venue: string): string {
  const id = String(venue || "").trim();
  if (id === "OB")
    return String(fixture.obMid || fixture.providers?.OB || "").trim();
  if (id === "Polymarket")
    return String(fixture.pmMid || fixture.providers?.Polymarket || "").trim();
  return String(fixture.providers?.[id] || "").trim();
}

/** 场馆独立比赛匹配：先隔离场馆，再沿用现有队名/时间算法。 */
export function matchPodAlertToVenueFixtures(
  alert: Pick<PodDropAlert, "home" | "away" | "starts" | "league">,
  fixtures: PodBoardFixture[],
  venue: string,
  windowMs = POD_FIXTURE_TIME_WINDOW_MS,
): PodFixtureMatch {
  const isolated = fixtures.filter(fixture => Boolean(fixtureVenueId(fixture, venue)));
  const result = matchPodAlertToFixtures(alert, isolated, windowMs);
  const hit = result.status === "matched" ? result.hits[0] : null;
  if (!hit || hit.score + 1e-9 < CONFIRMED_MIN || !fixtureVenueId(hit.fixture, venue))
    return result;
  return { ...result, basis: "confirmed" };
}

export function formatPodFixtureMatch(row: PodFixtureMatch): string {
  if (row.status === "none")
    return "未对上";
  if (row.status === "pending")
    return `待确认 · ${row.hits.length} 场`;
  const hit = row.hits[0];
  const title = hit?.fixture.title || "板上比赛";
  const bits = [row.basis === "confirmed" ? "已确认" : "已对上", title];
  if (hit?.fixture.obMid)
    bits.push("OB");
  if (row.basis !== "confirmed")
    bits.push("猜测");
  if (hit?.swapped)
    bits.push("主客相反");
  return bits.join(" · ");
}
