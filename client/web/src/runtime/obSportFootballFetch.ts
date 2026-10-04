/**
 * 用户本机直连熊猫体育 HTTP（与电竞 OB `directGet` 同路）。不经扩展、不经 VPS，不写电竞 client_matches。
 */
import type { ClientMatchDto } from "@/types/esport";
import { clearObSportMarketMeta, rememberObSportMarketMeta } from "@/runtime/obSportMarketMeta";
import { a8Axios, responseBodyText } from "@changmen/client-core/shared/a8Axios";
import { decodeObSportPbPayload } from "@/runtime/obSportCodec";
import { ObSportApiError } from "@/runtime/obSportApiError";
import { resolveObFootballGame } from "@/runtime/footballLeague";
import {
  dedupeObPlaySelectionRows,
  extractObPlaySelections,
  isObBoardMarket,
  listBetsFromObPlayData,
  OB_FOOTBALL_ID_BASE,
  playsFromObMatchRow,
} from "@/runtime/obSportOdds";
import {
  FOOTBALL_LIVE_LOOKBACK_MS,
  matchInUpcomingWindow,
} from "@/runtime/sportBoardFilter";
import { isObSportC8Mid } from "@/runtime/obSportWs";
import { livePatchFromObMatchRow, type ObSportLivePatch } from "@/runtime/obSportLive";
import {
  rememberObEnglishNames,
  type ObEnglishTeamNames,
} from "@/runtime/obSportEnglishNames";
import {
  peekObChineseNames,
  refreshObChineseNamesForMids,
} from "@/runtime/obSportChineseNames";
import {
  parseSportObSessionInput,
  readLocalSportObSession,
  writeLocalSportObSession,
  type SportObSessionLocal,
} from "@/runtime/obSportSessionLocal";
import {
  fetchPandaSportTrialRow,
  formatPandaSportTrialPaste,
  resolveObSportHttpGateway,
} from "@/runtime/obSportTrial";

const CACHE_TTL_MS = 10_000;
const ODDS_BATCH = 12;
const BATCH_GAP_MS = 400;
const RATE_LIMIT_SLEEP_MS = 2_000;
const MAX_RATE_LIMIT_HITS = 5;
const CSID_FOOTBALL = "1";
/** 今日/早盘足球（试玩菜单 1012 → p=3020101） */
const EUID_FOOTBALL = "3020101";
/** 滚球足球（试玩菜单 1011 → p=30002） */
const EUID_FOOTBALL_LIVE = "30002";
const SCHEDULE_PATH = "/yewu11/v2/w/structureTournamentMatchesPB";
const LIST_ODDS_PATH = "/yewu11/v1/w/structureMatchBaseInfoByMidsPB";
const DETAIL_ODDS_PATH = "/yewu11/v1/w/getMatchBaseInfoByOddsPB";

type ClientMarketRow = {
  hpid?: string;
  Name?: string;
  MarketCode?: string;
  Line?: number | null;
  Period?: string;
  Selections?: Array<{ Name?: string; Odds?: number; Side?: string; OddID?: string }>;
};

let memCache: { at: number; rows: ClientMatchDto[] } | null = null;
let inflight: Promise<ClientMatchDto[]> | null = null;
let lastLiveByMid = new Map<string, ObSportLivePatch>();

