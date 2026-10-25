import * as sb from "@changmen/db";
import {
  accountsMultiplyNeedsPersist,
  normalizeAccountList,
} from "@changmen/shared/account_multiply";
import { accountsPersistUnchanged } from "@changmen/shared/account_persist";
import { normalizeEpochMs } from "@changmen/shared/time/match_time";
import { loadClientMatchSnapshot, invalidateClientMatchSnapshot,
  getClientMatchSnapshotStats } from "@changmen/db/client_match_snapshot.js";
import { parseFormBool } from "../shared/parse_form_bool.js";
import { createUserWriteQueue } from "./user_write_queue.js";

const runProfileWrite = createUserWriteQueue();
const runAccountWrite = createUserWriteQueue();

// ─── 内存 profile 缓存 ───────────────────────────────────────────────
const _cache = new Map();

function _set(uid, row) {
  _cache.set(String(uid), row);
}
function _get(uid) {
  return _cache.get(String(uid)) || null;
}
function _toProfile(row) {
  if (!row)
    return null;
  let setting = {};
  try {
    const bc = row.betting_config;
    setting = typeof bc === "object" && bc !== null ? bc : JSON.parse(bc || "{}");
  }
  catch {
    /* ignore */
  }
  if (setting.BetTarget !== undefined)
    setting.BetTarget = parseFormBool(setting.BetTarget);
  return {
    id: String(row.id),
    userName: row.user_name,
    isAdmin: Boolean(row.is_admin),
    role: row.role || (row.is_admin ? "admin" : "user"),
    teamId: row.team_id || null,
    setting,
  };
}

// ─── profiles ────────────────────────────────────────────────────────

export function getProfileById(uid) {
  return _toProfile(_get(uid));
}

export function getProfileByName(userName) {
  for (const row of _cache.values()) {
    if (row.user_name === userName)
      return _toProfile(row);
  }
  return null;
}

export function listProfiles() {
  return [..._cache.values()].map(_toProfile).filter(Boolean);
}

/** 含 preferences 等完整行，供在线状态等管理端逻辑使用 */
export function listProfileRows() {
  return [..._cache.values()];
}

export function upsertProfile(profile) {
  const uid = String(profile.id);
  const existing = _get(uid) || {};
  _set(uid, {
    ...existing,
    id: uid,
    user_name: String(profile.userName || profile.user_name || existing.user_name || ""),
    accounts: profile.accounts ?? existing.accounts ?? [],
    betting_config: profile.betting_config ?? existing.betting_config ?? {},
    collect_config: profile.collect_config ?? existing.collect_config ?? {},
    preferences: profile.preferences ?? existing.preferences ?? {},
    created_at: profile.created_at || existing.created_at || Date.now(),
    updated_at: Date.now(),
  });
}

export async function updateProfileSetting(uid, patch) {
  return runProfileWrite(uid, async () => {
    const row = _get(uid) || {};
    const bc = { ...(row.betting_config && typeof row.betting_config === "object" ? row.betting_config : {}), ...patch };
    const now = Date.now();
    await sb.writeProfileAsync(uid, { betting_config: bc });
    _set(uid, { ...(_get(uid) || {}), betting_config: bc, updated_at: now });
    return getProfileById(uid);
  });
}

export async function loadProfileById(uid) {
  return runProfileWrite(uid, async () => {
    const data = await sb.fetchProfileById(uid);
    if (!data)
      return null;
    _set(data.id, data);
    return _toProfile(data);
  });
}

export async function pullProfilesFromDb() {
  const profiles = await sb.fetchProfiles();
  if (profiles.length) {
    await Promise.all(profiles.map(p => loadProfileById(p.id)));
    console.log("[db] 加载 profiles:", profiles.length, "条");
    await refreshAllAccountsFromPlayers();
  }
}

// ─── accounts（唯一真相：players 表）────────────────────────────────────

const _accountsCache = new Map();
// Only the current queued operation can publish an older snapshot. Keep its
// deletion fence until it finishes (including failure), then release it.
const _accountPublications = new Map();
function runAccountOperation(uid, task) {
  return runAccountWrite(uid, async () => {
    const id = String(uid), deleted = new Set();
    _accountPublications.set(id, deleted);
    const publish = records => {
      const current = records.filter(row => !deleted.has(String(row.accountId)));
      _accountsCache.set(id, current);
      return current;
    };
    try { return await task(publish); }
    finally { _accountPublications.delete(id); }
  });
}

/**
 * 读内存账号（规范化乘网等）。
 * [P0-3] 读路径不得写 RDS：曾 fire-and-forget saveAccountRecordsForOwner，
 * 与 replaceAccountsForUser 竞态可覆盖/丢账号。规范化仅更新内存；
 * 落库由 replaceAccountsForUser / SaveData 等显式写路径完成。
 */
