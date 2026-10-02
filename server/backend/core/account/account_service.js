import { isVenueAccountKeyUniqueViolation, VenueAccountKeyConflictError } from "@changmen/db/venue_account_key.js";
import { normalizeAccountMultiplyField, preserveStoredAccountMultiply } from "@changmen/shared/account_multiply";
import { saveObservationBatch } from "../admin_tools/order_observation.js";
import * as dbStore from "../db/store.js";
import store from "../esport-api/store.js";
import { emptyPage } from "../esport-api/stubs.js";
import {
  emptyDirectValue,
  isArrayKey,
  wrapObjectDirect,
} from "../esport-api/user_kv.js";
import * as accountStore from "./account_store.js";
import { preserveStoredAccountToken } from "./account_token_preserve.js";
import {
  enrichAccountFromPlatformDefaults,
  getAccountBalance,
} from "./balance_provider.js";
import {
  isObSportBetToken,
  mergeSportObPatch,
  preserveSportObOnAccountSave,
  validateSportObMemberBinding,
} from "./ob_sport_account.js";
import * as orderStore from "./order_store.js";
import { assertPlayerOwnedByUser, assertPlayersOwnedByUser, isPredictFunPlayerRow } from "./player_ownership.js";
import { enforcePolymarketPersistDto, stripPrivateKeysFromAccountList } from "./pm_token_strip.js";
import { resolvePresenceState } from "./user_presence.js";

async function handleCreateTagPlatform(body, userId) {
  const platformName = body.platform || body.platformName || "";
  const playerName = body.playerName || "";
  const venueMemberId = String(body.venueMemberId || body.venueId || "").trim();
  const provider = String(body.provider || "").trim();
  if (!userId) {
    return { ok: false, msg: "请先登录" };
  }
  if (!platformName) {
    return { ok: false, msg: "platform 必填" };
  }
  if (venueMemberId) {
    if (!provider)
      return { ok: false, msg: "provider 与 venueMemberId 必填" };
  }
  else if (!playerName) {
    return { ok: false, msg: "platform 与 playerName 必填" };
  }
  try {
    const created = await accountStore.createTagPlatform(
      platformName,
      playerName,
      userId,
      { venueMemberId, provider },
    );
    // CreateTagPlatform 只写 players，主动回源，避免随后 GetData 命中缺行的内存缓存
    await dbStore.loadAccountsForUser(userId);
    return { ok: true, info: created };
  }
  catch (err) {
    return { ok: false, msg: err.message || "CreateTagPlatform 失败" };
  }
}

async function handleGetTagPlatforms() {
  return { ok: true, info: await accountStore.listTagPlatforms() };
}

/** PredictFun house：余额/订单仅服务端 Pf_* 写入；身份看 players，不看可改的 ACCOUNT.provider */
function isPredictFunClientSaveOrderRequest(body, orders, player) {
  const type = String(body?.type ?? body?.Type ?? "").trim().toLowerCase();
  if (type === "predictfun")
    return true;
  if (Array.isArray(orders) && orders.some((o) => {
    const p = String(o?.provider ?? o?.Type ?? "").trim().toLowerCase();
    return p === "predictfun";
  })) {
    return true;
  }
  return isPredictFunPlayerRow(player);
}

async function handleUpdateBalance(body, userId) {
  const playerId = body.playerId;
  const balance = Number(body.balance);
  if (!playerId || Number.isNaN(balance)) {
    return { ok: false, msg: "playerId 与 balance 必填" };
  }
  if (userId) {
    const owned = await assertPlayerOwnedByUser(playerId, userId);
    if (!owned.ok)
      return owned;
    if (isPredictFunPlayerRow(owned.player)) {
      return {
        ok: false,
        msg: "PredictFun 余额仅由服务端买卖/结算更新，禁止 Client_UpdateBalance",
      };
    }
    const info = await accountStore.updatePlayerBalance(playerId, balance, userId);
    if (!info) {
      return { ok: false, msg: "更新余额失败" };
    }
    return { ok: true, info };
  }
  const player = await accountStore.getPlayer(playerId);
  if (!player) {
    return { ok: false, msg: "player 不存在" };
  }
  const info = await accountStore.updatePlayerBalance(playerId, balance, userId);
  if (!info) {
    return { ok: false, msg: "更新余额失败" };
  }
  return { ok: true, info };
}