export function listObFootballLivePatches(): ObSportLivePatch[] {
  return [...lastLiveByMid.values()];
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stableObMatchId(mid: string): number {
  let h = 2166136261;
  for (let i = 0; i < mid.length; i++) {
    h ^= mid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return OB_FOOTBALL_ID_BASE + ((h >>> 0) % 9_000_000);
}

function uuidNoDash() {
  return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/-/g, "");
}

function sportCuid(session: SportObSessionLocal) {
  const digits = String(session.sessionId || session.uid || "").replace(/\D/g, "");
  if (digits.length >= 18)
    return digits.slice(0, 18);
  return digits || "0";
}

function gatewayOrigin(session: SportObSessionLocal): string {
  const raw = session.gateway as unknown;
  const g = (Array.isArray(raw)
    ? String(raw.find(item => String(item || "").trim()) || "")
    : String(raw || "")
  ).trim().replace(/\/$/, "");
  return resolveObSportHttpGateway(g, String(session.referer || ""));
}

function buildHeaders(session: SportObSessionLocal): Record<string, string> {
  const token = String(session.token || "");
  const cuid = sportCuid(session);
  const ts = Date.now();
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    lang: "en",
    requestId: token,
    checkId: `pc-${uuidNoDash()}-${cuid}-${ts}`,
    "request-code": "{\"panda-bss-source\":\"2\"}",
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObjectList(value: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)));
}

/** 赛程可能是联赛袋（mids）也可能是比赛行（mhn/man）。`ms` 在比赛行上是状态数字。 */
function nestedMatchRows(t: Record<string, unknown>): Record<string, unknown>[] {
  const out = [
    ...asObjectList(t.mls),
    ...asObjectList(t.matches),
    ...asObjectList(t.matchList),
    ...asObjectList(t.mhl),
    ...asObjectList(t.ml),
    ...asObjectList(t.mbm),
    ...asObjectList(t.mbms),
  ];
  if (Array.isArray(t.ms))
    out.push(...asObjectList(t.ms));
  return out;
}

function teamNames(row: Record<string, unknown>): { home: string; away: string } {
  return {
    home: String(row.mhn ?? row.home ?? row.homeName ?? "").trim(),
    away: String(row.man ?? row.away ?? row.awayName ?? "").trim(),
  };
}

/** livedata 可能是数组，也可能是 tid→联赛 的对象。 */
function bagRows(value: unknown): unknown[] {
  if (Array.isArray(value))
    return value;
  if (value && typeof value === "object") {
    const vals = Object.values(value as Record<string, unknown>);
    if (vals.some(v => v && typeof v === "object" && (
      "mids" in (v as object)
      || "mid" in (v as object)
      || "tid" in (v as object)
      || "csid" in (v as object)
    )))
      return vals;
  }
  return [];
}

function unwrapData(decoded: unknown): Record<string, unknown> {
  if (Array.isArray(decoded))
    return decoded as unknown as Record<string, unknown>;
  if (!decoded || typeof decoded !== "object")
    return {};
  const row = decoded as Record<string, unknown>;
  if (row.data && typeof row.data === "object")
    return row.data as Record<string, unknown>;
  return row;
}

function envelopeCodeOk(code: unknown): boolean {
  if (code == null || code === "")
    return true;
  const s = String(code);
  // yewu11 列表用 0 / 0000000；queryOrderStatus / yewurecord [官网可证实] 用 200
  return s === "0" || s === "0000000" || s === "200";
}

async function assertEnvelope(envelope: unknown, apiPath: string): Promise<unknown> {
  const row = envelope && typeof envelope === "object" ? envelope as Record<string, unknown> : {};
  const code = row.code;
  if (!envelopeCodeOk(code)) {
    const msg = String(row.msg || row.message || code);
    throw new ObSportApiError(apiPath, String(code), msg);
  }
  const decoded = await decodeObSportPbPayload(envelope);
  if (decoded == null)
    throw new Error(`OB sport ${apiPath} decode failed`);
  return decoded;
}

