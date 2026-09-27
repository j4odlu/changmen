import crypto from "node:crypto";
import * as sb from "@changmen/db";
import { ensurePgPoolReady, getPgPool, insertProfile } from "@changmen/db";
import { accountProviderKey, resolveAccountMultiply } from "@changmen/shared/account_multiply";
import { isAdminUser } from "../auth/admin_auth.js";
import { filterProfiles, getVisibleUserIds, resolveVisibleUserIds } from "../auth/role_filter.js";
import { listProfileRows, loadAccountsForUser, loadProfileById } from "../db/store.js";
import { listUserProfitRank, toDateKey } from "./order_store.js";
import * as orderStore from "./order_store.js";
import { summarizePfOrders } from "../integrations/predictfun/pf_ledger.js";
import {
  lastLoginFieldsFromProfile,
  PROFILE_META_PREFERENCE_KEYS,
} from "./user_login_meta.js";
import { resolvePresenceState } from "./user_presence.js";
import store from "../esport-api/store.js";
import { parseFormBool } from "../shared/parse_form_bool.js";
import * as accountStore from "./account_store.js";
import { sanitizeAccountForAdmin } from "./admin_account_sanitize.js";

export { parseFormBool } from "../shared/parse_form_bool.js";
export { sanitizeAccountForAdmin } from "./admin_account_sanitize.js";
export {
  listAdminPredictFunMembers,
  getAdminPredictFunFeeConfig,
  saveAdminPredictFunFeeConfig,
  ensurePredictFunHouseAccount,
  rechargeAdminPredictFunMember,
  listAdminPredictFunMoneyLogs,
  listAdminPredictFunMemberOrders,
} from "./admin_pf.js";
export {
  listAdminOrders,
  parseAdminOrderIdList,
  deleteAdminOrders,
  listAdminOrdersMatrix,
  listAdminOrderLogs,
} from "./admin_orders.js";
export {
  getAdminMaintenanceReport,
  listDuplicateOrderIds,
  listSharedVenueAccounts,
} from "./admin_maintenance.js";
export {
  getAdminMarketHubRoute,
  saveAdminMarketHubRoute,
} from "./admin_market_hub.js";

function accountCount(accounts) {
  return Array.isArray(accounts) ? accounts.length : 0;
}

export function sanitizeSettingForAdmin(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return {};
  return { ...raw };
}

const ADMIN_CONFIG_PREFERENCE_KEYS = [
  "Follow",
  "PROXY",
  "GoogleCode",
  "Wallet",
  "Message",
  "Extensions",
];

const SENSITIVE_CONFIG_KEY_RE = /token|cookie|secret|private|privy|password|authorization|credential|session|jwt|api[_-]?key/i;

function clonePlain(value) {
  if (value == null)
    return value;
  return JSON.parse(JSON.stringify(value));
}

function parseAdminConfigValue(value) {
  if (typeof value !== "string")
    return { value: clonePlain(value), parsed: false };
  const trimmed = value.trim();
  if (!trimmed)
    return { value, parsed: false };
  try {
    return { value: JSON.parse(trimmed), parsed: true };
  }
  catch (err) {
    return {
      value,
      parsed: false,
      parseError: err?.message || "JSON parse failed",
    };
  }
}

function maskSensitiveString(value) {
  const text = String(value ?? "");
  if (!text)
    return "";
  if (text.length <= 6)
    return "***";
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

export function redactAdminConfigValue(value) {
  if (Array.isArray(value))
    return value.map(item => redactAdminConfigValue(item));
  if (!value || typeof value !== "object")
    return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SENSITIVE_CONFIG_KEY_RE.test(key)) {
      out[key] = raw == null || raw === ""
        ? raw
        : { masked: true, hasValue: true, value: maskSensitiveString(raw) };
      continue;
    }
    out[key] = redactAdminConfigValue(raw);
  }
  return out;
}

function parsePreferencesForAdmin(preferences) {
  const prefs = preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? preferences
    : {};
  const out = {};
  const parseErrors = {};
  for (const key of ADMIN_CONFIG_PREFERENCE_KEYS) {
    if (!(key in prefs))
      continue;
    const parsed = parseAdminConfigValue(prefs[key]);
    out[key] = redactAdminConfigValue(parsed.value);
    if (parsed.parseError)
      parseErrors[key] = parsed.parseError;
  }
  const extra = {};
  for (const [key, val] of Object.entries(prefs)) {
    if (ADMIN_CONFIG_PREFERENCE_KEYS.includes(key) || PROFILE_META_PREFERENCE_KEYS.has(key))
      continue;
    const parsed = parseAdminConfigValue(val);
    extra[key] = redactAdminConfigValue(parsed.value);
    if (parsed.parseError)
      parseErrors[key] = parsed.parseError;
  }
  return { preferences: out, extra, parseErrors };
}