async function handleDeletePlayer(body, userId) {
  const playerId = body.playerId;
  if (!playerId)
    return { ok: false, msg: "playerId 必填" };
  const owned = await assertPlayerOwnedByUser(playerId, userId);
  if (!owned.ok)
    return owned;
  const ok = await accountStore.deletePlayer(playerId, body.description || "", userId);
  if (ok)
    await accountStore.deletePlayerData(playerId, userId);
  if (userId)
    store.removeAccountForUser(userId, playerId);
  return ok ? { ok: true, info: true } : { ok: false, msg: "player 不存在" };
}

async function handleGetMoneyLogs(body, userId) {
  const playerId = body.playerId;
  if (!playerId)
    return { ok: false, msg: "playerId 必填" };
  const owned = await assertPlayerOwnedByUser(playerId, userId);
  if (!owned.ok)
    return owned;
  const pageIndex = Number(body.pageIndex) || 1;
  const pageSize = Number(body.pageSize) || 20;
  return { ok: true, info: await accountStore.listMoneyLogs(playerId, pageIndex, pageSize, userId) };
}

async function handleGetMoneyLog(body, userId) {
  const row = await accountStore.getMoneyLog(body.logId, userId);
  return { ok: true, info: row };
}

async function handleSaveMoneyLog(body, userId) {
  if (!userId)
    return { ok: false, msg: "请先登录" };
  const playerId = body.playerId ?? body.PlayerID;
  if (!playerId)
    return { ok: false, msg: "playerId 必填" };
  const owned = await assertPlayerOwnedByUser(playerId, userId);
  if (!owned.ok)
    return owned;
  const row = await accountStore.saveMoneyLog(body, userId);
  if (!row)
    return { ok: false, msg: "保存失败" };
  return { ok: true, info: row };
}

async function handleDeleteMoneyLog(body, userId) {
  const ok = await accountStore.deleteMoneyLog(body.logId, userId);
  return ok ? { ok: true, info: true } : { ok: false, msg: "log 不存在" };
}

async function handleGetPlayerOrder(body, userId) {
  const playerId = body.playerId;
  if (!playerId)
    return { ok: false, msg: "playerId 必填" };
  const owned = await assertPlayerOwnedByUser(playerId, userId);
  if (!owned.ok)
    return owned;
  // [changmen 扩展] includeLogs=false：PM getOrders 合并不需要流水，避免每次拉 1 万条
  const includeLogs = body?.includeLogs !== false && body?.includeLogs !== 0 && body?.includeLogs !== "0";
  let logs = [];
  if (includeLogs) {
    const page = await accountStore.listMoneyLogs(playerId, 1, 10000, userId);
    logs = (page.data || []).map(row => ({
      ID: row.logId,
      Type: row.type,
      Money: Number(row.money) || 0,
      Currency: row.currency || "CNY",
      Description: row.description || "",
      IsAuto: /\d+sec|\d+s$/i.test(row.description || "") ? 1 : 0,
      CreateAt: row.createAt || 0,
    }));
  }
  // [changmen 扩展] sinceCreateAt：窗口内 + 未结；省略则全量（MoneyRiskView）
  const sinceCreateAt = Number(body?.sinceCreateAt);
  const listOpts = Number.isFinite(sinceCreateAt) && sinceCreateAt > 0
    ? { sinceCreateAt }
    : undefined;
  const orders = (await orderStore.listByPlayer(playerId, userId, listOpts)).map(orderStore.scrubClientOrder);
  return { ok: true, info: { logs, orders } };
}