async function postPb(session: SportObSessionLocal, apiPath: string, body: Record<string, unknown>) {
  const origin = gatewayOrigin(session);
  if (!origin)
    throw new Error("sport OB session missing gateway");
  const url = `${origin}${apiPath}${apiPath.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const res = await a8Axios.post(url, body ?? {}, {
    headers: buildHeaders(session),
    timeout: 30_000,
  });
  if (res.status >= 400) {
    const text = responseBodyText(res.data);
    throw new Error(text.slice(0, 160) || `HTTP ${res.status}`);
  }
  const decoded = await assertEnvelope(res.data, apiPath);
  if (apiPath === LIST_ODDS_PATH || apiPath === DETAIL_ODDS_PATH)
    rememberObSportMarketMeta(origin, decoded);
  return decoded;
}

/** 直连 yewu*。采集默认本机试玩会话；下单传入下注账号会话。禁止电竞 OB `/game/bet`。 */
export async function postObSportPb(
  apiPath: string,
  body: Record<string, unknown>,
  session = readLocalSportObSession(),
) {
  if (!session?.token)
    throw new Error("未配置体育 OB 会话");
  return postPb(session, apiPath, body);
}

export async function getObSportPb(
  apiPath: string,
  query: Record<string, string> = {},
  session = readLocalSportObSession(),
) {
  if (!session?.token)
    throw new Error("未配置体育 OB 会话");
  const origin = gatewayOrigin(session);
  if (!origin)
    throw new Error("sport OB session missing gateway");
  const qs = new URLSearchParams({ ...query, t: String(Date.now()) });
  const path = apiPath.includes("?") ? apiPath : `${apiPath}?${qs.toString()}`;
  const url = path.startsWith("http") ? path : `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await a8Axios.get(url, {
    headers: buildHeaders(session),
    timeout: 30_000,
  });
  if (res.status >= 400) {
    const text = responseBodyText(res.data);
    throw new Error(text.slice(0, 160) || `HTTP ${res.status}`);
  }
  return assertEnvelope(res.data, apiPath);
}

export async function fetchObFootballDtoByMid(
  mid: string,
  hint?: { home?: string; away?: string; tid?: string; tn?: string; tnjc?: string; startTime?: number },
): Promise<ClientMatchDto | null> {
  const session = readLocalSportObSession();
  if (!session?.token || !gatewayOrigin(session))
    return null;
  const id = String(mid || "").trim();
  if (!isObSportC8Mid(id))
    return null;
  const today = await fetchOddsByMids(session, [id]);
  let odds = today.byMid.get(id);
  if (!odds) {
    const live = await fetchOddsByMids(session, [id], EUID_FOOTBALL_LIVE);
    odds = live.byMid.get(id);
  }
  return buildDto({
    mid: id,
    tid: String(hint?.tid || odds?.tid || ""),
    tn: String(hint?.tn || ""),
    tnjc: String(hint?.tnjc || ""),
    startTime: Number(hint?.startTime || odds?.mgt || 0) || 0,
    home: hint?.home,
    away: hint?.away,
  }, odds);
}

export type ScheduleMeta = {
  mid: string;
  tid: string;
  tn: string;
  tnjc: string;
  startTime: number;
  home?: string;
  away?: string;
  isLive?: boolean;
};

function obFlagOne(row: Record<string, unknown> | null | undefined, key: string): boolean {
  const v = row?.[key];
  if (v === true)
    return true;
  const n = Number(v);
  return Number.isFinite(n) && n === 1;
}

/** 联赛文案：试玩「电子赛事」角标对应 VS- / EAFC / PANDA独家。不碰队名里的 vs。 */
function obLeagueLooksElectronic(...parts: unknown[]): boolean {
  const text = parts.map(p => String(p || "").trim()).filter(Boolean).join(" ");
  if (!text)
    return false;
  if (/(?:^|[\s])VS\s*[-－]/.test(text))
    return true;
  return /EAFC|电子赛事|电子足球|电竞足球|PANDA独家/i.test(text);
}

/**
 * 试玩足球菜单里的 EAFC / 电子赛事，不进 changmen 足球页。
 * `me`/`tme`=1 是电子类型位；没有位时用联赛名兜底。
 * 不要用 `mvs`（滚球场次常表示有视频，不是电子赛），也不要用 `mfo`（赛程阶段）。
 */
