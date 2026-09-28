import type { ViewBet, ViewMatch } from "@/models/match";
import type {
  FootballObMarketRow,
  FootballSelection,
  FootballVenueOdds,
} from "@/runtime/footballObMarkets";

export type SportLiveOddsReader = {
  get: (platform: string, subscribeId: string) => number;
  has?: (platform: string, subscribeId: string) => boolean;
  getLine?: (oid: string) => number | null;
};

const VENUE_ORDER = ["Polymarket", "PredictFun", "OB", "RAY"];

function venueRank(venue: string) {
  const i = VENUE_ORDER.indexOf(String(venue || ""));
  return i < 0 ? 99 : i;
}

function subscribeId(
  item: ViewBet["items"][0],
  side: "home" | "away" | "draw",
): string {
  if (side === "home")
    return String(item.homeSubscribeId || item.homeId || "").trim();
  if (side === "away")
    return String(item.awaySubscribeId || item.awayId || "").trim();
  return String(item.drawSubscribeId || "").trim();
}

function liveKnown(live: SportLiveOddsReader | undefined, platform: string, id: string): boolean {
  if (!live || !id)
    return false;
  if (live.has)
    return live.has(platform, id);
  return (live.get(platform, id) || 0) > 0;
}

function itemOdds(
  item: ViewBet["items"][0],
  side: "home" | "away" | "draw",
  live?: SportLiveOddsReader,
): number {
  const sub = subscribeId(item, side);
  const fromLive = live?.get(item.type, sub) || 0;
  if (liveKnown(live, item.type, sub))
    return fromLive;
  if (side === "draw")
    return Number(item.fallbackDrawOdds) || 0;
  return side === "home" ? Number(item.fallbackHomeOdds) || 0 : Number(item.fallbackAwayOdds) || 0;
}

function itemSource(
  item: ViewBet["items"][0],
  side: "home" | "away" | "draw",
  live?: SportLiveOddsReader,
): FootballSelection["Source"] {
  return liveKnown(live, item.type, subscribeId(item, side)) ? "M" : "H";
}

function selectionFromItem(
  name: string,
  side: "home" | "away" | "draw" | "over" | "under",
  oddsSide: "home" | "away" | "draw",
  item: ViewBet["items"][0],
  live?: SportLiveOddsReader,
): FootballSelection {
  const oid = subscribeId(item, oddsSide);
  const row: FootballSelection = {
    Name: name,
    Side: side,
    Odds: itemOdds(item, oddsSide, live),
    Source: itemSource(item, oddsSide, live),
    BetID: item.betId,
    MatchID: item.matchId,
  };
  if (oid)
    row.OddID = oid;
  return row;
}

function isMoneyline(code: string) {
  return !code || code === "moneyline" || code.endsWith("_moneyline");
}

function isTotalsCode(code: string) {
  return code === "totals" || code.endsWith("_totals");
}

const CODE_TITLE: Record<string, string> = {
  moneyline: "全场胜负",
  ht_moneyline: "半场胜负",
  spreads: "让球",
  ht_spreads: "半场让球",
  totals: "大小球",
  ht_totals: "半场大小",
};

/** 列表/详情标题：不把 moneyline 等英文码直接画到卡片上 */
export function footballMarketTitle(row: {
  Name?: string;
  MarketCode?: string;
  Line?: number | null;
}) {
  const name = String(row.Name || "").trim();
  const code = String(row.MarketCode || "").toLowerCase();
  const mapped = CODE_TITLE[code] || CODE_TITLE[name.toLowerCase()];
  if (mapped) {
    if (code.includes("spreads") || name.toLowerCase() === "spreads") {
      const n = Number(row.Line);
      if (Number.isFinite(n))
        return `${mapped} ${n > 0 ? `+${n}` : String(n)}`;
    }
    if (code.includes("totals") || name.toLowerCase() === "totals") {
      const n = Number(row.Line);
      if (Number.isFinite(n))
        return `${mapped} ${n}`;
    }
    if (!name || name.toLowerCase() === code || CODE_TITLE[name.toLowerCase()])
      return mapped;
  }
  return name || mapped || "盘口";
}