async function handleSaveOrder(body, userId) {
  const playerId = body.playerId;
  if (!playerId)
    return { ok: false, msg: "playerId 必填" };
  const owned = await assertPlayerOwnedByUser(playerId, userId);
  if (!owned.ok)
    return owned;
  let orders = [];
  try {
    orders = JSON.parse(body.orders || "[]");
  }
  catch {
    return { ok: false, msg: "orders JSON 无效" };
  }
  // PF：用户只提交下单意图（金额/价格），订单真相只经 Pf_* 服务端写入
  if (isPredictFunClientSaveOrderRequest(body, orders, owned.player)) {
    return {
      ok: false,
      msg: "PredictFun 订单禁止 Client_SaveOrder，请仅通过 Pf_SubmitOrder / Pf_GetOrders 等服务端路径更新",
    };
  }
  const saved = await orderStore.saveOrder(
    playerId,
    orders,
    userId,
    body.type || body.Type || "",
  );
  if (!saved)
    return { ok: false, msg: "保存订单失败" };
  return { ok: true, info: true };
}

function handleGetUsers() {
  const info = dbStore.listProfileRows().map((p) => {
    const id = String(p.id);
    const presence = resolvePresenceState(id, p);
    return {
      userId: id,
      userName: p.user_name || "",
      isOnline: presence.isOnline,
    };
  });
  return { ok: true, info };
}

/** A8 Io.loadAccounts：ACCOUNT 返回时归一化 PB / Polymarket 乘网默认 */
function enrichAccountRowFromPlayer(row) {
  return normalizeAccountMultiplyField(row);
}

/** [A8 可证实] accountId = CreateTagPlatform 返回的 playerId，禁止客户端自增 */
async function validateAccountRows(accounts, userId) {
  if (!Array.isArray(accounts))
    return { ok: false, msg: "ACCOUNT 必须是数组" };
  const seen = new Set();
  const ids = [];
  for (const row of accounts) {
    const id = Number(row?.accountId ?? row?.AccountId);
    if (!id) {
      return { ok: false, msg: "accountId 无效，请先调用 Client_CreateTagPlatform" };
    }
    if (seen.has(id))
      return { ok: false, msg: `accountId ${id} 重复` };
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length)
    return { ok: true };
  return assertPlayersOwnedByUser(ids, userId);
}

async function handleSaveAccounts(accounts, userId) {
  let existing;
  try {
    existing = await dbStore.prepareAccountsForSave(userId);
  }
  catch (err) {
    // RDS 读失败：绝不能用"空 existing"去合并/prune（会丢服务端字段、误软删账号）→ 中止保存
    console.error("[account] prepareAccountsForSave 读失败，已中止保存以防误删账号:", err?.message);
    return { ok: false, msg: "账号读取失败，请稍后重试（已阻止覆盖）" };
  }
  if (Array.isArray(accounts) && accounts.length === 0 && existing.length > 0) {
    return { ok: false, msg: "禁止用空列表覆盖已有账号，请刷新页面后重试" };
  }
  const checked = await validateAccountRows(accounts, userId);
  if (!checked.ok)
    return checked;
  const existingById = new Map(
    store.getAccountsForUser(userId).map(a => [Number(a.accountId ?? a.AccountId), a]),
  );
  // players 平台身份（含 provider）不可由客户端 ACCOUNT 覆盖
  const playerById = new Map(
    (checked.players || []).map(p => [Number(p.id), p]),
  );
  const normalized = accounts.map((row) => {
    const id = Number(row?.accountId ?? row?.AccountId);
    const enriched = enrichAccountRowFromPlayer(row);
    const prev = existingById.get(id);
    const player = playerById.get(id);
    const locked = preserveStoredAccountToken(
      preserveStoredAccountMultiply(enriched, prev),
      prev,
    );
    // 禁止客户端改掉服务端绑定的场馆身份（尤其 PredictFun）
    if (player?.provider)
      locked.provider = player.provider;
    else if (prev?.provider)
      locked.provider = prev.provider;
    const withSport = preserveSportObOnAccountSave(locked, prev);
    if (isPredictFunPlayerRow(player || prev || withSport)) {
      withSport.provider = "PredictFun";
      // PF 余额真相在 players.total_balance（debit/credit/充值）；
      // 客户端 SaveData 常省略 balance（PlatformAccount 构造后为 undefined），
      // Number(undefined)||0 会把账本绝对 SET 成 0。
      // 历史误写在 credit：与 resolvePfBalance / RDS CASE 对齐，迁入后再清 credit。
      const tb = Number(player?.totalBalance);
      const cr = Number(player?.credit);
      const keep = Number.isFinite(tb) && tb === 0 && Number.isFinite(cr) && cr > 0
        ? cr
        : tb;
      withSport.balance = Number.isFinite(keep) ? keep : 0;
      withSport.totalBalance = withSport.balance;
      withSport.credit = 0;
    }
    return withSport;
  });
  const dto = enforcePolymarketPersistDto(normalized);
  if (!dto.ok)
    return dto;
  try {
    await store.setAccountsForUser(userId, normalized);
  }
  catch (err) {
    if (err instanceof VenueAccountKeyConflictError || isVenueAccountKeyUniqueViolation(err))
      return { ok: false, msg: err.message || "该场馆操盘账号已被其他用户使用" };
    throw err;
  }
  const keepIds = normalized.map(r => Number(r?.accountId ?? r?.AccountId)).filter(Boolean);
  if (keepIds.length > 0) {
    await accountStore.prunePlayersNotInList(userId, keepIds);
  }
  return { ok: true, info: true };
}

