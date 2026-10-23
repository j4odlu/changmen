/**
 * 用户本机直连熊猫体育 HTTP（与电竞 OB `directGet` 同路）。不经扩展、不经 VPS，不写电竞 client_matches。
 */
import type { ClientMatchDto } from "@/types/esport";
import { clearObSportMarketMeta, rememberObSportMarketMeta } from "@/runtime/obSportMarketMeta";
import { a8Axios, responseBodyText } from "@changmen/client-core/shared/a8Axios";
import { decodeObSportPbPayload } from "@/runtime/obSportCodec";
import { ObSportApiError } from "@/runtime/obSportApiError";
import { matchInUpcomingWindow } from "@/runtime/sportBoardFilter";
import { isObSportC8Mid } from "@/runtime/obSportWs";
import { livePatchFromObMatchRow, type ObSportLivePatch } from "@/runtime/obSportLive";
import { rememberObEnglishNames, type ObEnglishTeamNames } from "@/runtime/obSportEnglishNames";
import { peekObChineseNames, refreshObChineseNamesForMids } from "@/runtime/obSportChineseNames";
import { parseSportObSessionInput, readLocalSportObSession, writeLocalSportObSession, type SportObSessionLocal } from "@/runtime/obSportSessionLocal";
import { fetchPandaSportTrialRow, formatPandaSportTrialPaste, resolveObSportHttpGateway } from "@/runtime/obSportTrial";

import type { ClientMarketRow, ScheduleMeta } from "./obSportFootballResponse";
import { collectFootballMatches, envelopeCodeOk, ingestOddsRows, matchRowFromDecoded, mergeSchedule, metaOrOddsNamed, teamNames } from "./obSportFootballResponse";
import { buildDto as buildObFootballDto, isObFootballPlaceholderTitle, marketsFromRow, mergeMarketRows, startTimeMs } from "./obSportFootballDto";
export type { ScheduleMeta } from "./obSportFootballResponse";
export { isObElectronicFootball } from "./obSportFootballResponse";
export { isObFootballPlaceholderTitle } from "./obSportFootballDto";

// [changmen 扩展] 在原计算位置读取时钟，不提前固定整批 DTO 的时间。
function buildDto(meta: ScheduleMeta, oddsRow: Record<string, unknown> | null | undefined): ClientMatchDto | null {
  return buildObFootballDto(meta, oddsRow, () => Date.now());
}

const CACHE_TTL_MS = 10_000;
const ODDS_BATCH = 12;
const BATCH_GAP_MS = 400;
const RATE_LIMIT_SLEEP_MS = 2_000;
const MAX_RATE_LIMIT_HITS = 5;
/** 今日/早盘足球（试玩菜单 1012 → p=3020101） */
const EUID_FOOTBALL = "3020101";
/** 滚球足球（试玩菜单 1011 → p=30002） */
const EUID_FOOTBALL_LIVE = "30002";
const SCHEDULE_PATH = "/yewu11/v2/w/structureTournamentMatchesPB";
const LIST_ODDS_PATH = "/yewu11/v1/w/structureMatchBaseInfoByMidsPB";
const DETAIL_ODDS_PATH = "/yewu11/v1/w/getMatchBaseInfoByOddsPB";

let memCache: { at: number; rows: ClientMatchDto[] } | null = null;
let inflight: Promise<ClientMatchDto[]> | null = null;
let lastLiveByMid = new Map<string, ObSportLivePatch>();

export function listObFootballLivePatches(): ObSportLivePatch[] {
  return [...lastLiveByMid.values()];
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

export function collectObFootballSchedule(decoded: unknown, forceLive = false): ScheduleMeta[] {
  return collectFootballMatches(decoded, forceLive);
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

/** 列表 DTO：赛程袋常无队名，缺名时用联赛+mid 出牌；缺让球/大小时 Bets 为空。 */
export function buildObFootballListDto(
  meta: ScheduleMeta,
  oddsRow?: Record<string, unknown> | null,
): ClientMatchDto | null {
  return buildDto(meta, oddsRow);
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