function redactRawPreferencesForAdmin(preferences) {
  const prefs = preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? preferences
    : {};
  const out = {};
  for (const [key, value] of Object.entries(prefs)) {
    const parsed = parseAdminConfigValue(value);
    out[key] = redactAdminConfigValue(parsed.value);
  }
  return out;
}

/** 合并 profiles 三列配置，兼容已迁移库与仍含 setting 的旧行 */
export function profileSettingForAdmin(row) {
  if (!row || typeof row !== "object")
    return {};
  const legacy = row.setting;
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy) && Object.keys(legacy).length) {
    const out = { ...legacy };
    if (typeof out.USERCONFIG === "string") {
      try {
        out.USERCONFIG = JSON.parse(out.USERCONFIG);
      }
      catch {
        /* keep string */
      }
    }
    if (typeof out.CollectConfig === "string") {
      try {
        out.CollectConfig = JSON.parse(out.CollectConfig);
      }
      catch {
        /* keep string */
      }
    }
    const betting
      = out.USERCONFIG && typeof out.USERCONFIG === "object" && !Array.isArray(out.USERCONFIG)
        ? out.USERCONFIG
        : {};
    const collect
      = out.CollectConfig && typeof out.CollectConfig === "object" && !Array.isArray(out.CollectConfig)
        ? out.CollectConfig
        : {};
    const { USERCONFIG, CollectConfig, ...prefs } = out;
    const prefsForAdmin = Object.fromEntries(
      Object.entries(prefs).filter(([k]) => !PROFILE_META_PREFERENCE_KEYS.has(k)),
    );
    return normalizeAdminSettingFlags(sanitizeSettingForAdmin({
      ...prefsForAdmin,
      ...betting,
      ...(Object.keys(collect).length ? { CollectConfig: collect } : {}),
      ...(row.betting_config && typeof row.betting_config === "object" && !Array.isArray(row.betting_config)
        ? row.betting_config
        : {}),
    }));
  }
  const betting
    = row.betting_config && typeof row.betting_config === "object" && !Array.isArray(row.betting_config)
      ? row.betting_config
      : {};
  const collect
    = row.collect_config && typeof row.collect_config === "object" && !Array.isArray(row.collect_config)
      ? row.collect_config
      : {};
  const prefs
    = row.preferences && typeof row.preferences === "object" && !Array.isArray(row.preferences)
      ? row.preferences
      : {};
  const prefsForAdmin = Object.fromEntries(
    Object.entries(prefs).filter(([k]) => !PROFILE_META_PREFERENCE_KEYS.has(k)),
  );
  return normalizeAdminSettingFlags(sanitizeSettingForAdmin({
    ...prefsForAdmin,
    ...betting,
    ...(Object.keys(collect).length ? { CollectConfig: collect } : {}),
  }));
}

function normalizeAdminSettingFlags(setting) {
  if (!setting || typeof setting !== "object" || Array.isArray(setting))
    return setting;
  const out = { ...setting };
  if ("BetTarget" in out)
    out.BetTarget = parseFormBool(out.BetTarget);
  return out;
}

function resolveBettingState(p) {
  const setting = profileSettingForAdmin(p);
  const betting = Boolean(setting.betting);
  const autoOpen = Boolean(setting.bettingAutoOpen);
  const autoOpenTime = Number(setting.bettingAutoOpenTime) || 0;
  const scheduled = !betting && autoOpen && autoOpenTime > Date.now();
  const betMoney = Number(setting.betMoney) || 0;
  return {
    bettingEnabled: betting ? 1 : 0,
    bettingScheduled: scheduled ? 1 : 0,
    bettingAutoOpenTime: autoOpenTime,
    betMoney,
  };
}