function parseSaveSportAccountRows(body) {
  const raw = body && typeof body === "object" ? body : {};
  let list = raw.accounts;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    }
    catch {
      list = [];
    }
  }
  if (!Array.isArray(list))
    list = [raw];
  const rows = [];
  for (const item of list) {
    if (!item || typeof item !== "object")
      continue;
    const accountId = Number(item.accountId ?? item.AccountId);
    if (!accountId)
      continue;
    rows.push({
      accountId,
      clear: item.clear === true || item.token === "",
      token: item.token,
      gateway: item.gateway,
      referer: item.referer,
      venueMemberId: item.venueMemberId ?? item.uid ?? item.sessionId,
      venueAccountName: item.venueAccountName ?? item.userName,
    });
  }
  if (!rows.length)
    return { ok: false, msg: "accountId 必填" };
  return { ok: true, rows };
}

/** [changmen 扩展] 只写 OB 体育凭证；不改电竞 token / 不 prune */
async function handleSaveSportAccount(body, userId) {
  if (!userId)
    return { ok: false, msg: "请先登录" };
  const parsed = parseSaveSportAccountRows(body);
  if (!parsed.ok)
    return parsed;
  try {
    await dbStore.loadAccountsForUser(userId);
  }
  catch (err) {
    console.error("[account] SaveSportAccount 读失败:", err?.message);
    return { ok: false, msg: "账号读取失败，请稍后重试" };
  }
  const ids = parsed.rows.map(row => row.accountId);
  const owned = await assertPlayersOwnedByUser(ids, userId);
  if (!owned.ok)
    return owned;
  const list = (store.getAccountsForUser(userId) || []).map(row => (
    row && typeof row === "object" ? { ...row } : row
  ));
  const byId = new Map(list.map(row => [Number(row?.accountId ?? row?.AccountId), row]));
  for (const patch of parsed.rows) {
    const current = byId.get(patch.accountId);
    if (!current)
      return { ok: false, msg: `账号 ${patch.accountId} 不存在` };
    if (String(current.provider || "").trim().toUpperCase() !== "OB")
      return { ok: false, msg: "仅 OB 账号可保存体育 token" };
    if (patch.clear) {
      delete current.sportOb;
      continue;
    }
    const token = String(patch.token || "").trim();
    const gateway = String(patch.gateway || "").trim();
    const venueMemberId = String(patch.venueMemberId || "").trim();
    const venueAccountName = String(patch.venueAccountName || "").trim();
    if (!isObSportBetToken(token))
      return { ok: false, msg: "体育 token 格式无效" };
    if (!/^\d{18,}$/.test(venueMemberId))
      return { ok: false, msg: "体育账号 UID 无效" };
    const bindingError = validateSportObMemberBinding(current, { venueAccountName });
    if (bindingError)
      return { ok: false, msg: bindingError };
    try {
      const url = new URL(gateway);
      if (!/^https?:$/.test(url.protocol))
        return { ok: false, msg: "体育网关无效" };
    }
    catch {
      return { ok: false, msg: "体育网关无效" };
    }
    const merged = mergeSportObPatch(current.sportOb, patch);
    if (merged)
      current.sportOb = merged;
    else
      delete current.sportOb;
  }
  try {
    await store.setAccountsForUser(userId, list);
  }
  catch (err) {
    if (err instanceof VenueAccountKeyConflictError || isVenueAccountKeyUniqueViolation(err))
      return { ok: false, msg: err.message || "该场馆操盘账号已被其他用户使用" };
    throw err;
  }
  return { ok: true, info: true };
}