export function isObElectronicFootball(
  tour?: Record<string, unknown> | null,
  match?: Record<string, unknown> | null,
): boolean {
  const rows = [tour, match].filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  for (const row of rows) {
    if (obFlagOne(row, "me") || obFlagOne(row, "tme"))
      return true;
  }
  return rows.some(row => obLeagueLooksElectronic(row.tnjc, row.tn, row.nameText, row.shortName, row.n));
}

export function collectObFootballSchedule(decoded: unknown, forceLive = false): ScheduleMeta[] {
  return collectFootballMatches(decoded, forceLive);
}

function collectFootballMatches(decoded: unknown, forceLive = false): ScheduleMeta[] {
  const root = unwrapData(decoded);
  const bags: Array<{ rows: unknown[]; live: boolean }> = [
    { rows: bagRows(root.livedata), live: true },
    { rows: bagRows(root.nolivedata), live: false },
    { rows: bagRows(root.data), live: forceLive },
    { rows: bagRows(root.list), live: forceLive },
    { rows: asArray(root), live: forceLive },
  ];
  const byMid = new Map<string, ScheduleMeta>();
  const put = (row: ScheduleMeta) => {
    const prev = byMid.get(row.mid);
    if (!prev) {
      byMid.set(row.mid, row);
      return;
    }
    byMid.set(row.mid, {
      ...prev,
      ...row,
      home: row.home || prev.home,
      away: row.away || prev.away,
      tn: row.tn || prev.tn,
      tnjc: row.tnjc || prev.tnjc,
      startTime: row.startTime || prev.startTime,
      isLive: Boolean(prev.isLive || row.isLive),
    });
  };
  for (const bag of bags) {
    for (const tour of bag.rows) {
      if (!tour || typeof tour !== "object")
        continue;
      const t = tour as Record<string, unknown>;
      const csid = String(t.csid ?? t.sportId ?? t.sid ?? "");
      const midsRaw = t.mids ?? t.mid;
      const tid = String(t.tid ?? t.tournamentId ?? t.id ?? "");
      const tn = String(t.tn ?? t.nameText ?? t.n ?? "");
      const tnjc = String(t.tnjc ?? t.shortName ?? "");
      const mgt = t.mgt ?? t.startTime ?? t.mgtStr;
      const midList = Array.isArray(midsRaw)
        ? midsRaw.map(String)
        : String(midsRaw || "").split(",").map(s => s.trim()).filter(Boolean);
      if (csid && csid !== CSID_FOOTBALL)
        continue;
      if (isObElectronicFootball(t))
        continue;
      const skipMids = new Set<string>();
      const nested = nestedMatchRows(t);
      for (const row of nested) {
        const mid = String(row.mid ?? row.id ?? "");
        if (!isObSportC8Mid(mid))
          continue;
        const mCsid = String(row.csid ?? csid);
        if (mCsid && mCsid !== CSID_FOOTBALL)
          continue;
        if (isObElectronicFootball(t, row)) {
          skipMids.add(mid);
          continue;
        }
        const names = teamNames(row);
        put({
          mid,
          tid: String(row.tid ?? tid),
          tn: String(row.tn ?? tn),
          tnjc: String(row.tnjc ?? tnjc),
          startTime: Number(row.mgt ?? row.mgtStr ?? row.startTime ?? mgt) || 0,
          home: names.home,
          away: names.away,
          isLive: bag.live,
        });
      }
      const selfMid = String(t.mid ?? "");
      const selfNames = teamNames(t);
      const midsCsv = String(t.mids || "");
      for (const mid of midList) {
        if (!isObSportC8Mid(mid) || skipMids.has(mid))
          continue;
        const named = Boolean(selfNames.home && selfNames.away
          && (mid === selfMid || (!midsCsv.includes(",") && midList.length === 1)));
        put({
          mid,
          tid,
          tn,
          tnjc,
          startTime: Number(mgt) || 0,
          isLive: bag.live,
          ...(named ? selfNames : {}),
        });
      }
    }
  }
  return [...byMid.values()];
}