export function listAccountsForUser(uid) {
  const id = String(uid);
  const cached = _accountsCache.get(id);
  if (!cached)
    return [];
  const normalized = normalizeAccountList(cached);
  if (accountsMultiplyNeedsPersist(cached, normalized))
    _accountsCache.set(id, normalized);
  return normalized;
}

export async function loadAccountsForUser(uid) {
  return runAccountOperation(uid, async publish => {
    const id = String(uid);
    const records = await sb.fetchAccountRecordsByOwner(id);
    const normalized = normalizeAccountList(records);
    return publish(normalized);
  });
}

/**
 * [P0-4 D3] 严格回源：RDS 读失败抛错，且失败时不改内存缓存。
 * 供管理端 ensurePredictFunHouseAccount 等「读失败不能当空」路径使用。
 */
export async function loadAccountsForUserStrict(uid) {
  return runAccountOperation(uid, async publish => {
    const id = String(uid);
    const records = await sb.fetchAccountRecordsByOwnerStrict(id);
    const normalized = normalizeAccountList(records);
    return publish(normalized);
  });
}

/** 内存 accounts 为空时从 players 回源 */
export async function refreshAccountsFromRdsIfEmpty(uid) {
  const id = String(uid);
  const current = listAccountsForUser(id);
  if (current.length > 0)
    return current;
  return loadAccountsForUser(id);
}

/**
 * ACCOUNT 保存前：内存为空时从 players 回源，空列表 guard 以 RDS 为准。
 * 用 **strict** 回源：RDS 读失败会 **抛出**（调用方须中止保存），
 * 避免把"查询失败"当"无账号"而误覆盖/误 prune（P0-4 D1）。
 */
export async function prepareAccountsForSave(uid) {
  const id = String(uid);
  const current = listAccountsForUser(id);
  if (current.length > 0)
    return current;
  return loadAccountsForUserStrict(id);
}

async function refreshAllAccountsFromPlayers() {
  const ids = [..._cache.keys()];
  await Promise.all(ids.map(id => loadAccountsForUser(id)));
}

export function countAccounts() {
  let total = 0;
  for (const list of _accountsCache.values())
    total += Array.isArray(list) ? list.length : 0;
  return total;
}

/** Explicit full replacement compatibility helper. Partial callers must use mutate/update. */
export async function replaceAccountsForUser(uid, accounts) {
  return runAccountOperation(uid, async publish => {
    const id = String(uid);
    const normalized = normalizeAccountList(accounts);
    const prev = _accountsCache.get(id);
    if (prev && accountsPersistUnchanged(prev, normalized))
      return normalized;
    const written = await sb.saveAccountRecordsForOwner(id, normalized);
    if (written !== normalized.length)
      throw new Error("账号保存未全部确认，已阻止更新缓存");
    return publish(normalized);
  });
}

/** ACCOUNT full saves validate/merge against locked RDS rows and publish only after COMMIT. */
export function saveAccountsTransactionForUser(uid, accounts, prepare) {
  return runAccountOperation(uid, async publish => {
    const id = String(uid);
    const records = await sb.saveAccountRecordsForOwner(id, accounts, {
      replaceWith: async snapshot => normalizeAccountList(await prepare(snapshot)),
      skipUnchanged: (before, after) => accountsPersistUnchanged(normalizeAccountList(before), after),
    });
    return publish(records);
  });
}

export async function updateAccountForUser(uid, accountId, updates, { preserveBalance = false } = {}) {
  let patched = false;
  const records = await mutateAccountsForUser(uid, [accountId], ({ existing }) => existing.map(row => {
    if (String(row.accountId) !== String(accountId)) return row;
    patched = true;
    const patch = { ...updates };
    if (preserveBalance) {
      // The balance write already committed. A delayed metadata sync must use
      // the authoritative amount read under the player lock, not replay it.
      for (const key of ["balance", "Balance", "totalBalance", "TotalBalance"])
        delete patch[key];
      if (String(row.provider).toLowerCase() !== "predictfun" && Object.hasOwn(patch, "totalProfit"))
        patch.totalProfit = (Number(row.balance) || 0) - (Number(row.credit) || 0);
    }
    return { ...row, ...patch, accountId: row.accountId, updateTime: Date.now() };
  }));
  return patched ? records.find(row => String(row.accountId) === String(accountId)) ?? null : null;
}

/** Internal partial edits read and merge under the owner lock; never prune unrelated accounts. */
export function mutateAccountsForUser(uid, accountIds, transform) {
  return runAccountOperation(uid, async publish => {
    const id = String(uid);
    const records = await sb.saveAccountRecordsForOwner(id, accountIds.map(accountId => ({ accountId })), {
      replaceWith: async snapshot => normalizeAccountList(await transform(snapshot)),
      prune: false,
      skipUnchanged: (before, after) => JSON.stringify(normalizeAccountList(before)) === JSON.stringify(after),
    });
    return publish(records);
  });
}

