#!/usr/bin/env node
/**
 * One-off: fix SH01 (empty) and River (PM47 + PB48 + RAY46) profiles.accounts
 * Usage: node scripts/fix-sh01-river-accounts.mjs [--dry-run]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { openProfileRepairData } from "@changmen/db/maintenance/profile_repairs.js";
import { loadProfileById, pullProfilesFromDb } from "../../../core/db/store.js";

const dryRun = process.argv.includes("--dry-run");
loadChangmenEnv();
const data = await openProfileRepairData();
await pullProfilesFromDb();

async function getUserId(userName) {
  const { rows } = await data.readUserId(userName);
  return rows[0]?.id;
}

async function getProfileAccounts(userName) {
  const { rows } = await data.readProfileAccounts(userName);
  return rows[0]?.accounts ?? [];
}

function pickAccountFields(src) {
  if (!src)
    return null;
  return { ...src };
}

function minimalAccount({ accountId, provider, platformName, playerName, platformId }) {
  return {
    accountId,
    provider,
    platformName,
    playerName,
    platformId,
    pause: false,
    balance: undefined,
    updateTime: Date.now(),
    rateConfig: provider === "RAY" || provider === "PB"
      ? [{ rate: 0.2, maxOdds: 0, minOdds: 0 }]
      : [],
  };
}

async function fetchPlayer(playerId) {
  const { rows } = await data.readActivePlayer(playerId);
  return rows[0] ?? null;
}

function providerForPlatform(platformName) {
  const n = String(platformName || "").toLowerCase();
  if (n === "pm" || n.includes("polymarket"))
    return "Polymarket";
  if (n === "pb" || n.includes("平博"))
    return "PB";
  if (n === "ray" || n.includes("雷"))
    return "RAY";
  return "OB";
}

async function buildRiverAccounts(current, riverUserId) {
  const byId = new Map(
    (current || []).map(a => [Number(a.accountId ?? a.AccountId), a]),
  );
  const wantIds = [
    { id: 47, fallbackProvider: "Polymarket" },
    { id: 48, fallbackProvider: "PB" },
    { id: 46, fallbackProvider: "RAY" },
  ];
  const out = [];
  for (const { id, fallbackProvider } of wantIds) {
    const existing = byId.get(id);
    if (existing) {
      out.push(pickAccountFields(existing));
      continue;
    }
    const player = await fetchPlayer(id);
    if (!player)
      continue;
    const { rows: ownerRows } = await data.readPlayerOwner(id);
    if (ownerRows[0]?.owner_user_id !== riverUserId) {
      console.warn(`player ${id} not owned by River, skip`);
      continue;
    }
    out.push(minimalAccount({
      accountId: id,
      provider: fallbackProvider || providerForPlatform(player.platform_name),
      platformName: player.platform_name,
      playerName: player.player_name,
      platformId: Number(player.platform_id),
    }));
  }
  return out;
}

async function apply(userName, accounts) {
  const uid = await getUserId(userName);
  if (!uid)
    throw new Error(`user not found: ${userName}`);
  console.log(`${dryRun ? "[dry-run] " : ""}${userName}: set ${accounts.length} accounts`);
  for (const a of accounts) {
    console.log(
      `  ${a.accountId}\t${a.provider ?? a.Type}\t${a.platformName ?? a.PlatformName}\t${a.playerName ?? a.PlayerName}`,
    );
  }
  if (!dryRun) {
    const now = Date.now();
    await data.writeProfileAccounts(uid, JSON.stringify(accounts), now);
    await loadProfileById(uid);
  }
}

const riverUserId = await getUserId("River");
const riverCurrent = await getProfileAccounts("River");
const riverNext = await buildRiverAccounts(riverCurrent, riverUserId);
await apply("River", riverNext);

console.log("done");