function selectionsFromItem(
  bet: ViewBet,
  item: ViewBet["items"][0],
  live?: SportLiveOddsReader,
): FootballSelection[] {
  const code = String(bet.marketCode || "");
  const name = bet.getBetName();
  const isTotals = isTotalsCode(code) || /大小/.test(name);
  if (isTotals) {
    return [
      selectionFromItem("大", "over", "home", item, live),
      selectionFromItem("小", "under", "away", item, live),
    ];
  }
  if (isMoneyline(code)) {
    return [
      selectionFromItem("主胜", "home", "home", item, live),
      selectionFromItem("平", "draw", "draw", item, live),
      selectionFromItem("客胜", "away", "away", item, live),
    ];
  }
  return [
    selectionFromItem("主", "home", "home", item, live),
    selectionFromItem("客", "away", "away", item, live),
  ];
}

function sortVenues(venues: FootballVenueOdds[]) {
  venues.sort((a, b) => venueRank(a.venue) - venueRank(b.venue) || a.venue.localeCompare(b.venue));
}

function listMarketKey(code: string, line: number | null | undefined) {
  const c = String(code || "moneyline").toLowerCase();
  const n = Number(line);
  const ml = c === "moneyline" || c === "ht_moneyline" || c.endsWith("_moneyline");
  if (ml && Number.isFinite(n) && n !== 0)
    return `${c}|${n}`;
  if (ml)
    return `${c}|`;
  return `${c}|${line ?? ""}`;
}

function quoteCount(selections: FootballSelection[] | undefined) {
  return (selections || []).filter(s => Number(s.Odds) > 0).length;
}

/**
 * 电竞 BetRow.getOdds(oddId, fallback) 的体育侧等价：有缓存用 live（含锁盘 0），否则 HTTP。
 * 只给足球格子用，不读 fo。
 */
export function resolveFootballCellOdds(
  venue: string,
  oddId: string,
  fallback: number,
  live?: SportLiveOddsReader,
): { odds: number; source: FootballSelection["Source"] } {
  const p = String(venue || "OB").trim() || "OB";
  const id = String(oddId || "").trim();
  const fb = Number(fallback) || 0;
  if (!id || !live || !liveKnown(live, p, id))
    return { odds: fb, source: "H" };
  return { odds: live.get(p, id) || 0, source: "M" };
}

export function resolveFootballCellLine(
  oddIds: string[],
  fallback: number | null | undefined,
  getLine?: (oid: string) => number | null,
): number | null {
  if (getLine) {
    for (const raw of oddIds || []) {
      const n = getLine(String(raw || "").trim());
      if (n != null && Number.isFinite(n))
        return n;
    }
  }
  const fb = Number(fallback);
  return Number.isFinite(fb) ? fb : null;
}

function overlayLiveSelection(sel: FootballSelection, live?: SportLiveOddsReader): FootballSelection {
  const resolved = resolveFootballCellOdds("OB", String(sel.OddID || ""), Number(sel.Odds) || 0, live);
  return { ...sel, Odds: resolved.odds, Source: resolved.source };
}

function overlayLiveLine(row: FootballObMarketRow, live?: SportLiveOddsReader): FootballObMarketRow {
  if (!live?.getLine)
    return row;
  for (const sel of row.Selections || []) {
    const line = live.getLine(String(sel.OddID || ""));
    if (line != null && line !== row.Line)
      return { ...row, Line: line };
  }
  for (const v of row.Venues || []) {
    for (const sel of v.Selections || []) {
      const line = live.getLine(String(sel.OddID || ""));
      if (line != null && line !== row.Line)
        return { ...row, Line: line };
    }
  }
  return row;
}

/** 详情/列表 OB 行按 OddID 叠 sportOddsStore，不改电竞 fo */
export function applyObLiveOdds(
  rows: FootballObMarketRow[],
  live?: SportLiveOddsReader,
): FootballObMarketRow[] {
  if (!live)
    return rows;
  return (rows || []).map((row) => overlayLiveLine({
    ...row,
    Selections: (row.Selections || []).map(s => overlayLiveSelection(s, live)),
    Venues: (row.Venues || []).map(v => ({
      venue: v.venue,
      Selections: (v.Selections || []).map(s => overlayLiveSelection(s, live)),
    })),
  }, live));
}

