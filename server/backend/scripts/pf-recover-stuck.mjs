/**
 * 运维：列出 / 补偿 PredictFun 卡住订单（pending_credit / closing）
 *
 * 用法（在 server/backend 或仓库根，需能连 RDS + 已登录用户上下文的 player）：
 *   node scripts/pf-recover-stuck.mjs --playerId=42 --userId=<uuid> --dryRun
 *   node scripts/pf-recover-stuck.mjs --playerId=42 --userId=<uuid>
 *
 * 也可用 esport API：Pf_RecoverStuckOrders { playerId, dryRun?: true }
 */

import { loadChangmenEnv } from "@changmen/storage/load_env";

loadChangmenEnv();

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const playerId = arg("playerId") || arg("player");
  const userId = arg("userId") || arg("user");
  const dryRun = flag("dryRun") || flag("dry-run");
  if (!playerId || !userId) {
    console.error("用法: node scripts/pf-recover-stuck.mjs --playerId=N --userId=UUID [--dryRun]");
    process.exit(1);
  }

  const {
    listPfStuckOrdersForPlayer,
    recoverPfStuckOrdersForPlayer,
  } = await import("../core/integrations/predictfun/pf_recover_stuck.js");

  if (dryRun) {
    const listed = await listPfStuckOrdersForPlayer(playerId, userId);
    console.log(JSON.stringify({ dryRun: true, playerId, ...listed }, null, 2));
    return;
  }

  const recovered = await recoverPfStuckOrdersForPlayer(playerId, userId);
  console.log(JSON.stringify({ dryRun: false, playerId, ...recovered }, null, 2));
  const failed = (recovered.closing || []).filter((r) => !r.ok);
  if (failed.length)
    process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