function mapAdminUserRow(p, profitByUser = new Map()) {
  const name = String(p.user_name || "");
  const stats = profitByUser.get(name.toLowerCase());
  const id = String(p.id);
  const accounts = store.getAccountsForUser(id)
    .map(sanitizeAccountForAdmin)
    .filter(Boolean);
  const presence = resolvePresenceState(id, p);
  const bettingState = resolveBettingState(p);
  return {
    id,
    userName: name,
    isAdmin: Boolean(p.is_admin),
    role: p.role || (p.is_admin ? "admin" : "user"),
    teamId: p.team_id || null,
    isOnline: presence.isOnline,
    lastActiveAt: presence.lastActiveAt,
    ...bettingState,
    ...lastLoginFieldsFromProfile(p),
    accountCount: accounts.length,
    accounts,
    setting: profileSettingForAdmin(p),
    createdAt: Number(p.created_at) || 0,
    updatedAt: Number(p.updated_at) || 0,
    todayMoney: Number(stats?.Money ?? 0) || 0,
    todayCount: Number(stats?.Count ?? 0) || 0,
    todayBetMoney: Number(stats?.BetMoney ?? 0) || 0,
  };
}

export async function getAdminUserConfigDetail(userId, caller = null) {
  const id = String(userId || "").trim();
  if (!id)
    throw new Error("用户 ID 无效");

  const allProfiles = await sb.fetchProfilesAdmin();
  const visibleIds = resolveVisibleUserIds(caller, allProfiles);
  if (visibleIds && !visibleIds.has(id))
    throw new Error("无权查看该用户");

  const profile = (allProfiles || []).find(p => String(p.id) === id);
  if (!profile)
    throw new Error("用户不存在");

  await loadProfileById(id);
  await loadAccountsForUser(id);

  const bettingConfig = profile.betting_config && typeof profile.betting_config === "object" && !Array.isArray(profile.betting_config)
    ? profile.betting_config
    : {};
  const collectConfig = profile.collect_config && typeof profile.collect_config === "object" && !Array.isArray(profile.collect_config)
    ? profile.collect_config
    : {};
  const { preferences, extra, parseErrors } = parsePreferencesForAdmin(profile.preferences);
  const accounts = store.getAccountsForUser(id)
    .map(sanitizeAccountForAdmin)
    .filter(Boolean)
    .map(row => redactAdminConfigValue(row));
  const presence = resolvePresenceState(id, profile);

  return {
    user: {
      id,
      userName: String(profile.user_name || ""),
      role: profile.role || (profile.is_admin ? "admin" : "user"),
      teamId: profile.team_id || null,
      isAdmin: Boolean(profile.is_admin),
      isOnline: presence.isOnline,
      lastActiveAt: presence.lastActiveAt,
      ...lastLoginFieldsFromProfile(profile),
      createdAt: Number(profile.created_at) || 0,
      updatedAt: Number(profile.updated_at) || 0,
    },
    configs: {
      USERCONFIG: redactAdminConfigValue(clonePlain(bettingConfig) || {}),
      CollectConfig: redactAdminConfigValue(clonePlain(collectConfig) || {}),
      preferences,
      extraPreferences: extra,
      ACCOUNT: accounts,
    },
    parseErrors,
    raw: {
      betting_config: redactAdminConfigValue(clonePlain(bettingConfig) || {}),
      collect_config: redactAdminConfigValue(clonePlain(collectConfig) || {}),
      preferences: redactRawPreferencesForAdmin(profile.preferences),
    },
  };
}

export async function getAdminDashboard(dateKey = toDateKey(Date.now()), caller = null) {
  const [allProfiles, rank, orderStats] = await Promise.all([
    sb.fetchProfilesAdmin(),
    listUserProfitRank(dateKey),
    sb.fetchOrdersAdminStats(dateKey),
  ]);
  const visibleIds = resolveVisibleUserIds(caller, allProfiles);
  const profiles = filterProfiles(allProfiles, visibleIds);
  const profitByUser = new Map(
    (Array.isArray(rank) ? rank : []).map(r => [String(r.UserName).toLowerCase(), r]),
  );
  let activeUsersToday = 0;
  let totalMoney = 0;
  let totalBetMoney = 0;
  let orderCount = 0;
  for (const p of profiles) {
    const name = String(p.user_name || "").toLowerCase();
    const stats = profitByUser.get(name);
    if (stats && (stats.Count ?? 0) > 0) {
      activeUsersToday += 1;
      totalMoney += Number(stats.Money ?? 0) || 0;
      totalBetMoney += Number(stats.BetMoney ?? 0) || 0;
      orderCount += Number(stats.Count ?? 0) || 0;
    }
  }
  // 数据概览「当日盈利」：列出可见范围内全部非管理员用户（含 0 单），按盈利降序
  const topProfit = profiles
    .filter(p => !isAdminUser(p))
    .map((p) => {
      const name = String(p.user_name || "").trim();
      const stats = profitByUser.get(name.toLowerCase());
      return {
        UserID: Number(stats?.UserID) || 0,
        UserName: name,
        Money: Number(stats?.Money ?? 0) || 0,
        Count: Number(stats?.Count ?? 0) || 0,
        BetMoney: Number(stats?.BetMoney ?? 0) || 0,
        Date: dateKey,
      };
    })
    .sort((a, b) => b.Money - a.Money);
  return {
    date: dateKey,
    userCount: profiles.length,
    activeUsersToday,
    orderCount: visibleIds ? orderCount : orderStats.count,
    totalMoney: visibleIds ? totalMoney : orderStats.money,
    totalBetMoney: visibleIds ? totalBetMoney : orderStats.betMoney,
    topProfit,
  };
}

