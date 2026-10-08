/**
 * POD 跟单机会列表。对上场和盘才落本机，一直显示；记下有没有下单。不进 USERCONFIG / fo。
 * 已下后冻结下单时的 OB/NVP/PIN，列表不再跟现价。
 */
import { formatPodAgo, formatPodPrice } from "@/runtime/podAlerts";
import type { PodBetTicket } from "@/runtime/podBetTicket";
import type { PodObQuoteCompare, PodMarketMatch, PodMarketSide } from "@/runtime/podMarketMatch";
import type { PodFixtureMatch } from "@/runtime/podFixtureMatch";
import { formatPodEv, podEvPercent } from "@/runtime/podYabo/ev";

export const POD_FOLLOW_LOG_KEY = "changmen:podFollowLog";
export const POD_FOLLOW_LOG_MAX = 200;

export type PodFollowLiveTicket = PodBetTicket & {
  fixtureMatch: Pick<PodFixtureMatch, "status"> & {
    hits?: Array<{ fixture?: { id?: number; obMid?: string; pmMid?: string; providers?: Record<string, string> } }>;
  };
  marketMatch: Pick<PodMarketMatch, "status" | "oid" | "marketCode" | "boardLine" | "boardSide" | "nvp"> & { venue?: string };
  obQuote: PodObQuoteCompare;
};

export type PodFollowLogRow = {
  id: string;
  at: number;
  home: string;
  away: string;
  league: string;
  sideLabel: string;
  marketLabel: string;
  nvp: number;
  minObOdds: number;
  maxObOdds: number;
  obQuote: number;
  pinPrevious: number;
  pinCurrent: number;
  dropPct: number;
  stake: number;
  oid: string;
  obMid: string;
  marketCode: string;
  boardSide: PodMarketSide | null;
  boardLine: number | null;
  placed: boolean;
  placedAt: number;
  placeNote: string;
  starts?: number;
  alertedAt?: number;
  venues?: Record<string, PodFollowVenueLog>;
};

/** [changmen 扩展] 展示日志按场馆保留参考价和提交回执；不参与下单防重判定。 */
export type PodFollowVenueLog = {
  venue: string; fixtureId: number; matchId: string; obMid: string; oid: string;
  marketCode: string; side: PodMarketSide | null; line: number | null;
  quote: number; ev: number; nvp: number; minOdds: number; maxOdds: number;
  submittedAt: number; note: string;
};

function parseVenueLogs(raw: unknown): Record<string, PodFollowVenueLog> | undefined {
  const records = asRecord(raw);
  if (!records) return undefined;
  const out: Record<string, PodFollowVenueLog> = {};
  for (const venue of ["OB", "Polymarket", "RAY"]) {
    const row = asRecord(records[venue]);
    if (!row) continue;
    const side = str(row.side);
    out[venue] = { venue, fixtureId: num(row.fixtureId), matchId: str(row.matchId), obMid: str(row.obMid), oid: str(row.oid),
      marketCode: str(row.marketCode), side: ["home", "away", "draw", "over", "under"].includes(side) ? side as PodMarketSide : null,
      line: optNum(row.line), quote: num(row.quote), ev: num(row.ev), nvp: num(row.nvp),
      minOdds: num(row.minOdds), maxOdds: num(row.maxOdds), submittedAt: num(row.submittedAt), note: str(row.note) };
  }
  return out;
}

export function buildPodFollowVenueLog(ticket: PodFollowLiveTicket): PodFollowVenueLog {
  const venue = ticket.marketMatch.venue || "OB";
  const fixture = ticket.fixtureMatch.hits?.[0]?.fixture;
  return { venue, fixtureId: fixture?.id || 0,
    matchId: fixture?.providers?.[venue] || (venue === "OB" ? fixture?.obMid : venue === "Polymarket" ? fixture?.pmMid : "") || "",
    obMid: fixture?.obMid || "", oid: ticket.marketMatch.oid, marketCode: ticket.marketMatch.marketCode,
    side: ticket.marketMatch.boardSide, line: ticket.marketMatch.boardLine,
    quote: ticket.obQuote.quote, ev: ticket.obQuote.evPercent,
    nvp: ticket.marketMatch.nvp > 1 ? ticket.marketMatch.nvp : ticket.nvp,
    minOdds: ticket.obQuote.minObOdds, maxOdds: ticket.obQuote.maxObOdds, submittedAt: 0, note: "" };
}

/** 下单成功时写入日志的盘口快照（冻住当时价，不再跟 live） */
export type PodFollowPlaceSnap = Partial<Pick<
  PodFollowLogRow,
  "obQuote" | "nvp" | "minObOdds" | "maxObOdds" | "pinPrevious" | "pinCurrent" | "dropPct"