async function handleSaveData(key, content, userId) {
  if (key === "ACCOUNT") {
    let accounts = [];
    try {
      accounts = content ? JSON.parse(content) : [];
    }
    catch {
      return { ok: false, msg: "ACCOUNT JSON 无效" };
    }
    return handleSaveAccounts(accounts, userId);
  }
  if (store.isUserSettingKey(key)) {
    try {
      await store.setUserSetting(userId, key, content ?? "");
    }
    catch {
      return { ok: false, msg: "设置保存失败，请重试" };
    }
    return { ok: true, info: true };
  }
  return { ok: true, info: true };
}

function handleGetData(key, userId) {
  if (key === "ACCOUNT") {
    const accounts = store.getAccountsForUser(userId);
    const stripped = stripPrivateKeysFromAccountList(
      accounts.map(a => (a && typeof a === "object" ? { ...a } : a)),
    );
    return { ok: true, info: stripped, direct: stripped };
  }

  const isUserScoped = store.isUserSettingKey(key);
  const raw = isUserScoped ? store.getUserSetting(userId, key) : null;
  if (raw == null) {
    const empty = emptyDirectValue(key);
    if (empty !== null) {
      return { ok: true, info: empty, direct: empty };
    }
    return { ok: true, info: null, direct: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  }
  catch {
    parsed = raw;
  }

  if (Array.isArray(parsed)) {
    const rows
      = key === "ACCOUNT" ? parsed.map(row => enrichAccountRowFromPlayer(row)) : parsed;
    return { ok: true, info: rows, direct: rows };
  }
  if (parsed && typeof parsed === "object") {
    const direct = isUserScoped ? parsed : wrapObjectDirect(parsed);
    return { ok: true, info: parsed, direct };
  }
  if (isArrayKey(key)) {
    return { ok: true, info: [], direct: [] };
  }
  return { ok: true, info: parsed, direct: parsed };
}

async function refreshAccountBalance(accountRow, userId) {
  const enriched = enrichAccountFromPlatformDefaults(accountRow);
  // PredictFun：余额只认 RDS（Pf_* / 管理端授信），禁止批量刷新用场馆探测回写
  if (String(enriched.provider ?? "").trim() === "PredictFun")
    return { account: enriched, balance: null };
  if (!enriched.gateway || !enriched.token) {
    return { account: enriched, balance: null };
  }
  try {
    const bal = await getAccountBalance(enriched);
    if (!bal)
      return { account: enriched, balance: null };
    if (enriched.accountId) {
      await accountStore.updatePlayerBalance(enriched.accountId, bal.balance, userId);
    }
    return { account: enriched, balance: bal };
  }
  catch {
    return { account: enriched, balance: null };
  }
}

async function refreshAllAccountBalances(userId) {
  const accounts = userId ? store.getAccountsForUser(userId) : accountStore.getAccountsFromKv();
  const results = [];
  for (const row of accounts) {
    results.push(await refreshAccountBalance(row, userId));
  }
  return results;
}

async function handleGetUserProfit() {
  const rows = await orderStore.listUserProfitRank();
  return { ok: true, info: rows };
}

async function handleGetOrderList(body, userId) {
  const date = body.date || orderStore.toDateKey(Date.now());
  const pageSize = Number(body.pageSize) || 1024;
  const pageIndex = Number(body.pageIndex) || 1;
  const { list, total } = await orderStore.listByDatePage(date, userId, pageIndex, pageSize);
  return {
    ok: true,
    info: { list, total, pageIndex, pageSize },
  };
}

async function handleSaveOrderBind(body, userId) {
  let orders = body.orders;
  if (typeof orders === "string") {
    try {
      orders = JSON.parse(orders);
    }
    catch {
      return { ok: false, msg: "orders JSON 无效" };
    }
  }
  if (!Array.isArray(orders))
    return { ok: false, msg: "orders 必须是数组" };
  const bound = await orderStore.saveOrderBind(orders, userId);
  if (!bound)
    return { ok: false, msg: "绑单失败（订单不存在或 link 更新失败）" };
  return { ok: true, info: true };
}

/** [changmen 扩展] 侧栏手动改绑：单笔订单 link 新→老 */
async function handleRebindOrderLink(body, userId) {
  const orderId = String(body?.orderId ?? body?.OrderID ?? "").trim();
  const toLinkId = Number(body?.toLinkId ?? body?.toLink ?? body?.LinkID);
  if (!orderId)
    return { ok: false, msg: "orderId 必填" };
  if (!Number.isFinite(toLinkId) || toLinkId === 0)
    return { ok: false, msg: "toLinkId 无效" };
  const result = await orderStore.rebindOrderLink(userId, orderId, toLinkId);
  if (!result?.ok)
    return { ok: false, msg: result?.msg || "改绑失败" };
  return {
    ok: true,
    info: {
      orderId: result.orderId,
      fromLinkId: result.fromLinkId,
      toLinkId: result.toLinkId,
    },
  };
}

function syncAccountRowInKv(accountId, updates, userId) {
  const list = userId ? store.getAccountsForUser(userId) : accountStore.getAccountsFromKv();
  const idx = list.findIndex(row => String(row.accountId) === String(accountId));
  if (idx < 0)
    return null;
  list[idx] = { ...list[idx], ...updates, updateTime: Date.now() };
  if (userId)
    store.setAccountsForUser(userId, list);
  return list[idx];
}

async function handleRefreshAccountBalance(body, userId) {
  const playerId = body.playerId;
  if (!playerId)
    return { ok: false, msg: "playerId 必填" };
  const owned = await assertPlayerOwnedByUser(playerId, userId);
  if (!owned.ok)
    return owned;
  const accounts = userId ? store.getAccountsForUser(userId) : accountStore.getAccountsFromKv();
  const row = enrichAccountRowFromPlayer(
    accounts.find(r => String(r.accountId) === String(playerId)),
  );
  if (!row)
    return { ok: false, msg: "account 不存在" };
  const result = await refreshAccountBalance(row, userId);
  if (result.balance != null) {
    const balance = Number(result.balance.balance) || 0;
    const credit = Number(row.credit) || 0;
    const synced = syncAccountRowInKv(playerId, {
      balance,
      currency: result.balance.currency || row.currency || "CNY",
      totalProfit: balance - credit,
    }, userId);
    return { ok: true, info: { ...synced, balance } };
  }
  return { ok: true, info: { ...row, balance: undefined } };
}

async function handleSaveUserLog(body, userId) {
  if (!userId)
    return { ok: false, msg: "请先登录" };
  const observation = await saveObservationBatch(body, userId);
  if (observation)
    return observation;
  const title = String(body.title || "").trim();
  if (!title)
    return { ok: false, msg: "title 必填" };
  let data = "";
  if (body.data != null) {
    data = typeof body.data === "string" ? body.data : JSON.stringify(body.data);
  }
  else if (body.rows != null) {
    data = typeof body.rows === "string" ? body.rows : JSON.stringify(body.rows);
  }
  const ok = await accountStore.saveUserLog(userId, title, data);
  return ok ? { ok: true, info: true } : { ok: false, msg: "写入用户日志失败" };
}

export {
  emptyPage,
  handleCreateTagPlatform,
  handleDeleteMoneyLog,
  handleDeletePlayer,
  handleGetData,
  handleGetMoneyLog,
  handleGetMoneyLogs,
  handleGetOrderList,
  handleGetPlayerOrder,
  handleGetTagPlatforms,
  handleGetUserProfit,
  handleGetUsers,
  handleRebindOrderLink,
  handleRefreshAccountBalance,
  handleSaveAccounts,
  handleSaveData,
  handleSaveMoneyLog,
  handleSaveOrder,
  handleSaveOrderBind,
  handleSaveSportAccount,
  handleSaveUserLog,
  handleUpdateBalance,
  isPredictFunClientSaveOrderRequest,
  isPredictFunPlayerRow,
  refreshAccountBalance,
  refreshAllAccountBalances,
  syncAccountRowInKv,
};
