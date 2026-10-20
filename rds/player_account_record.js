/**
 * players 行 ↔ A8 ACCOUNT 线协议 AccountRecord 互转。
 * 结构化列：id/platform_id/platform_name/player_name/provider/credit/total_balance
 * account_data jsonb：凭证、限额、rateConfig 等其余字段
 */

import { buildVenueAccountKeyFromRecord } from "./venue_account_key.js";

const STRUCTURED_KEYS = new Set([
  "accountId",
  "AccountId",
  "platformId",
  "PlatformId",
  "platformName",
  "PlatformName",
  "playerName",
  "PlayerName",
  "provider",
  "Provider",
  "credit",
  "balance",
  "Balance",
  "totalBalance",
  "TotalBalance",
  "updateTime",
  "UpdateTime",
]);

export function readVenueMemberIdFromRecord(record) {
  const r = record && typeof record === "object" ? record : {};
  const v = r.venueMemberId ?? r.venueId ?? r.VenueMemberId ?? r.VenueId;
  return v != null ? String(v).trim() : "";
}

function pickStructured(record) {
  const r = record && typeof record === "object" ? record : {};
  const accountId = Number(r.accountId ?? r.AccountId) || 0;
  const platformId = Number(r.platformId ?? r.PlatformId);
  const platformName = String(r.platformName ?? r.PlatformName ?? "").trim();
  const playerName = String(r.playerName ?? r.PlayerName ?? "").trim();
  const provider = String(r.provider ?? r.Provider ?? "").trim();
  const credit = Number(r.credit) || 0;
  const balanceRaw = r.balance ?? r.Balance ?? r.totalBalance ?? r.TotalBalance;
  const totalBalance = Number(balanceRaw) || 0;
  const updateTime = Number(r.updateTime ?? r.UpdateTime) || Date.now();
  return {
    accountId,
    platformId: Number.isFinite(platformId) && platformId > 0 ? platformId : null,
    platformName,
    playerName,
    provider,
    credit,
    totalBalance,
    updateTime,
  };
}

/** @param {import('./rds/player_store.js').PlayerRow | null} row */
export function playerRowToAccountRecord(row) {
  if (!row)
    return null;
  const data
    = row.accountData && typeof row.accountData === "object" && !Array.isArray(row.accountData)
      ? { ...row.accountData }
      : {};
  for (const k of STRUCTURED_KEYS)
    delete data[k];
  const venueMemberId = String(row.venueMemberId || data.venueMemberId || data.venueId || "").trim();
  const venueAccountName = String(data.venueAccountName || "").trim();
  return {
    ...data,
    accountId: Number(row.id ?? row.playerId),
    platformId: Number(row.platformId) || undefined,
    platformName: String(row.platformName || ""),
    playerName: String(row.playerName || ""),
    provider: String(row.provider || data.provider || ""),
    ...(venueMemberId ? { venueMemberId } : {}),
    ...(venueAccountName ? { venueAccountName } : {}),
    credit: Number(row.credit) || 0,
    balance: Number(row.totalBalance) || 0,
    updateTime: Number(row.updatedAt) || Date.now(),
  };
}

export function accountRecordToPlayerPatch(record) {
  const s = pickStructured(record);
  const extras = record && typeof record === "object" ? { ...record } : {};
  for (const k of STRUCTURED_KEYS)
    delete extras[k];
  return {
    playerId: s.accountId,
    platformId: s.platformId,
    platformName: s.platformName,
    playerName: s.playerName,
    provider: s.provider,
    venueMemberId: readVenueMemberIdFromRecord(record),
    venueAccountKey: buildVenueAccountKeyFromRecord(record),
    credit: s.credit,
    totalBalance: s.totalBalance,
    accountData: extras,
    updatedAt: s.updateTime,
  };
}

/** 从 profiles.accounts jsonb 行合并进 players（迁移/backfill） */
export function mergeJsonbAccountIntoPlayerPatch(jsonbRow, playerRow) {
  const fromJson = jsonbRow && typeof jsonbRow === "object" ? jsonbRow : {};
  const base = playerRow ? playerRowToAccountRecord(playerRow) : {};
  const merged = { ...base, ...fromJson };
  const patch = accountRecordToPlayerPatch(merged);
  if (!patch.playerId)
    patch.playerId = Number(fromJson.accountId ?? fromJson.AccountId) || 0;
  return patch;
}
