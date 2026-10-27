#!/usr/bin/env node
/**
 * River：只保留 PM47 / PB48 / RAY46，软删其余 owner=River 的活跃 player。
 * 根因：owner 迁移 clone + players 唯一真相后 GetData 会列出全部 owner 行。
 *
 *   node scripts/fix-river-prune-players.mjs [--dry-run]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { openProfileRepairData } from "@changmen/db/maintenance/profile_repairs.js";
import { loadAccountsForUser, loadProfileById } from "../../../core/db/store.js";

const dryRun = process.argv.includes("--dry-run");
const KEEP = new Set([46, 47, 48]);

loadChangmenEnv();
const data = await openProfileRepairData();

const { rows } = await data.readRiverOwner();
const uid = rows[0]?.id;
if (!uid)
  throw new Error("River not found");

const { rows: active } = await data.readActivePlayers(uid);

const toDrop = active.filter(p => !KEEP.has(Number(p.id)));
console.log(`River active players: ${active.length}, keep ${KEEP.size}, drop ${toDrop.length}`);
for (const p of active) {
  const mark = KEEP.has(Number(p.id)) ? "KEEP" : "DROP";
  console.log(`  [${mark}] ${p.id}\t${p.provider || "?"}\t${p.platform_name}\t${p.player_name}`);
}

if (dryRun || toDrop.length === 0) {
  console.log(dryRun ? "[dry-run] no write" : "nothing to drop");
  await data.close();
  process.exit(0);
}

const now = Date.now();
const dropIds = toDrop.map(p => Number(p.id));
await data.softDeletePlayers(now, "fix-river-prune: keep only 46/47/48", uid, dropIds);

await loadProfileById(uid);
await loadAccountsForUser(uid);
console.log("done — cache reloaded");
await data.close();