function startTimeMs(raw: unknown): number {
  const n = Number(raw) || 0;
  if (n <= 0)
    return 0;
  return n > 1e12 ? n : n * 1000;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size)
    out.push(list.slice(i, i + size));
  return out;
}

function isRateLimited(err: unknown) {
  return /0401038|人数过多|too many/i.test(err instanceof Error ? err.message : String(err));
}

function ingestOddsRow(row: unknown, byMid: Map<string, Record<string, unknown>>) {
  if (!row || typeof row !== "object" || Array.isArray(row))
    return;
  const rec = row as Record<string, unknown>;
  const names = teamNames(rec);
  const mid = String(rec.mid ?? (names.home && names.away ? rec.id : "") ?? "");
  if (!mid || !isObSportC8Mid(mid))
    return;
  const prev = byMid.get(mid);
  if (!prev) {
    byMid.set(mid, rec);
    return;
  }
  // 玩法子行也带 mid、无 mhn/man；后写空串会冲掉已有队名。
  const next = { ...prev, ...rec };
  if (!names.home && prev.mhn)
    next.mhn = prev.mhn;
  if (!names.away && prev.man)
    next.man = prev.man;
  if (!String(next.tnjc || "").trim() && prev.tnjc)
    next.tnjc = prev.tnjc;
  if (!String(next.tn || "").trim() && prev.tn)
    next.tn = prev.tn;
  byMid.set(mid, next);
}

function ingestOddsRows(decoded: unknown, byMid: Map<string, Record<string, unknown>>) {
  const root = unwrapData(decoded);
  const rows = asArray(root.data).length ? asArray(root.data) : asArray(root);
  for (const row of rows) {
    ingestOddsRow(row, byMid);
    if (row && typeof row === "object" && !Array.isArray(row))
      for (const nested of nestedMatchRows(row as Record<string, unknown>))
        ingestOddsRow(nested, byMid);
  }
  for (const bag of [root.livedata, root.nolivedata, root.list]) {
    for (const tour of bagRows(bag)) {
      ingestOddsRow(tour, byMid);
      if (tour && typeof tour === "object" && !Array.isArray(tour))
        for (const nested of nestedMatchRows(tour as Record<string, unknown>))
          ingestOddsRow(nested, byMid);
    }
  }
}

/**
 * 按 mid 拉底价。实拉：接口常漏回部分 mid，且易 0401038。
 * 限流时退避续跑（不整批放弃）；漏回的 mid 再缩批重试。
 */
async function fetchOddsByMids(
  session: SportObSessionLocal,
  mids: string[],
  euid = EUID_FOOTBALL,
): Promise<{ byMid: Map<string, Record<string, unknown>>; rateLimited: boolean }> {
  const byMid = new Map<string, Record<string, unknown>>();
  const want = [...new Set(mids.map(mid => String(mid || "").trim()).filter(isObSportC8Mid))];
  let rateLimited = false;
  let rateHits = 0;

  const runParts = async (parts: string[][], allowShrink: boolean) => {
    const queue = [...parts];
    while (queue.length) {
      const part = queue.shift()!;
      try {
        const decoded = await postPb(session, LIST_ODDS_PATH, {
          cuid: sportCuid(session),
          euid,
          mids: part.join(","),
        });
        ingestOddsRows(decoded, byMid);
      }
      catch (err) {
        if (isRateLimited(err)) {
          rateLimited = true;
          rateHits += 1;
          if (rateHits >= MAX_RATE_LIMIT_HITS) {
            console.warn("[football] OB odds rate-limited, skip rest of wave", euid, queue.length + 1);
            return;
          }
          await sleep(RATE_LIMIT_SLEEP_MS * Math.min(rateHits, 3));
          if (allowShrink && part.length > 4) {
            queue.unshift(...chunk(part, Math.max(4, Math.ceil(part.length / 2))));
            continue;
          }
          queue.unshift(part);
          continue;
        }
        console.warn("[football] OB odds batch skipped", euid, err instanceof Error ? err.message : err);
      }
      if (queue.length)
        await sleep(BATCH_GAP_MS);
    }
  };

  await runParts(chunk(want, ODDS_BATCH), true);

  const missing = want.filter(mid => {
    const row = byMid.get(mid);
    if (!row)
      return true;
    const names = teamNames(row);
    return !(names.home && names.away);
  });
  if (missing.length && rateHits < MAX_RATE_LIMIT_HITS)
    await runParts(chunk(missing, 4), false);

  return { byMid, rateLimited };
}

