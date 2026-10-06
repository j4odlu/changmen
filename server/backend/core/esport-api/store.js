import * as sb from "@changmen/db";
import { formatBetOdds } from "@changmen/shared/odds_format";
import { a8StartTimeListAllowed, normalizeEpochMs } from "@changmen/shared/time/match_time";
import { readJsonFile, writeJsonFile, writeJsonFileDebounced } from "@changmen/storage/json_file_store.js";
import {
  ensureStorageSeed,
  getPlatform as getPlatformRow,
  setPlatform as setPlatformRow,
} from "@changmen/storage/platform_storage.js";
import * as dbStore from "../db/store.js";
import { adapterRequire } from "../shared/adapter_paths.js";
import { isEmbeddedMatcher } from "../shared/matcher_mode.js";
import { ESPORT_DATA_DIR } from "../shared/storage_paths.js";
import { createDefaultOddsApi } from "./default_odds.js";
import { attachPmPrematchPrices } from "./pm_prematch.js";

const PREDICTFUN_LIST_FUTURE_MS = Number(
  process.env.PREDICTFUN_LIST_FUTURE_MS
  || process.env.PREDICTFUN_COLLECTOR_FUTURE_MS
  || 3600 * 1000,
);
/** 与 Polymarket / PredictFun collector 主窗 past=6h 对齐 */
const PREDICTFUN_LIST_PAST_MS = Number(
  process.env.PREDICTFUN_LIST_PAST_MS
  || process.env.PREDICTFUN_COLLECTOR_PAST_MS
  || 6 * 3600 * 1000,
);

function providerStartTimeListAllowed(provider, start) {
  if (provider === "PredictFun") {
    const ms = normalizeEpochMs(start);
    if (!ms)
      return true;
    const now = Date.now();
    if (ms > now + PREDICTFUN_LIST_FUTURE_MS)
      return false;
    if (ms < now - PREDICTFUN_LIST_PAST_MS)
      return false;
    return true;
  }
  return a8StartTimeListAllowed(start);
}

/** manifest `collectionMode: vps_http_ws`；与前端 `isVpsOwnedPlatformCollect` 同源 */
let _isVpsOwnedPlatformCollect;
function isVpsOwnedPlatformCollect(provider) {
  if (!_isVpsOwnedPlatformCollect) {
    const feeds = adapterRequire("registry", "feeds.js");
    _isVpsOwnedPlatformCollect = feeds.isVpsOwnedPlatformCollect;
  }
  return _isVpsOwnedPlatformCollect(provider);
}

const DATA_DIR = ESPORT_DATA_DIR;
// 内存缓存（替代 matches.json / bets.json / live_timers.json）
const _matches = {}; // { [provider]: { [matchId]: matchData } }
const _bets = {}; // { [provider:matchId]: { provider, matchId, bets } }
const _timers = {}; // { [provider]: { provider, timer } }

const readJson = readJsonFile;
const writeJson = writeJsonFile;

const defaultOddsApi = createDefaultOddsApi(readJson, writeJson, {
  writeDebounced: (name, data) => writeJsonFileDebounced(name, data, 5000),
});