export async function listAdminUsers(dateKey = toDateKey(Date.now()), caller = null) {
  const [allProfiles, rank] = await Promise.all([
    sb.fetchProfilesAdmin(),
    listUserProfitRank(dateKey),
  ]);
  const visibleIds = resolveVisibleUserIds(caller, allProfiles);
  const profiles = filterProfiles(allProfiles, visibleIds);
  // 与 listAdminAccounts / Client_GetData(ACCOUNT) 一致：从 players 回源，避免运维改 owner 后内存缓存缺行
  await Promise.all((profiles || []).map(p => loadAccountsForUser(String(p.id))));
  const profitByUser = new Map(
    (Array.isArray(rank) ? rank : []).map(r => [String(r.UserName).toLowerCase(), r]),
  );
  return profiles
    .map(p => mapAdminUserRow(p, profitByUser))
    .sort((a, b) => b.todayMoney - a.todayMoney);
}

export async function getAdminUserDetail(userId, dateKey = toDateKey(Date.now())) {
  const id = String(userId || "").trim();
  if (!id)
    return null;
  const [profiles, rank] = await Promise.all([
    sb.fetchProfilesAdmin(),
    listUserProfitRank(dateKey),
  ]);
  const profitByUser = new Map(
    (Array.isArray(rank) ? rank : []).map(r => [String(r.UserName).toLowerCase(), r]),
  );
  const profile = (profiles || []).find(p => String(p.id) === id);
  if (!profile)
    return null;
  await loadAccountsForUser(id);
  return mapAdminUserRow(profile, profitByUser);
}

function validateNewPassword(password) {
  const pwd = String(password || "");
  if (pwd.length < 6)
    throw new Error("密码至少 6 位");
  return pwd;
}

function validateUserName(userName) {
  const name = String(userName || "").trim();
  if (!name)
    throw new Error("用户名必填");
  if (!/^[\w\u4E00-\u9FA5]+$/.test(name)) {
    throw new Error("用户名仅支持字母、数字、下划线或中文");
  }
  return name;
}