function matchRowFromDecoded(decoded: unknown): Record<string, unknown> | null {
  const envelope = decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? decoded as Record<string, unknown>
    : {};
  const row = (asArray(envelope.data)[0] as Record<string, unknown> | undefined)
    || (envelope.mid ? envelope : null)
    || (Array.isArray(decoded) ? decoded[0] as Record<string, unknown> : null);
  if (row && Array.isArray(envelope.playData) && envelope.playData.length)
    row.playData = envelope.playData;
  return row || null;
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
function clampLiveStart(startTime: number, isLive: boolean | undefined, now = Date.now()): number {
  if (!isLive)
    return startTime;
  if (!(startTime > 0) || startTime > now)
    return now;
  if (startTime < now - FOOTBALL_LIVE_LOOKBACK_MS)
    return now - 60_000;
  return startTime;
}

function buildDto(meta: ScheduleMeta, oddsRow: Record<string, unknown> | null | undefined): ClientMatchDto | null {
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
    StartTime: startTime || Date.now(),
    Matchs: { OB: mid },
    Bets: bets,
  } as ClientMatchDto;
}

/** 列表 DTO：赛程袋常无队名，缺名时用联赛+mid 出牌；缺让球/大小时 Bets 为空。 */
export function buildObFootballListDto(
  meta: ScheduleMeta,
  oddsRow?: Record<string, unknown> | null,
): ClientMatchDto | null {
  return buildDto(meta, oddsRow);
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

function fillDtoTitleFromChinese(dto: ClientMatchDto): ClientMatchDto {
  const mid = String(dto.Matchs?.OB || "").trim();
  if (!mid || !isObFootballPlaceholderTitle(String(dto.Title || ""), mid, String(dto.Game || "")))
    return dto;
  const zh = peekObChineseNames(mid);
  if (!zh?.home || !zh?.away)
    return dto;
  return { ...dto, Title: `${zh.home} vs ${zh.away}` };
}

function seedEnglishNamesFromDtos(dtos: ClientMatchDto[], keepMids: string[]) {
  const rows = new Map<string, ObEnglishTeamNames>();
  for (const dto of dtos) {
    const mid = String(dto.Matchs?.OB || "").trim();
    if (!mid || isObFootballPlaceholderTitle(String(dto.Title || ""), mid, String(dto.Game || "")))
      continue;
    const parts = String(dto.Title || "").split(/\s+vs\.?\s+/i);
    const home = String(parts[0] || "").trim();
    const away = String(parts.slice(1).join(" vs ") || "").trim();
    if (!home || !away)
      continue;
    rows.set(mid, {
      home,
      away,
      league: String(dto.Game || "").trim(),
    });
  }
  rememberObEnglishNames(rows, keepMids);
}

/** 旧中文试玩 token 配 lang=en 会 0401038；无 lang 或非 en 时自动换英文试玩。 */
async function ensureEnglishSportSession(): Promise<SportObSessionLocal | null> {
  const cur = readLocalSportObSession();
  if (cur?.token && cur.lang === "en" && gatewayOrigin(cur))
    return cur;
  try {
    const row = await fetchPandaSportTrialRow("en");
    const parsed = parseSportObSessionInput(formatPandaSportTrialPaste(row));
    if (!parsed.ok)
      return cur;
    return writeLocalSportObSession({ ...parsed.session, lang: "en" });
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[football] OB en trial refresh skipped", msg);
    return cur;
  }
}

function metaOrOddsNamed(meta: ScheduleMeta, oddsRow: Record<string, unknown> | undefined): boolean {
  if (meta.home && meta.away)
    return true;
  if (!oddsRow)
    return false;
  const names = teamNames(oddsRow);
  return Boolean(names.home && names.away);
}

function mergeMarketRows(lists: ClientMarketRow[][]): ClientMarketRow[] {
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

function marketsFromRow(_mid: string, row: Record<string, unknown> | null): ClientMarketRow[] {
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

async function fetchSchedule(session: SportObSessionLocal, euid: string, liveMenu = false): Promise<ScheduleMeta[]> {
  const decoded = await postPb(session, SCHEDULE_PATH, {
    cuid: sportCuid(session),
    sort: 1,
    tid: "",
    apiType: 1,
    orpt: 0,
    euid,
  });
  return collectFootballMatches(decoded, liveMenu).map(row => (
    liveMenu ? { ...row, isLive: true } : row
  ));
}

function mergeSchedule(parts: ScheduleMeta[][]): ScheduleMeta[] {
  const byMid = new Map<string, ScheduleMeta>();
  for (const rows of parts) {
    for (const row of rows) {
      const prev = byMid.get(row.mid);
      if (!prev) {
        byMid.set(row.mid, row);
        continue;
      }
      byMid.set(row.mid, {
        ...prev,
        ...row,
        home: row.home || prev.home,
        away: row.away || prev.away,
        tn: row.tn || prev.tn,
        tnjc: row.tnjc || prev.tnjc,
        startTime: row.startTime || prev.startTime,
        isLive: Boolean(prev.isLive || row.isLive),
      });
    }
  }
  return [...byMid.values()];
}

async function doFetch(): Promise<ClientMatchDto[]> {
  const session = await ensureEnglishSportSession();
  if (!session?.token)
    return [];
  if (!gatewayOrigin(session))
    throw new Error("体育 OB 无网关：粘贴里需要 api 网关");
  const [today, inplay] = await Promise.all([
    fetchSchedule(session, EUID_FOOTBALL, false),
    fetchSchedule(session, EUID_FOOTBALL_LIVE, true).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[football] OB live schedule skipped", msg);
      return [] as ScheduleMeta[];
    }),
  ]);
  const schedule = mergeSchedule([today, inplay]);
  if (!schedule.length)
    throw new Error("OB sport schedule empty");
  const now = Date.now();
  const windowed = schedule.filter((m) => {
    if (m.isLive)
      return true;
    const t = startTimeMs(m.startTime);
    if (!(t > 0))
      return true;
    return matchInUpcomingWindow(t, now);
  }).sort((a, b) => Number(Boolean(b.isLive)) - Number(Boolean(a.isLive)));
  const mids = windowed.map(m => m.mid).filter(Boolean);
  const chineseWork = refreshObChineseNamesForMids(mids).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[football] OB Chinese names skipped", msg);
  });
  const oddsFirst = await fetchOddsByMids(session, mids);
  const oddsMap = oddsFirst.byMid;
  // 赛程袋无队名；按 mid 赔率常漏回/限流。缺名再打滚球 euid，再用详情补。
  const missingNames = windowed
    .filter(m => m.mid && !metaOrOddsNamed(m, oddsMap.get(m.mid)))
    .map(m => m.mid);
  if (missingNames.length) {
    const extra = await fetchOddsByMids(session, missingNames, EUID_FOOTBALL_LIVE);
    for (const [mid, row] of extra.byMid)
      oddsMap.set(mid, row);
  }
  const stillMissing = windowed
    .filter(m => m.mid && !metaOrOddsNamed(m, oddsMap.get(m.mid)))
    .map(m => m.mid)
    // 详情是单 mid；全量扫太慢且易 0401038。赔率缩批补完后通常只剩少数。
    .slice(0, 40);
  let detailRateHits = 0;
  for (const mid of stillMissing) {
    if (detailRateHits >= MAX_RATE_LIMIT_HITS)
      break;
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const detailRow = matchRowFromDecoded(await postPb(session, DETAIL_ODDS_PATH, {
          cuid: sportCuid(session),
          cos: 0,
          orpt: 0,
          euid: EUID_FOOTBALL,
          mid,
          mcid: 0,
          newUser: 0,
        }));
        if (detailRow) {
          const prev = oddsMap.get(mid);
          oddsMap.set(mid, prev ? { ...prev, ...detailRow } : detailRow);
        }
        done = true;
      }
      catch (err) {
        if (isRateLimited(err)) {
          detailRateHits += 1;
          await sleep(RATE_LIMIT_SLEEP_MS * Math.min(detailRateHits, 3));
          if (detailRateHits >= MAX_RATE_LIMIT_HITS)
            break;
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[football] OB detail names skipped", mid, msg);
        done = true;
      }
    }
    await sleep(BATCH_GAP_MS);
  }
  const dtos: ClientMatchDto[] = [];
  const nextLive = new Map<string, ObSportLivePatch>();
  for (const meta of windowed) {
    const oddsRow = oddsMap.get(meta.mid);
    const dto = buildDto(meta, oddsRow);
    if (!dto)
      continue;
    if (meta.isLive || matchInUpcomingWindow(Number(dto.StartTime) || 0, now))
      dtos.push(dto);
    const live = livePatchFromObMatchRow(meta.mid, oddsRow || null);
    if (live)
      nextLive.set(meta.mid, live);
  }
  lastLiveByMid = nextLive;
  dtos.sort((a, b) => (Number(a.StartTime) || 0) - (Number(b.StartTime) || 0));
  seedEnglishNamesFromDtos(dtos, mids);
  // 中文旁路不挡列表；到齐后 obChineseNamesRev 刷新板卡括号中文。
  void chineseWork;
  return dtos.map(fillDtoTitleFromChinese);
}