>>;

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function optNum(v: unknown): number | null {
  if (v == null || v === "")
    return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function ticketHasPodFollowMatch(ticket: Pick<PodFollowLiveTicket, "fixtureMatch" | "marketMatch">): boolean {
  return ticket.fixtureMatch.status === "matched"
    && ticket.marketMatch.status === "matched";
}

export function ticketHasPodFollowEv(ticket: Pick<PodFollowLiveTicket, "fixtureMatch" | "marketMatch" | "obQuote">): boolean {
  return ticketHasPodFollowMatch(ticket) && ticket.obQuote.status === "ok";
}

export function parsePodFollowLogRow(raw: unknown): PodFollowLogRow | null {
  const row = asRecord(raw);
  if (!row)
    return null;
  const id = str(row.id);
  if (!id)
    return null;
  const side = str(row.boardSide);
  const boardSide = side === "over" || side === "under" || side === "home" || side === "away" || side === "draw"
    ? side
    : null;
  return {
    id,
    at: num(row.at),
    home: str(row.home),
    away: str(row.away),
    league: str(row.league),
    sideLabel: str(row.sideLabel),
    marketLabel: str(row.marketLabel),
    nvp: num(row.nvp),
    minObOdds: num(row.minObOdds),
    maxObOdds: num(row.maxObOdds),
    obQuote: num(row.obQuote),
    pinPrevious: num(row.pinPrevious),
    pinCurrent: num(row.pinCurrent),
    dropPct: num(row.dropPct),
    stake: num(row.stake),
    oid: str(row.oid),
    obMid: str(row.obMid),
    marketCode: str(row.marketCode),
    boardSide,
    boardLine: optNum(row.boardLine),
    placed: row.placed === true,
    placedAt: num(row.placedAt),
    placeNote: str(row.placeNote),
    ...(row.starts != null ? { starts: num(row.starts) } : {}),
    ...(row.alertedAt != null ? { alertedAt: num(row.alertedAt) } : {}),
    ...(row.venues ? { venues: parseVenueLogs(row.venues) } : {}),
  };
}

export function parsePodFollowLog(raw: unknown): PodFollowLogRow[] {
  const list = Array.isArray(raw) ? raw : asRecord(raw)?.rows;
  if (!Array.isArray(list))
    return [];
  const out: PodFollowLogRow[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const row = parsePodFollowLogRow(item);
    if (!row || seen.has(row.id))
      continue;
    seen.add(row.id);
    out.push(row);
  }
  out.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return out.slice(0, POD_FOLLOW_LOG_MAX);
}

export function buildPodFollowLogRow(ticket: PodFollowLiveTicket, now = Date.now()): PodFollowLogRow {
  const hit = ticket.fixtureMatch.status === "matched" ? ticket.fixtureMatch.hits?.[0] : null;
  return {
    id: ticket.id,
    at: now,
    home: ticket.alert.home,
    away: ticket.alert.away,
    league: ticket.alert.league,
    sideLabel: ticket.sideLabel,
    marketLabel: ticket.marketLabel,
    nvp: ticket.marketMatch.nvp > 1 ? ticket.marketMatch.nvp : ticket.nvp,
    minObOdds: Number(ticket.obQuote.minObOdds) || ticket.minObOdds,
    maxObOdds: Number(ticket.obQuote.maxObOdds) || ticket.maxObOdds,
    obQuote: Number(ticket.obQuote.quote) || 0,
    pinPrevious: ticket.pinPrevious,
    pinCurrent: ticket.pinCurrent,
    dropPct: ticket.dropPct,
    stake: ticket.stake,
    oid: String(ticket.marketMatch.oid || "").trim(),
    obMid: String(hit?.fixture?.obMid || "").trim(),
    marketCode: String(ticket.marketMatch.marketCode || "").trim(),
    boardSide: ticket.marketMatch.boardSide ?? null,
    boardLine: ticket.marketMatch.boardLine ?? null,
    placed: false,
    placedAt: 0,
    placeNote: "",
    starts: ticket.starts,
    alertedAt: ticket.alert.alertedAt,
    venues: { [ticket.marketMatch.venue || "OB"]: buildPodFollowVenueLog(ticket) },
  };
}

export function buildPodFollowPlaceSnap(ticket: PodFollowLiveTicket): PodFollowPlaceSnap {
  const row = buildPodFollowLogRow(ticket);
  return {
    obQuote: row.obQuote,
    nvp: row.nvp,
    minObOdds: row.minObOdds,
    maxObOdds: row.maxObOdds,
    pinPrevious: row.pinPrevious,
    pinCurrent: row.pinCurrent,
    dropPct: row.dropPct,
  };
}

function writeLog(rows: PodFollowLogRow[]): PodFollowLogRow[] {
  const next = parsePodFollowLog(rows);
  try {
    localStorage.setItem(POD_FOLLOW_LOG_KEY, JSON.stringify(next));
  }
  catch { /* quota */ }
  return next;
}

export function readPodFollowLog(): PodFollowLogRow[] {
  try {
    const raw = localStorage.getItem(POD_FOLLOW_LOG_KEY);
    if (!raw)
      return [];
    return parsePodFollowLog(JSON.parse(raw));
  }
  catch {
    return [];
  }
}

export function upsertPodFollowEv(row: PodFollowLogRow): { rows: PodFollowLogRow[]; added: boolean; wrote: boolean } {
  const parsed = parsePodFollowLogRow(row);
  if (!parsed)
    return { rows: readPodFollowLog(), added: false, wrote: false };
  const rows = readPodFollowLog();
  const idx = rows.findIndex(item => item.id === parsed.id);
  if (idx < 0) {
    if ((!parsed.obMid || !parsed.oid) && !Object.values(parsed.venues || {}).some(row => row.matchId && row.oid))
      return { rows, added: false, wrote: false };
    return { rows: writeLog([parsed, ...rows]), added: true, wrote: true };
  }
  const cur = rows[idx];
  const venues = { ...cur.venues, ...parsed.venues };
  for (const [venue, record] of Object.entries(cur.venues || {}))
    if (record.submittedAt > 0) venues[venue] = record;
  const next: PodFollowLogRow = {
    ...(cur.placed || Object.values(cur.venues || {}).some(record => record.submittedAt > 0) ? cur : parsed),
    at: cur.at || parsed.at,
    placed: cur.placed,
    placedAt: cur.placedAt,
    placeNote: cur.placeNote,
    ...(Object.keys(venues).length ? { venues } : {}),
  };
  if (JSON.stringify(next) === JSON.stringify(cur))
    return { rows, added: false, wrote: false };
  const copy = rows.slice();
  copy[idx] = next;
  return { rows: writeLog(copy), added: false, wrote: true };
}

export function markPodFollowLogPlaced(
  id: string,
  note: string,
  now = Date.now(),
  snap?: PodFollowPlaceSnap | null,
): PodFollowLogRow[] {
  const want = String(id || "").trim();
  if (!want)
    return readPodFollowLog();
  const rows = readPodFollowLog();
  let hit = false;
  const next = rows.map((row) => {
    if (row.id !== want)
      return row;
    hit = true;
    const frozen: PodFollowLogRow = {
      ...row,
      placed: true,
      placedAt: row.placedAt || now,
      placeNote: String(note || "").trim() || row.placeNote,
    };
    if (snap) {
      if (Number(snap.obQuote) > 1)
        frozen.obQuote = Number(snap.obQuote);
      if (Number(snap.nvp) > 1)
        frozen.nvp = Number(snap.nvp);
      if (Number(snap.minObOdds) > 1)
        frozen.minObOdds = Number(snap.minObOdds);
      if (Number(snap.maxObOdds) > 1)
        frozen.maxObOdds = Number(snap.maxObOdds);
      if (Number(snap.pinPrevious) > 1)
        frozen.pinPrevious = Number(snap.pinPrevious);
      if (Number(snap.pinCurrent) > 1)
        frozen.pinCurrent = Number(snap.pinCurrent);
      if (Number.isFinite(Number(snap.dropPct)))
        frozen.dropPct = Number(snap.dropPct);
    }
    return frozen;
  });
  return hit ? writeLog(next) : rows;
}

export function clearPodFollowLog(): PodFollowLogRow[] {
  return writeLog([]);
}

export function markPodFollowVenueSubmitted(id: string, snapshot: PodFollowVenueLog, note: string, now = Date.now(), reference?: PodFollowLogRow): PodFollowLogRow[] {
  const rows = readPodFollowLog();
  return writeLog(rows.map(row => row.id !== id ? row : {
    ...row,
    ...(reference && !row.placed && !Object.values(row.venues || {}).some(venue => venue.submittedAt > 0) ? {
      home: reference.home, away: reference.away, league: reference.league, sideLabel: reference.sideLabel,
      marketLabel: reference.marketLabel, pinPrevious: reference.pinPrevious, pinCurrent: reference.pinCurrent,
      dropPct: reference.dropPct, starts: reference.starts, alertedAt: reference.alertedAt,
    } : {}),
    venues: { ...row.venues, [snapshot.venue]: row.venues?.[snapshot.venue]?.submittedAt
      ? row.venues[snapshot.venue] : { ...snapshot, submittedAt: now, note } },
  }));
}

export function formatPodFollowLogWhen(at: number, now = Date.now()): string {
  return formatPodAgo(at, now);
}

export function formatPodFollowLogQuote(row: Pick<PodFollowLogRow, "obQuote" | "minObOdds">): string {
  const price = formatPodPrice(row.obQuote);
  const min = Number(row.minObOdds) || 0;
  const quote = Number(row.obQuote) || 0;
  if (!(quote > 1))
    return "OB价 —";
  if (!(min > 1))
    return `OB ${price}`;
  return quote + 1e-6 >= min ? `OB ${price} 够` : `OB ${price} 不够`;
}

export function formatPodFollowLogEv(row: Pick<PodFollowLogRow, "obQuote" | "nvp">): string {
  return formatPodEv(podEvPercent(Number(row.obQuote) || 0, Number(row.nvp) || 0));
}

export function formatPodFollowLogPlace(row: Pick<PodFollowLogRow, "placed" | "placeNote">): string {
  if (row.placed)
    return row.placeNote ? `已下 · ${row.placeNote}` : "已下";
  return "未下";
}