/** 管理端创建登录用户（RDS users + profiles） */
export async function createAdminUser(userName, password) {
  const name = validateUserName(userName);
  const pwd = validateNewPassword(password);
  const now = Date.now();

  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("RDS 未配置，无法创建用户");
  const existing = await pool.query(
    "SELECT id FROM users WHERE lower(user_name) = lower($1)",
    [name],
  );
  if (existing.rows.length)
    throw new Error("用户名已存在");
  const userId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, user_name, password_hash, metadata, created_at, updated_at)
     VALUES ($1, $2, crypt($3, gen_salt('bf', 12)), '{}', $4, $4)`,
    [userId, name, pwd, now],
  );
  const ok = await insertProfile(userId, {
    id: userId,
    user_name: name,
    accounts: [],
    betting_config: {},
    collect_config: {},
    preferences: {},
    created_at: now,
    updated_at: now,
  });
  if (!ok)
    throw new Error("profiles 创建失败");
  return { id: userId, userName: name };
}

/** 管理端删除用户（profiles ON DELETE CASCADE 自动级联） */
export async function deleteAdminUser(userId, operatorUserId) {
  const id = String(userId || "").trim();
  if (!id)
    throw new Error("用户 ID 无效");
  if (id === String(operatorUserId || "").trim()) {
    throw new Error("不能删除当前登录账号");
  }
  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("RDS 未配置");
  const { rows } = await pool.query("SELECT user_name, is_admin FROM users WHERE id = $1", [id]);
  if (!rows[0])
    throw new Error("用户不存在");
  if (rows[0].is_admin) {
    const { rows: admins } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM users WHERE is_admin = true",
    );
    if ((admins[0]?.n ?? 0) <= 1)
      throw new Error("至少保留一名管理员");
  }
  await pool.query("DELETE FROM users WHERE id = $1", [id]);
  return { id, userName: String(rows[0].user_name) };
}

/** 管理端更改登录用户名 */
export async function renameAdminUser(userId, userName, caller = null) {
  const id = String(userId || "").trim();
  if (!id)
    throw new Error("用户 ID 无效");
  if (caller && !isAdminUser(caller))
    throw new Error("仅管理员可更改用户名");
  const name = validateUserName(userName);

  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("RDS 未配置");

  const { rows } = await pool.query(
    "SELECT user_name FROM users WHERE id = $1",
    [id],
  );
  if (!rows[0])
    throw new Error("用户不存在");
  const current = String(rows[0].user_name || "");
  if (current.toLowerCase() === name.toLowerCase()) {
    if (current === name)
      return { id, userName: name };
    const ok = await sb.updateUserName(id, name);
    if (!ok)
      throw new Error("更新用户名失败");
    await loadProfileById(id);
    return { id, userName: name };
  }

  const existing = await pool.query(
    "SELECT id FROM users WHERE lower(user_name) = lower($1) AND id <> $2",
    [name, id],
  );
  if (existing.rows.length)
    throw new Error("用户名已存在");

  const ok = await sb.updateUserName(id, name);
  if (!ok)
    throw new Error("更新用户名失败");
  await loadProfileById(id);
  return { id, userName: name };
}

/** 管理端重置用户登录密码 */
export async function resetAdminUserPassword(userId, password, caller = null) {
  const id = String(userId || "").trim();
  if (!id)
    throw new Error("用户 ID 无效");
  if (caller && !isAdminUser(caller)) {
    const visibleIds = await getVisibleUserIds(caller);
    if (visibleIds && !visibleIds.has(id))
      throw new Error("无权操作该用户");
  }
  const pwd = validateNewPassword(password);
  const now = Date.now();

  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("RDS 未配置");
  const { rows } = await pool.query(
    "SELECT user_name FROM users WHERE id = $1",
    [id],
  );
  if (!rows[0])
    throw new Error("用户不存在");
  await pool.query(
    `UPDATE users SET password_hash = crypt($2, gen_salt('bf', 12)), updated_at = $3 WHERE id = $1`,
    [id, pwd, now],
  );
  return { id, userName: String(rows[0].user_name) };
}

async function writeProfilePreferencesAwait(uid, preferences) {
  const id = String(uid);
  const now = Date.now();
  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("RDS 未配置");
  const { rowCount } = await pool.query(
    `UPDATE profiles SET preferences = $2::jsonb, updated_at = $3 WHERE id = $1`,
    [id, JSON.stringify(preferences || {}), now],
  );
  if (!rowCount)
    throw new Error("用户不存在");
}

/** 操盘 Tab：远程 query 失败时，管理端从 RDS 读取账号快照（对齐 TradeRemoteAccount 形状） */
function mapAccountForTrade(raw) {
  const row = sanitizeAccountForAdmin(raw);
  if (!row?.accountId)
    return null;
  return {
    accountId: row.accountId,
    platformName: row.platformName,
    platformId: row.platformId,
    playerName: row.playerName,
    provider: row.platform,
    balance: row.balance,
    pause: row.pause,
    lastOdds: row.lastOdds,
    profit: row.profit,
    maxBetCount: row.maxBetCount,
    minOdds: row.minOdds,
    maxOdds: row.maxOdds,
    multiply: row.multiply,
  };
}

export async function getAdminUserTradeAccounts(userId, provider, caller = null) {
  const uid = String(userId || "").trim();
  if (!uid)
    throw new Error("用户 ID 无效");
  if (caller && !isAdminUser(caller)) {
    const visibleIds = await getVisibleUserIds(caller);
    if (visibleIds && !visibleIds.has(uid))
      throw new Error("无权查看该用户");
  }
  await loadProfileById(uid);
  await loadAccountsForUser(uid);
  const platform = String(provider || "").trim();
  return store.getAccountsForUser(uid)
    .map(mapAccountForTrade)
    .filter(Boolean)
    .filter(row => !platform || row.provider === platform);
}

/** 管理端子账号列表（按可见用户从 RDS 回源；含软删账号） */
export async function listAdminAccounts(caller = null) {
  const allProfiles = await sb.fetchProfilesAdmin();
  const visibleIds = resolveVisibleUserIds(caller, allProfiles);
  const profiles = filterProfiles(allProfiles, visibleIds);
  const out = [];
  await Promise.all((profiles || []).map(async (p) => {
    const id = String(p.id);
    await loadAccountsForUser(id);
    const accounts = store.getAccountsForUser(id);
    let deletedAccounts = [];
    try {
      deletedAccounts = await sb.fetchDeletedAccountRecordsByOwner(id);
    }
    catch (err) {
      console.warn("[admin] fetchDeletedAccountRecordsByOwner:", err?.message || err);
    }
    const pushRow = async (raw) => {
      const detail = sanitizeAccountForAdmin(raw);
      if (!detail)
        return;
      if (String(detail.platform || detail.provider || "") === "PredictFun" && detail.accountId && !detail.deleted) {
        try {
          const orders = await orderStore.listByPlayer(detail.accountId, id);
          const stats = summarizePfOrders(orders);
          // 余额以 total_balance（detail.balance）为准；credit 对 PF 无意义
          detail.credit = 0;
          detail.totalProfit = stats.settledPnl;
          detail.unsettle = stats.unsettle;
        }
        catch {
          detail.credit = 0;
        }
      }
      out.push({
        userId: id,
        userName: String(p.user_name || ""),
        teamId: p.team_id || null,
        ...detail,
      });
    };
    for (const raw of accounts)
      await pushRow(raw);
    for (const raw of deletedAccounts)
      await pushRow(raw);
  }));
  out.sort((a, b) => {
    const u = String(a.userName).localeCompare(String(b.userName), "zh");
    if (u)
      return u;
    const ad = a.deleted ? 1 : 0;
    const bd = b.deleted ? 1 : 0;
    if (ad !== bd)
      return ad - bd;
    const p = String(a.platform).localeCompare(String(b.platform));
    if (p)
      return p;
    return Number(a.accountId) - Number(b.accountId);
  });
  return out;
}

/** 管理端修改指定用户账号乘网（普通用户自助保存会被服务端忽略 multiply） */
export async function updateAdminAccountMultiply(userId, accountId, multiply, caller = null) {
  return updateAdminAccountFields(userId, accountId, { multiply }, caller);
}

/**
 * 管理端更新子账号字段（额度 / 暂停 / 乘网 / 备注等）
 * @param {string} userId
 * @param {number} accountId
 * @param {Record<string, unknown> | string} patch
 * @param {object | null} caller
 */
export async function updateAdminAccountFields(userId, accountId, patch = {}, caller = null) {
  const uid = String(userId || "").trim();
  const aid = Number(accountId);
  if (!uid)
    throw new Error("用户 ID 无效");
  if (!aid)
    throw new Error("accountId 无效");
  if (caller && !isAdminUser(caller)) {
    const visibleIds = await getVisibleUserIds(caller);
    if (visibleIds && !visibleIds.has(uid))
      throw new Error("无权操作该用户");
  }
  await loadProfileById(uid);
  await loadAccountsForUser(uid);
  const accounts = store.getAccountsForUser(uid);
  const row = accounts.find(a => Number(a.accountId ?? a.AccountId) === aid);
  if (!row)
    throw new Error("账号不存在");

  let fields = patch;
  if (typeof fields === "string") {
    try {
      fields = JSON.parse(fields);
    }
    catch {
      throw new Error("patch JSON 无效");
    }
  }
  if (!fields || typeof fields !== "object" || Array.isArray(fields))
    fields = {};

  const updates = {};
  const isPf = String(row.provider || row.Provider || "") === "PredictFun"
    || String(row.platformName || "").toLowerCase().includes("predict");

  // PF：会员充值已下线；禁止经此绝对值改 balance/credit
  if (isPf && ("balance" in fields || "credit" in fields))
    throw new Error("PredictFun 会员充值已下线，不可直接改余额");
  if ("credit" in fields)
    updates.credit = Number(fields.credit) || 0;
  if ("maxBalance" in fields)
    updates.maxBalance = Number(fields.maxBalance) || 0;
  if ("pause" in fields)
    updates.pause = parseFormBool(fields.pause);
  if ("description" in fields)
    updates.description = String(fields.description ?? "");
  if ("currency" in fields)
    updates.currency = String(fields.currency || "").trim() || undefined;
  if ("multiply" in fields) {
    const providerKey = accountProviderKey(row);
    updates.multiply = resolveAccountMultiply(providerKey, fields.multiply);
  }
  if (!Object.keys(updates).length)
    throw new Error("没有可更新的字段");

  const updated = await store.updateAccountForUser(uid, aid, updates);
  if (!updated)
    throw new Error("更新失败");
  // PredictFun house 默认 USDT：历史行可能缺 currency
  let result = updated;
  if (String(updated.provider || row.provider || "") === "PredictFun"
    && !String(updated.currency || "").trim()) {
    const withCcy = await store.updateAccountForUser(uid, aid, { currency: "USDT" });
    result = withCcy || updated;
  }
  return sanitizeAccountForAdmin(result);
}

/** 管理端开关用户 BetTarget（profiles.betting_config，对齐 A8 Setting） */
export async function updateAdminUserBetTarget(userId, betTarget, caller = null) {
  const uid = String(userId || "").trim();
  if (!uid)
    throw new Error("用户 ID 无效");
  if (caller && !isAdminUser(caller)) {
    const visibleIds = await getVisibleUserIds(caller);
    if (visibleIds && !visibleIds.has(uid))
      throw new Error("无权操作该用户");
  }
  await loadProfileById(uid);
  const enabled = parseFormBool(betTarget);
  await store.updateUserSetting(uid, { BetTarget: enabled });
  const row = listProfileRows().find(p => String(p.id) === uid);
  if (!row)
    throw new Error("用户不存在");
  const setting = profileSettingForAdmin(row);
  setting.BetTarget = enabled;
  return {
    id: uid,
    userName: String(row.user_name || ""),
    betTarget: enabled,
    setting,
  };
}

/** 登录/API 鉴权占位（A8 bundle 无 admin 冻结用户） */
export async function assertProfileActive(_userId) {}

/** 管理端设置/取消管理员（users.is_admin） */
export async function setAdminUserAdmin(userId, isAdmin, operatorUserId) {
  const id = String(userId || "").trim();
  if (!id)
    throw new Error("用户 ID 无效");
  const wantAdmin = Boolean(isAdmin);
  const op = String(operatorUserId || "").trim();
  if (op && id === op && !wantAdmin) {
    throw new Error("不能取消当前登录账号的管理员权限");
  }

  const row = await sb.fetchProfileById(id);
  if (!row)
    throw new Error("用户不存在");
  const name = String(row.user_name || "");
  const wasAdmin = Boolean(row.is_admin);
  if (wasAdmin === wantAdmin) {
    return { id, userName: name, isAdmin: wantAdmin ? 1 : 0 };
  }

  if (wasAdmin && !wantAdmin) {
    await ensurePgPoolReady();
    const pool = getPgPool();
    if (!pool)
      throw new Error("RDS 未配置");
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM users WHERE is_admin = true",
    );
    if ((rows[0]?.n ?? 0) <= 1) {
      throw new Error("至少保留一名管理员");
    }
  }

  const ok = await sb.updateUserIsAdmin(id, wantAdmin);
  if (!ok)
    throw new Error("更新管理员状态失败");
  await loadProfileById(id);
  return { id, userName: name, isAdmin: wantAdmin ? 1 : 0 };
}

const VALID_ROLES = ["admin", "leader", "user"];

/** 管理端设置用户角色和团队 */
export async function setAdminUserRole(userId, role, teamId, operatorUserId) {
  const id = String(userId || "").trim();
  if (!id)
    throw new Error("用户 ID 无效");
  if (!VALID_ROLES.includes(role))
    throw new Error("无效角色，可选：admin / leader / user");
  const op = String(operatorUserId || "").trim();
  const currentRole = op ? (await sb.fetchProfileById(op))?.role : null;
  if (op && id === op && role !== currentRole) {
    throw new Error("不能更改当前登录账号的角色");
  }

  const row = await sb.fetchProfileById(id);
  if (!row)
    throw new Error("用户不存在");
  const name = String(row.user_name || "");
  const wasAdmin = Boolean(row.is_admin) || row.role === "admin";

  if (wasAdmin && role !== "admin") {
    await ensurePgPoolReady();
    const pool = getPgPool();
    if (!pool)
      throw new Error("RDS 未配置");
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM users WHERE is_admin = true",
    );
    if ((rows[0]?.n ?? 0) <= 1) {
      throw new Error("至少保留一名管理员");
    }
  }

  const tid = teamId !== undefined ? (teamId || null) : row.team_id;

  if (role === "leader" && !tid) {
    throw new Error("团队长必须分配到一个团队");
  }

  if (tid) {
    const teams = await sb.fetchTeams();
    if (!teams.some(t => t.id === tid)) {
      throw new Error(`团队「${tid}」不存在，请先创建`);
    }
  }

  const roleOk = await sb.updateUserRole(id, role);
  if (!roleOk)
    throw new Error("更新角色失败");
  if (tid !== row.team_id) {
    await sb.updateUserTeamId(id, tid);
  }
  await loadProfileById(id);
  return { id, userName: name, role, teamId: tid || null, isAdmin: role === "admin" ? 1 : 0 };
}

/** 管理端：团队列表 */
export async function listTeams() {
  return sb.fetchTeams();
}

/** 管理端：创建或更新团队（id 为空时自动生成） */
export async function upsertTeam(id, name) {
  const tname = String(name || "").trim();
  if (!tname)
    throw new Error("团队名称必填");
  const tid = String(id || "").trim() || `t${Date.now().toString(36)}`;
  const ok = await sb.upsertTeam(tid, tname);
  if (!ok)
    throw new Error("保存团队失败");
  return { id: tid, name: tname };
}

/** 管理端：删除团队 */
export async function deleteTeam(id) {
  const tid = String(id || "").trim();
  if (!tid)
    throw new Error("团队 ID 必填");
  await ensurePgPoolReady();
  const pool = getPgPool();
  if (pool) {
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM users WHERE team_id = $1",
      [tid],
    );
    if ((rows[0]?.n ?? 0) > 0) {
      throw new Error(`团队内还有 ${rows[0].n} 个成员，请先移除`);
    }
  }
  const ok = await sb.deleteTeam(tid);
  if (!ok)
    throw new Error("删除团队失败或不存在");
  return { id: tid };
}

/** 数据分析 / 正 EV 分析共用：解析日/月/全部时间窗 */
function resolveAnalyticsRange(body = {}) {
  let startMs, endMs;
  // form-urlencoded：all=true 会变成字符串 "true"
  const allFlag = body.all === true || body.all === 1 || body.all === "1"
    || body.all === "true" || body.all === "yes"
    || body.period === "all" || body.range === "all";
  if (allFlag) {
    // 「全部」：从 epoch 到当前时刻后 1ms（半开区间）
    startMs = 0;
    endMs = Date.now() + 1;
  }
  else if (body.startMs && body.endMs) {
    startMs = Number(body.startMs);
    endMs = Number(body.endMs);
  }
  else if (body.month) {
    const parts = String(body.month).split("-").map(Number);
    const y = parts[0] || new Date().getFullYear();
    const m = parts[1] || new Date().getMonth() + 1;
    startMs = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
    endMs = new Date(y, m, 1, 0, 0, 0, 0).getTime();
  }
  else {
    const dk = body.date || toDateKey(Date.now());
    const parts = String(dk).split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2] || 1, 0, 0, 0, 0);
    startMs = d.getTime();
    endMs = startMs + 86400000;
  }
  return { startMs, endMs };
}

async function resolveAnalyticsUserIds(caller) {
  if (!caller || isAdminUser(caller))
    return undefined;
  const allProfiles = await sb.fetchProfilesAdmin();
  const visibleIds = resolveVisibleUserIds(caller, allProfiles);
  return visibleIds ? [...visibleIds] : undefined;
}

export async function getPlatformAnalytics(body = {}, caller = null) {
  const { startMs, endMs } = resolveAnalyticsRange(body);
  const userIds = await resolveAnalyticsUserIds(caller);
  const [platforms, pairs, games, hourly, accounts, obArbOdds, rayArbOdds] = await Promise.all([
    sb.fetchPlatformAnalytics(startMs, endMs, userIds),
    sb.fetchArbPairAnalytics(startMs, endMs, userIds),
    sb.fetchGameAnalytics(startMs, endMs, userIds),
    sb.fetchHourlyAnalytics(startMs, endMs, userIds),
    sb.fetchAccountAnalytics(startMs, endMs, userIds),
    sb.fetchArbOddsAnalytics(startMs, endMs, userIds, "OB"),
    sb.fetchArbOddsAnalytics(startMs, endMs, userIds, "RAY"),
  ]);
  return { startMs, endMs, platforms, pairs, games, hourly, accounts, obArbOdds, rayArbOdds };
}

/** [changmen 扩展] 正 EV 历史统计（场馆 × 赔率区间） */
export async function getValueBetOrderAnalytics(body = {}, caller = null) {
  const { startMs, endMs } = resolveAnalyticsRange(body);
  const userIds = await resolveAnalyticsUserIds(caller);
  const valueBet = await sb.fetchValueBetOrderAnalytics(startMs, endMs, userIds);
  return { startMs, endMs, ...valueBet };
}

export async function getPolymarketBuilderDashboard(body = {}, caller = null) {
  if (caller && !isAdminUser(caller))
    throw new Error("无管理员权限");
  const { getPolymarketBuilderDashboard: load } = await import(
    "../integrations/polymarket/builder_dashboard.js"
  );
  return load(body, caller);
}