export async function fetchObFootballAsClientMatchDtos(): Promise<ClientMatchDto[]> {
  const session = readLocalSportObSession();
  if (!session?.token)
    return [];
  const age = memCache ? Date.now() - memCache.at : Infinity;
  if (memCache?.rows.length && age < CACHE_TTL_MS)
    return memCache.rows;
  if (inflight)
    return inflight;
  inflight = doFetch().then((rows) => {
    if (rows.length)
      memCache = { at: Date.now(), rows };
    return rows.length ? rows : (memCache?.rows || []);
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}

export function clearObFootballClientCache() {
  clearObSportMarketMeta();
  memCache = null;
  inflight = null;
  lastLiveByMid = new Map();
}

export async function fetchObFootballMatchMarkets(
  mid: string,
  options: { includeDetail?: boolean } = {},
): Promise<ClientMarketRow[]> {
  const session = readLocalSportObSession();
  if (!session?.token || !gatewayOrigin(session))
    return [];
  const id = String(mid || "").trim();
  if (!id)
    return [];
  // 试玩实测列表与详情的六类主盘结构一致；明确缺少目标盘口时仍允许详情补盘。
  let listRows: ClientMarketRow[] = [];
  try {
    const map = await fetchOddsByMids(session, [id]);
    listRows = marketsFromRow(id, map.byMid.get(id) || null);
    if (listRows.length && !options.includeDetail)
      return listRows;
  }
  catch { /* 无列表盘口时再用详情兜底 */ }
  let detailRow: Record<string, unknown> | null = null;
  try {
    detailRow = matchRowFromDecoded(await postPb(session, DETAIL_ODDS_PATH, {
      cuid: sportCuid(session),
      cos: 0,
      orpt: 0,
      euid: EUID_FOOTBALL,
      mid: id,
      mcid: 0,
      newUser: 0,
    }));
  }
  catch {
    detailRow = null;
  }
  return mergeMarketRows([marketsFromRow(id, detailRow), listRows]);
}