function bookRowKey(row: FootballObMarketRow): string {
  const code = String(row.MarketCode || "").toLowerCase();
  if (!code || code.startsWith("ob:"))
    return `x|${String(row.hpid || "")}|${String(row.Name || "").toLowerCase()}|${row.Line ?? ""}`;
  return listMarketKey(code, row.Line);
}

/**
 * 列表 ViewBet → 盘口行。每个场馆单独保留赔率（对齐电竞 BetRow 的 PlatformIcon 行）。
 */
export function viewBetsToMarketRows(
  match: ViewMatch,
  live?: SportLiveOddsReader,
): FootballObMarketRow[] {
  const out: FootballObMarketRow[] = [];
  const byKey = new Map<string, FootballObMarketRow>();
  for (const bet of match.bets || []) {
    const code = String(bet.marketCode || "");
    const key = listMarketKey(code, bet.line);
    let row = byKey.get(key);
    if (!row) {
      row = {
        Name: footballMarketTitle({ Name: bet.getBetName(), MarketCode: code || "moneyline", Line: bet.line }),
        MarketCode: code || "moneyline",
        Line: bet.line ?? null,
        Selections: [],
        Venues: [],
      };
      byKey.set(key, row);
      out.push(row);
    }
    for (const item of bet.items) {
      const venue = String(item.type || "").trim();
      if (!venue)
        continue;
      const selections = selectionsFromItem(bet, item, live);
      const bag = row.Venues!.find(v => v.venue === venue);
      if (bag)
        bag.Selections = selections;
      else
        row.Venues!.push({ venue, Selections: selections });
    }
  }
  for (const row of out) {
    sortVenues(row.Venues!);
    row.Selections = row.Venues?.[0]?.Selections || [];
  }
  return out;
}

/** OB 详情叠到列表行上，不覆盖 PM/PF。同 key 的列表行先并成一场。 */
export function mergeFootballBookRows(
  listRows: FootballObMarketRow[],
  obRows: FootballObMarketRow[],
): FootballObMarketRow[] {
  const index = new Map<string, FootballObMarketRow>();
  const out: FootballObMarketRow[] = [];
  for (const row of listRows || []) {
    const copy: FootballObMarketRow = {
      ...row,
      Selections: [...(row.Selections || [])],
      Venues: (row.Venues || []).map(v => ({ venue: v.venue, Selections: [...(v.Selections || [])] })),
    };
    const key = bookRowKey(copy);
    const hit = index.get(key);
    if (!hit) {
      out.push(copy);
      index.set(key, copy);
      continue;
    }
    for (const v of copy.Venues || []) {
      const ix = hit.Venues!.findIndex(x => x.venue === v.venue);
      if (ix >= 0) {
        if (quoteCount(v.Selections) >= quoteCount(hit.Venues![ix].Selections))
          hit.Venues![ix] = v;
      }
      else {
        hit.Venues!.push(v);
      }
    }
    sortVenues(hit.Venues!);
    if (!hit.Selections?.length)
      hit.Selections = copy.Selections;
  }
  for (const ob of obRows || []) {
    const selections = [...(ob.Selections || [])];
    if (!selections.length)
      continue;
    const key = bookRowKey(ob);
    const hit = index.get(key);
    const obVenue: FootballVenueOdds = { venue: "OB", Selections: selections };
    if (!hit) {
      const copy: FootballObMarketRow = {
        ...ob,
        Selections: selections,
        Venues: [obVenue],
      };
      out.push(copy);
      index.set(key, copy);
      continue;
    }
    const ix = hit.Venues!.findIndex(v => v.venue === "OB");
    if (ix >= 0) {
      if (quoteCount(selections) >= quoteCount(hit.Venues![ix].Selections))
        hit.Venues![ix] = obVenue;
    }
    else {
      hit.Venues!.push(obVenue);
    }
    sortVenues(hit.Venues!);
    if (ob.hpid)
      hit.hpid = ob.hpid;
    if (!hit.Selections?.length)
      hit.Selections = selections;
  }
  return out;
}