export function removeAccountForUser(uid, accountId) {
  const id = String(uid);
  _accountPublications.get(id)?.add(String(accountId));
  const before = listAccountsForUser(id);
  const next = before.filter(a => String(a.accountId) !== String(accountId));
  if (next.length === before.length)
    return false;
  _accountsCache.set(id, next);
  return true;
}

// ─── user_settings ───────────────────────────────────────────────────

function _colForKey(key) {
  if (key === "USERCONFIG")
    return "betting_config";
  if (key === "CollectConfig")
    return "collect_config";
  return "preferences";
}

export async function setUserSetting(uid, key, content) {
  return runProfileWrite(uid, async () => {
    const col = _colForKey(key);
    const row = _get(uid) || {};
    const now = Date.now();
    let patch;
    if (col !== "preferences") {
      let parsed = {};
      try {
        parsed = JSON.parse(String(content ?? "{}"));
      }
      catch {
        /* ignore */
      }
      patch = { [col]: parsed };
    }
    else {
      const prefs
        = typeof row.preferences === "object" && row.preferences !== null
          ? { ...row.preferences }
          : {};
      prefs[String(key)] = String(content ?? "");
      patch = { preferences: prefs };
    }
    await sb.writeProfileAsync(uid, patch);
    _set(uid, { ...(_get(uid) || {}), ...patch, updated_at: now });
  });
}

export function getUserSetting(uid, key) {
  const col = _colForKey(key);
  const row = _get(uid);
  if (!row)
    return null;
  if (col !== "preferences") {
    const val = row[col];
    if (!val || (typeof val === "object" && !Object.keys(val).length))
      return null;
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  const prefs = row.preferences || {};
  const val = typeof prefs === "object" ? prefs[String(key)] : null;
  return val != null ? String(val) : null;
}

export function countUserSettings() {
  return 0;
}

// ─── client_matches（版本化 RDS 快照的线协议投影）────────────────────

const _clientMatches = new Map();
function _invalidateClientMatchesCache() {
  invalidateClientMatchSnapshot();
}

function _applyClientMatchRows(data) {
  if (!data?.length) {
    _clientMatches.clear();
    return null;
  }
  const now = Date.now();
  _clientMatches.clear();
  for (const row of data) {
    _clientMatches.set(Number(row.id), {
      ID: Number(row.id) || 0,
      Title: row.title || "",
      Game: row.game || "",
      GameID: Number(row.game_id) || 0,
      StartTime: normalizeEpochMs(row.start_time),
      BO: Number(row.bo) || 0,
      Round: Number(row.round) || 0,
      RoundStart: normalizeEpochMs(row.round_start),
      Reverse: Array.isArray(row.reverse) ? row.reverse : [],
      Matchs: row.matchs || {},
      Bets: row.bets || [],
      HomeGbTeamId: row.home_gb_team_id != null ? row.home_gb_team_id : undefined,
      AwayGbTeamId: row.away_gb_team_id != null ? row.away_gb_team_id : undefined,
      PmSport: row.pm_sport && typeof row.pm_sport === "object" ? row.pm_sport : undefined,
      built_at: row.built_at || now,
    });
  }
  return getClientMatches();
}

export function getClientMatches() {
  if (!_clientMatches.size)
    return null;
  return [..._clientMatches.values()].sort(
    (a, b) => (a.StartTime || 0) - (b.StartTime || 0),
  );
}

/** 人工强制结束后从内存移除，避免 embedded 仍读到已结束行 */
export function removeClientMatchFromMemory(clientMatchId) {
  const id = Number(clientMatchId);
  if (!Number.isFinite(id))
    return;
  _clientMatches.delete(id);
  _invalidateClientMatchesCache();
}

/** backend and matcher consume the same committed, versioned RDS rows. */
export async function loadClientMatchesFromDb() {
  for (;;) {
    const generation = getClientMatchSnapshotStats().generation;
    const snapshot = await loadClientMatchSnapshot();
    if (generation !== getClientMatchSnapshotStats().generation) continue;
    if (!snapshot) {
      const previous = getClientMatches();
      if (previous) return previous;
      throw new Error("赛事列表暂不可用，请稍后重试");
    }
    return _applyClientMatchRows(snapshot.rows);
  }
}

/** /health/diag：profile / client_matches 内存缓存体积 */
export function getMemoryCacheStats() {
  const clientRows = _clientMatches.size
    ? JSON.stringify([..._clientMatches.values()])
    : "[]";
  return {
    profiles: _cache.size,
    accountsCache: _accountsCache.size,
    clientMatches: _clientMatches.size,
    clientMatchesCacheKey: getClientMatchSnapshotStats().version,
    clientMatchesCacheAgeMs: getClientMatchSnapshotStats().loadedAt
      ? Date.now() - getClientMatchSnapshotStats().loadedAt
      : 0,
    approxJsonBytes: {
      clientMatches: clientRows.length,
    },
  };
}