function cloneJson(value) {
  if (value == null)
    return value;
  if (typeof structuredClone === "function")
    return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

const COLLECTOR_HOT_CACHE_TTL_MS = Number(process.env.COLLECTOR_HOT_CACHE_TTL_MS || 180_000);
/** embedded：SaveLiveTimer 后 debounce 触发 matchMerge，弥补 GetMatchs 纯读下的 Round 延迟 */
const EMBEDDED_MERGE_DEBOUNCE_MS = Number(process.env.MATCHER_TIMER_DEBOUNCE_MS || 3_000);
let _embeddedMergeTimer = null;

function scheduleEmbeddedMatchMerge() {
  if (!isEmbeddedMatcher())
    return;
  if (_embeddedMergeTimer != null)
    return;
  _embeddedMergeTimer = setTimeout(() => {
    _embeddedMergeTimer = null;
    import("@changmen/matcher/ops/match_merge_once.js")
      .then(({ matchMergeOnce }) => matchMergeOnce())
      .catch(err => console.warn("[matchMerge] embedded saveLiveTimer trigger:", err.message));
  }, EMBEDDED_MERGE_DEBOUNCE_MS);
}

// 路由到 profiles 的 key 列表
// CollectConfig → collect_config, USERCONFIG → betting_config, 其余 → preferences
const USER_SETTING_KEYS = [
  "CollectConfig",
  "USERCONFIG",
  "Follow",
  "PROXY",
  "GoogleCode",
  "Wallet",
  "Message",
  "Extensions",
];

// ── 初始化 JSON 文件 ───────────────────────────────────────────────────────
export function ensureSeed() {
  ensureStorageSeed();
}

// ── Auth：token → profile（鉴权逻辑在 @changmen/db）────────
export async function getUserByToken(token) {
  if (!token)
    return null;

  const auth = await sb.authGetUser(token);
  if (!auth?.userId)
    return null;

  let profile = dbStore.getProfileById(auth.userId);
  if (!profile)
    profile = await dbStore.loadProfileById(auth.userId);
  return profile || null;
}

/**
 * WS hub 等只需身份：优先完整 session 校验；失败时对签名有效的 access JWT 做归因回退
 * （避免 session 踢下线 / RDS 抖动时健康页变成「未鉴权」且用户以为连不上）。
 * @returns {Promise<{ userId: string, userName: string } | null>}
 */
export async function resolveUserIdentityByToken(token) {
  if (!token)
    return null;
  let userId = "";
  try {
    const auth = await sb.authGetUser(token);
    userId = String(auth?.userId || "").trim();
  }
  catch {
    /* fall through to peek */
  }
  if (!userId) {
    try {
      const peek = sb.authPeekAccessToken?.(token);
      userId = String(peek?.userId || "").trim();
    }
    catch {
      return null;
    }
  }
  if (!userId)
    return null;
  let userName = "";
  try {
    let profile = dbStore.getProfileById(userId);
    if (!profile)
      profile = await dbStore.loadProfileById(userId);
    userName = String(profile?.userName || "").trim();
  }
  catch {
    /* profile 可选 */
  }
  return { userId, userName };
}

// ── profile ───────────────────────────────────────────────────────────────────
export function getUserById(uid) {
  return dbStore.getProfileById(uid);
}

export function updateUserSetting(uid, patch) {
  return dbStore.updateProfileSetting(uid, patch);
}

// ── platform ──────────────────────────────────────────────────────────────────
export function getPlatform(provider) {
  return getPlatformRow(provider);
}

export function setPlatform(provider, data) {
  return setPlatformRow(provider, data);
}

function dropOrphanBetsForProvider(provider, activeMatchIds) {
  const active = new Set(activeMatchIds.map(String));
  const prefix = `${provider}:`;
  for (const key of Object.keys(_bets)) {
    if (!key.startsWith(prefix))
      continue;
    if (!active.has(key.slice(prefix.length)))
      delete _bets[key];
  }
}

function linkedClientMatchId(row) {
  if (!row || typeof row !== "object")
    return null;
  const raw = row.ClientMatchId ?? row.client_match_id ?? row.match_id;
  if (raw == null || raw === "")
    return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export function saveMatches(provider, matchs) {
  // vps_http_ws 馆由 VPS collector 独占写 platform_*；
  // 浏览器若再 SaveMatch（旧前端 / CollectConfig 仍开），会 orphan-delete 已开赛场次。
  const plat = String(provider || "").trim();
  if (isVpsOwnedPlatformCollect(plat)) {
    console.warn(
      `[esport-api] ignore API_SaveMatch for ${plat} (VPS collector owns platform_*)`,
    );
    return;
  }
  const now = Date.now();
  const batch = {};
  const list = Array.isArray(matchs) ? matchs : [];
  const prev = _matches[provider] || {};
  // [A8 可证实] SaveMatch 为全量快照：空数组 = 该平台当前无可见赛（与 collectStore 对齐）
  // [changmen 扩展] PB/OB/RAY：空快照忽略（与 RDS sticky 一致），避免 MATCHER 整馆闪没
  if (!list.length && sb.shouldIgnoreEmptyPlatformMatchSnapshot?.(plat)) {
    console.warn(`[esport-api] ignore API_SaveMatch([]) for ${plat} (sticky snapshot)`);
    return;
  }
  for (const m of list) {
    if (!m || m.SourceMatchID == null)
      continue;
    const start = Number(m.StartTime || 0);
    if (start > 0 && !providerStartTimeListAllowed(provider, start))
      continue;
    const sid = String(m.SourceMatchID);
    const prevRow = prev?.[sid];
    const linkedId = linkedClientMatchId(m) ?? linkedClientMatchId(prevRow);
    batch[sid] = {
      ...m,
      provider,
      savedAt: now,
      ...(linkedId != null
        ? { ClientMatchId: linkedId, client_match_id: linkedId, match_id: linkedId }
        : {}),
    };
  }
  const next = { ...batch };
  const alsoKeepSourceMatchIds = [];
  // sticky：宽限内缺席行留在采集内存；RDS 只 upsert 本批，alsoKeep 防误删（不刷新 sticky synced_at）
  if (sb.isStickyPlatformMatchSnapshot?.(plat)) {
    const graceMs = Number(sb.PB_SNAPSHOT_ORPHAN_GRACE_MS) || 5 * 60 * 1000;
    for (const [sid, row] of Object.entries(prev)) {
      if (next[sid] || !row)
        continue;
      const savedAt = Number(row.savedAt) || 0;
      if (savedAt > 0 && now - savedAt < graceMs) {
        next[sid] = row;
        alsoKeepSourceMatchIds.push(sid);
      }
    }
  }
  _matches[provider] = next;
  dropOrphanBetsForProvider(provider, Object.keys(next));
  const upsertRows = Object.values(batch);
  if (!upsertRows.length && sb.shouldIgnoreEmptyPlatformMatchSnapshot?.(plat)) {
    // 本批被 startTime 滤空：等同空快照，保留内存 sticky，不打 RDS 全清
    return;
  }
  sb.writePlatformMatches(
    provider,
    upsertRows,
    alsoKeepSourceMatchIds.length ? { alsoKeepSourceMatchIds } : {},
  );
}

/** matchMerge 完成后把 client_matches.matchs 回写到采集内存，避免下轮 align 重复 */
export function patchCollectorMatchClientIds(clientRows) {
  if (!Array.isArray(clientRows))
    return;
  for (const cm of clientRows) {
    const cmId = Number(cm.ID ?? cm.id);
    if (!Number.isFinite(cmId))
      continue;
    const links = cm.Matchs || cm.matchs || {};
    for (const [plat, srcId] of Object.entries(links)) {
      const row = _matches[plat]?.[String(srcId)];
      if (!row)
        continue;
      row.ClientMatchId = cmId;
      row.client_match_id = cmId;
      row.match_id = cmId;
    }
  }
}

/** 比赛已结束 / 人工归档：从采集内存移除平台行（与 RDS deletePlatformMatchRow 同步） */
export function removeCollectorPlatformMatch(platform, sourceMatchId) {
  const plat = String(platform || "").trim();
  const sid = String(sourceMatchId ?? "").trim();
  if (!plat || !sid)
    return;
  const bucket = _matches[plat];
  if (bucket && sid in bucket)
    delete bucket[sid];
  if (bucket && !Object.keys(bucket).length)
    delete _matches[plat];
  delete _bets[`${plat}:${sid}`];
}

/** [A8 可证实] 客户端每次 saveBets 上报该场完整盘口快照，服务端整包替换（非按 Map 增量合并） */
function normalizeSaveBetRows(bets) {
  return (bets || [])
    .filter(b => b && b.SourceBetID != null && !String(b.BetName ?? "").includes("+"))
    .map(formatBetOdds)
    .sort((a, b) => (a.Map ?? 0) - (b.Map ?? 0));
}

export function saveBets(provider, matchId, bets) {
  // vps_http_ws 馆由 VPS collector 独占写；
  // 浏览器 SaveBet 会与 collector 抢写 / 抹掉地图盘。
  const plat = String(provider || "").trim();
  if (isVpsOwnedPlatformCollect(plat)) {
    console.warn(
      `[esport-api] ignore API_SaveBet for ${plat} match=${matchId} (VPS collector owns platform_bets)`,
    );
    return;
  }
  const key = `${provider}:${matchId}`;
  const existing = _bets[key]?.bets || [];
  const raw = Array.isArray(bets) ? bets : [];
  const incoming = normalizeSaveBetRows(raw);
  if (incoming.length === 0) {
    // [A8 可证实] 空数组 saveBets 不覆盖内存已有盘口；RDS 刷新 updated_at 避免 matcher 空窗
    if (existing.length > 0) {
      sb.writePlatformBets(provider, matchId, existing);
      return;
    }
    _bets[key] = { provider, matchId: String(matchId), bets: [], savedAt: Date.now() };
    return;
  }
  _bets[key] = { provider, matchId: String(matchId), bets: incoming, savedAt: Date.now() };
  sb.replacePlatformBetsForMatch(provider, matchId, incoming);
}

export async function saveLiveTimer(provider, timer) {
  let incoming = Array.isArray(timer) ? timer : [];
  const plat = String(provider || "").trim();
  // vps_http_ws 馆由 VPS collector 独占写 platform_*；
  // 浏览器 SaveLiveTimer 会与 matcher 生命周期抢写（且 PM 本无 timer 采集）。
  if (isVpsOwnedPlatformCollect(plat)) {
    console.warn(
      `[esport-api] ignore API_SaveLiveTimer for ${plat} (VPS collector owns platform_*)`,
    );
    return;
  }
  if (plat === "OB") {
    const prev = _timers.OB?.timer || [];
    const liveOnIndex = Object.values(_matches.OB || {}).some(
      m => Number(m?.IsLive ?? m?.is_live) === 2,
    );
    const indexHasMatches = Object.keys(_matches.OB || {}).length > 0;
    // getTimer 空响应但 index 仍有赛：视为异常，不 wipe 内存/RDS（本地 dev 偶发；生产 index 常驻）
    if (incoming.length === 0 && (liveOnIndex || prev.length > 0 || indexHasMatches))
      return;
    if (incoming.length > 0) {
      const incomingIds = new Set(incoming.map(t => String(t.MatchID)));
      for (const [sid, m] of Object.entries(_matches.OB || {})) {
        if (Number(m?.IsLive ?? m?.is_live) !== 2)
          continue;
        if (incomingIds.has(String(sid)))
          continue;
        const hit = prev.find(t => String(t.MatchID) === String(sid));
        if (hit)
          incoming.push(hit);
      }
    }
  }
  _timers[plat] = {
    provider: plat,
    timer: incoming,
    savedAt: Date.now(),
  };
  await sb.writeLiveTimersAsync(plat, incoming);
  scheduleEmbeddedMatchMerge();
}

// ── user kv / settings ────────────────────────────────────────────────────────
export function isUserSettingKey(key) {
  return USER_SETTING_KEYS.includes(key);
}

export function getUserSetting(userId, key) {
  if (!isUserSettingKey(key))
    return null;
  return dbStore.getUserSetting(userId, key);
}

export function setUserSetting(userId, key, content) {
  if (!isUserSettingKey(key))
    return;
  return dbStore.setUserSetting(userId, key, content ?? "");
}

// ── accounts ──────────────────────────────────────────────────────────────────
export function getAccountsForUser(userId) {
  return dbStore.listAccountsForUser(userId);
}
export function setAccountsForUser(userId, accounts) {
  return dbStore.replaceAccountsForUser(userId, accounts);
}
export function updateAccountForUser(userId, accountId, updates) {
  return dbStore.updateAccountForUser(userId, accountId, updates);
}
export function removeAccountForUser(userId, accountId) {
  return dbStore.removeAccountForUser(userId, accountId);
}

// ── match list ────────────────────────────────────────────────────────────────

function buildPlatformMatchesSnapshot() {
  const matchesRaw = {};
  for (const [provider, rows] of Object.entries(_matches)) {
    const list = Object.values(rows || {});
    if (list.length)
      matchesRaw[provider] = cloneJson(list);
  }
  return matchesRaw;
}

function buildPlatformBetsSnapshot() {
  const bets = {};
  for (const [key, row] of Object.entries(_bets)) {
    if (row && Array.isArray(row.bets))
      bets[key] = cloneJson(row);
  }
  return bets;
}

function buildLiveTimersSnapshot() {
  const timers = {};
  for (const [provider, row] of Object.entries(_timers)) {
    if (row && Array.isArray(row.timer))
      timers[provider] = cloneJson(row);
  }
  return timers;
}

/** embedded matcher：matchMerge 读全量采集内存（不限 3 分钟 hot TTL） */
export function getCollectorFullSnapshot() {
  const matchesRaw = buildPlatformMatchesSnapshot();
  const bets = buildPlatformBetsSnapshot();
  const timers = buildLiveTimersSnapshot();
  return {
    matchesRaw,
    bets,
    timers,
    hasMatches: Object.keys(matchesRaw).length > 0,
    hasBets: Object.keys(bets).length > 0,
    hasTimers: Object.keys(timers).length > 0,
  };
}

export function getCollectorHotSnapshot() {
  const freshAfter = Date.now() - COLLECTOR_HOT_CACHE_TTL_MS;
  const matchesRaw = {};
  for (const [provider, rows] of Object.entries(_matches)) {
    const list = Object.values(rows || {}).filter(row => Number(row?.savedAt || 0) >= freshAfter);
    if (list.length)
      matchesRaw[provider] = cloneJson(list);
  }

  const bets = {};
  for (const [key, row] of Object.entries(_bets)) {
    if (row && Array.isArray(row.bets) && Number(row.savedAt || 0) >= freshAfter)
      bets[key] = cloneJson(row);
  }

  const timers = {};
  for (const [provider, row] of Object.entries(_timers)) {
    if (row && Array.isArray(row.timer) && Number(row.savedAt || 0) >= freshAfter)
      timers[provider] = cloneJson(row);
  }

  return {
    matchesRaw,
    bets,
    timers,
    hasMatches: Object.keys(matchesRaw).length > 0,
    hasBets: Object.keys(bets).length > 0,
    hasTimers: Object.keys(timers).length > 0,
  };
}

/** /health/diag：采集热缓存体积（排查 _matches/_bets 无界增长） */
export function getCollectorMemoryStats() {
  let matchRows = 0;
  const matchPlatforms = Object.keys(_matches).length;
  for (const rows of Object.values(_matches)) {
    if (rows && typeof rows === "object")
      matchRows += Object.keys(rows).length;
  }
  const betKeys = Object.keys(_bets).length;
  const timerPlatforms = Object.keys(_timers).length;
  return {
    matchPlatforms,
    matchRows,
    betKeys,
    timerPlatforms,
    approxJsonBytes: {
      matches: JSON.stringify(_matches).length,
      bets: JSON.stringify(_bets).length,
      timers: JSON.stringify(_timers).length,
    },
  };
}

export function hydrateCollectorHotSnapshot({ matchesRaw = {}, bets = {}, timers = {} } = {}) {
  for (const [provider, rows] of Object.entries(matchesRaw || {})) {
    const next = {};
    for (const m of rows || []) {
      if (!m || m.SourceMatchID == null)
        continue;
      next[String(m.SourceMatchID)] = { ...m, provider, savedAt: Date.now() };
    }
    if (Object.keys(next).length)
      _matches[provider] = next;
  }
  for (const [key, row] of Object.entries(bets || {})) {
    if (row && Array.isArray(row.bets))
      _bets[key] = { ...row, savedAt: Date.now() };
  }
  for (const [provider, row] of Object.entries(timers || {})) {
    if (row && Array.isArray(row.timer))
      _timers[provider] = { ...row, savedAt: Date.now() };
  }
}

export async function buildMatchList() {
  // 只读 client_matches（matchMerge 写入）；Round/Bets/Reverse 均由 matcher finalize，读路径不改写
  const fromDb = await dbStore.loadClientMatchesFromDb();
  if (!fromDb?.length)
    return [];
  defaultOddsApi.recordFromMatchList(fromDb);
  try { return await attachPmPrematchPrices(fromDb); }
  catch (err) {
    console.warn("[pm-prematch] stored price read failed:", err.message);
    return fromDb;
  }
}

/**
 * PM + Predict.fun 并列列表（不合并同场）。
 * 一侧失败且另一侧有数据 → 仍返回；两侧皆失败 → 抛错（供 router fail，避免假空）。
 * @param {Array<Promise<object[]>>} fetches
 * @param {string} logTag
 * @returns {Promise<object[]>}
 */
async function concatSportReadOnlyLists(fetches, logTag, budgetMs = 10_000) {
  const budget = Number(budgetMs);
  const raced = Number.isFinite(budget) && budget > 0
    ? fetches.map((p, i) => {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${logTag} source ${i} timeout ${budget}ms`)),
          budget,
        );
      });
      return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
    })
    : fetches;
  const settled = await Promise.allSettled(raced);
  const rows = [];
  const errors = [];
  for (const item of settled) {
    if (item.status === "fulfilled" && Array.isArray(item.value)) {
      rows.push(...item.value);
      continue;
    }
    if (item.status === "rejected")
      errors.push(item.reason);
  }
  if (rows.length) {
    if (errors.length) {
      console.warn(
        `[${logTag}] partial source failure`,
        errors.map(e => e?.message || String(e)).join("; "),
      );
    }
    // 全局按开赛时间升序（PM / PF 并列混排，不合并同场）
    rows.sort((a, b) => (Number(a?.StartTime) || 0) - (Number(b?.StartTime) || 0));
    return rows;
  }
  if (errors.length)
    throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
  return [];
}

/** 棒球：PM∥PF 拉取 → 双写 sport_venue_* → moneyline 合并；失败 fallback 并列列表。不碰电竞 client_matches。 */
export async function buildBaseballMatchList() {
  const { fetchMlbAsClientMatchDtos } = await import("./mlb_gamma_fetch.js");
  const { fetchPredictFunMlbAsClientMatchDtos } = await import("./sport_predictfun_fetch.js");
  const list = await concatSportReadOnlyLists(
    [fetchMlbAsClientMatchDtos(), fetchPredictFunMlbAsClientMatchDtos()],
    "GetBaseballMatchs",
  );
  try {
    const { ingestAndMergeSportLists } = await import("./sport_merge.js");
    const merged = await ingestAndMergeSportLists("baseball", list);
    if (merged?.length)
      return merged;
  }
  catch (err) {
    console.warn("[GetBaseballMatchs] sport merge fallback to concat", err?.message || err);
  }
  return list;
}

/** 足球：VPS 只读 PM collector 快照。PF 已停；OB 在用户浏览器采集。禁止服务端合场。 */
export async function buildFootballMatchList() {
  const { fetchFootballAsClientMatchDtos } = await import("./football_gamma_fetch.js");
  const list = await fetchFootballAsClientMatchDtos();
  const {
    cropSportMatchListWindow,
    sanitizeFootballMatchList,
    FOOTBALL_LIST_PAST_MS,
    FOOTBALL_LIST_FUTURE_MS,
  } = await import("./sport_football_markets.js");
  const cropped = cropSportMatchListWindow(list, FOOTBALL_LIST_PAST_MS, FOOTBALL_LIST_FUTURE_MS);
  return sanitizeFootballMatchList(cropped);
}

/** 网球：同上（ATP+WTA 单打）；不碰电竞 client_matches / mainBetLoop。 */
export async function buildTennisMatchList() {
  const { fetchTennisAsClientMatchDtos } = await import("./tennis_gamma_fetch.js");
  const { fetchPredictFunTennisAsClientMatchDtos } = await import("./sport_predictfun_fetch.js");
  const list = await concatSportReadOnlyLists(
    [fetchTennisAsClientMatchDtos(), fetchPredictFunTennisAsClientMatchDtos()],
    "GetTennisMatchs",
  );
  try {
    const { ingestAndMergeSportLists } = await import("./sport_merge.js");
    const merged = await ingestAndMergeSportLists("tennis", list);
    if (merged?.length)
      return merged;
  }
  catch (err) {
    console.warn("[GetTennisMatchs] sport merge fallback to concat", err?.message || err);
  }
  return list;
}

/** 篮球：NBA moneyline；不碰电竞 client_matches / mainBetLoop。 */
export async function buildBasketballMatchList() {
  const { fetchNbaAsClientMatchDtos } = await import("./nba_gamma_fetch.js");
  const { fetchPredictFunNbaAsClientMatchDtos } = await import("./sport_predictfun_fetch.js");
  const list = await concatSportReadOnlyLists(
    [fetchNbaAsClientMatchDtos(), fetchPredictFunNbaAsClientMatchDtos()],
    "GetBasketballMatchs",
  );
  try {
    const { ingestAndMergeSportLists } = await import("./sport_merge.js");
    const merged = await ingestAndMergeSportLists("basketball", list);
    if (merged?.length)
      return merged;
  }
  catch (err) {
    console.warn("[GetBasketballMatchs] sport merge fallback to concat", err?.message || err);
  }
  return list;
}

const fetchPlatformBetsForDefaultOdds = () => sb.fetchPlatformBets();

export function getMatchDefaultOdds(matchIds) {
  return defaultOddsApi.getMatchDefaultOdds(
    matchIds,
    () => buildMatchList(),
    fetchPlatformBetsForDefaultOdds,
  );
}
export function getDefaultOddsSingle(betId, team) {
  return defaultOddsApi.getDefaultOddsSingle(
    betId,
    team,
    () => buildMatchList(),
    fetchPlatformBetsForDefaultOdds,
  );
}
export function parseKvContent(raw) {
  if (raw == null || raw === "")
    return null;
  try {
    return JSON.parse(raw);
  }
  catch {
    return raw;
  }
}

export { DATA_DIR, readJson, writeJson };

const store = {
  DATA_DIR,
  ensureSeed,
  getUserByToken,
  resolveUserIdentityByToken,
  getUserById,
  updateUserSetting,
  getPlatform,
  setPlatform,
  saveMatches,
  saveBets,
  saveLiveTimer,
  isUserSettingKey,
  getUserSetting,
  setUserSetting,
  getAccountsForUser,
  setAccountsForUser,
  updateAccountForUser,
  removeAccountForUser,
  parseKvContent,
  buildMatchList,
  buildBaseballMatchList,
  buildFootballMatchList,
  buildTennisMatchList,
  buildBasketballMatchList,
  getCollectorHotSnapshot,
  getCollectorFullSnapshot,
  getCollectorMemoryStats,
  hydrateCollectorHotSnapshot,
  patchCollectorMatchClientIds,
  removeCollectorPlatformMatch,
  getMatchDefaultOdds,
  getDefaultOddsSingle,
  readJson,
  writeJson,
};

export default store;
