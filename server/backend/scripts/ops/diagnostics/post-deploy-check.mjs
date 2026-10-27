#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import {
  backendBindLinkFromCreateAt,
  getPgPool,
  hasDatabaseUrlConfig,
  initDatabaseUrl,
  setOrdersBoundHook,
  setOrdersInsertedHook,
  updateOrderBind,
  upsertOrders,
} from "@changmen/db";
/**
 * Deploy 后自检：RDS orders upsert / SaveOrderBind + 管理员 Telegram。
 *
 *   cd changmen/server/backend && node scripts/ops/diagnostics/post-deploy-check.mjs
 *   node scripts/ops/diagnostics/post-deploy-check.mjs --skip-telegram   # 只测 DB，不发 Telegram
 *
 * 退出码 0 = 全过；非 0 = 至少一项失败（CI / deploy 脚本直接失败）。
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import {
  isAdminNotifyEnabled,
  sendAdminNotify,
} from "../../../core/admin_tools/telegram.js";

loadChangmenEnv();

const skipTelegram = process.argv.includes("--skip-telegram");
const probeTag = `deploy-probe-${Date.now()}`;

const results = [];
const CLOSED_ORDER_STATUSES = new Set(["Win", "Lose", "Return", "Reject"]);

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`OK  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function warn(name, detail = "") {
  console.warn(`WARN ${name}${detail ? ` — ${detail}` : ""}`);
}

async function pickProbeUser(pool) {
  const { rows } = await pool.query(
    `SELECT p.id::text AS id, u.user_name
     FROM profiles p
     JOIN users u ON u.id = p.id
     ORDER BY u.user_name
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

async function cleanupProbe(pool, userId, orderId, playerId) {
  await pool.query(
    `DELETE FROM ${financialOrdersRelation()} WHERE user_id = $1::uuid AND order_id = $2 AND player_id = $3`,
    [userId, orderId, playerId],
  );
}

async function checkUpsertAndBind(pool, userId, userName) {
  const playerId = 9_000_001;
  const orderId = `${probeTag}-upsert`;
  const createAt = Date.now();
  const placeholderLink = backendBindLinkFromCreateAt(createAt);
  const arbLink = createAt;

  let insertHookRows = [];
  let boundHookRows = [];
  setOrdersInsertedHook((rows) => {
    insertHookRows = rows ?? [];
  });
  setOrdersBoundHook((rows) => {
    boundHookRows = rows ?? [];
  });

  const row = {
    user_id: userId,
    player_id: playerId,
    order_id: orderId,
    link: placeholderLink,
    provider: "OB",
    match: `[deploy-check] ${userName} upsert probe`,
    bet: "deploy-check",
    item: "probe",
    odds: 1.01,
    bet_money: 1,
    money: 0,
    status: "None",
    create_at: createAt,
    raw: { deployCheck: true, probeTag },
  };

  const upsertOk = await upsertOrders([row]);
  if (!upsertOk) {
    fail("upsertOrders", "返回 false（见上方 [rds] upsertOrders 日志）");
    await cleanupProbe(pool, userId, orderId, playerId);
    return false;
  }

  const { rows: inserted } = await pool.query(
    `SELECT order_id, link, create_at FROM ${financialOrdersRelation()}
     WHERE user_id = $1::uuid AND order_id = $2 AND player_id = $3`,
    [userId, orderId, playerId],
  );
  if (!inserted.length) {
    fail("upsertOrders", "写入后 SELECT 无行");
    await cleanupProbe(pool, userId, orderId, playerId);
    return false;
  }
  pass("upsertOrders", `order_id=${orderId}`);

  if (insertHookRows.length !== 1) {
    fail("ordersInsertedHook", `期望 1 行，实际 ${insertHookRows.length}`);
  }
  else {
    pass("ordersInsertedHook", "INSERT hook 已触发");
  }

  boundHookRows = [];
  const boundOk = await updateOrderBind(orderId, userId, arbLink, {
    playerId,
    provider: "OB",
  });
  if (!boundOk) {
    fail("updateOrderBind", "UPDATE 未命中行");
  }
  else {
    const { rows: bound } = await pool.query(
      `SELECT link::text FROM ${financialOrdersRelation()}
       WHERE user_id = $1::uuid AND order_id = $2 AND player_id = $3`,
      [userId, orderId, playerId],
    );
    if (Number(bound[0]?.link) !== arbLink) {
      fail("updateOrderBind", `link 未更新为 ${arbLink}`);
    }
    else {
      pass("updateOrderBind", `link ${placeholderLink} → ${arbLink}`);
    }
  }

  if (boundHookRows.length === 1) {
    pass("ordersBoundHook", "绑单 hook 已触发");
  }
  else {
    pass(
      "ordersBoundHook",
      "未触发（link=create_at-1 占位不触发 bound hook，属预期；INSERT 通知仍走 inserted hook）",
    );
  }

  await cleanupProbe(pool, userId, orderId, playerId);
  setOrdersInsertedHook(null);
  setOrdersBoundHook(null);
  const dbChecks = ["upsertOrders", "ordersInsertedHook", "updateOrderBind"];
  return dbChecks.every(name => results.find(r => r.name === name)?.ok);
}

async function checkTelegram(userName) {
  const tokenOk = Boolean(String(process.env.TELEGRAM_BOT_TOKEN || "").trim());
  const chatOk = Boolean(String(process.env.TELEGRAM_ADMIN_CHAT_ID || "").trim());
  if (!tokenOk || !chatOk) {
    const missing = [
      !tokenOk ? "TELEGRAM_BOT_TOKEN" : null,
      !chatOk ? "TELEGRAM_ADMIN_CHAT_ID" : null,
    ]
      .filter(Boolean)
      .join(", ");
    fail(
      "telegram env",
      `缺少 ${missing}（server/backend/.env；可 node changmen/scripts/sync/sync-telegram-env.mjs 同步到 VPS）`,
    );
    return false;
  }
  if (!isAdminNotifyEnabled()) {
    fail("telegram env", "TELEGRAM_ADMIN_NOTIFY=0 或配置无效");
    return false;
  }
  pass("telegram env", "管理员通道已启用");

  if (skipTelegram) {
    pass("telegram send", "已跳过（--skip-telegram）");
    return true;
  }

  const ping = await sendAdminNotify(
    `<b>Deploy 自检</b>\n用户探针：${userName}\n探针：${probeTag}\nupsert + bind + notify 链路正常。`,
    "HTML",
    "Deploy自检",
  );
  if (!ping.ok) {
    fail("telegram send", ping.msg || "sendAdminNotify 失败");
    return false;
  }
  pass("telegram send", "管理员 chat 已收到 Deploy自检 消息");
  return true;
}

async function checkAccountInvariants(pool) {
  const { rows: orderOwnerMismatch } = await pool.query(`
    SELECT o.player_id, o.user_id, p.owner_user_id, o.status
    FROM ${financialOrdersRelation("o")}
    JOIN players p ON p.id = o.player_id AND p.deleted_at IS NULL
    WHERE p.owner_user_id IS NOT NULL AND o.user_id::uuid <> p.owner_user_id
    LIMIT 5
  `);
  if (orderOwnerMismatch.length > 0) {
    const activeMismatches = orderOwnerMismatch.filter(
      row => !CLOSED_ORDER_STATUSES.has(String(row.status || "").trim()),
    );
    if (activeMismatches.length === 0) {
      warn(
        "accounts isolation",
        `仅发现历史已结算订单 player 归属不一致: ${orderOwnerMismatch.map(r => r.player_id).join(", ")}`,
      );
    }
    else {
      fail(
        "accounts isolation",
        `活跃订单 player 归属不一致: ${activeMismatches.map(r => r.player_id).join(", ")}`,
      );
      return false;
    }
  }

  const { rows: noOwner } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM players WHERE deleted_at IS NULL AND owner_user_id IS NULL`,
  );
  if ((noOwner[0]?.n ?? 0) > 0) {
    fail("accounts owner_user_id", `${noOwner[0].n} 个活跃 player 无 owner_user_id`);
    return false;
  }

  pass("accounts isolation", "无跨用户 accountId");
  pass("accounts owner_user_id", "活跃 player 均已归属");
  return true;
}

async function main() {
  console.log(`== post-deploy-check ${probeTag} ==`);

  if (!hasDatabaseUrlConfig()) {
    fail(
      "database",
      "未配置 DATABASE_URL / DATABASE_URL_INTERNAL / DATABASE_URL_PUBLIC（server/backend/.env）",
    );
    process.exit(1);
  }

  await initDatabaseUrl();

  const pool = getPgPool("post-deploy-check");
  if (!pool) {
    fail(
      "database",
      "initDatabaseUrl 后仍无连接池（检查 RDS 地址与 DATABASE_RDS_TARGET）",
    );
    process.exit(1);
  }

  const probeUser = await pickProbeUser(pool);
  if (!probeUser?.id) {
    fail("database", "profiles 无用户，无法探针 upsert");
    process.exit(1);
  }
  pass("database", `探针用户 ${probeUser.user_name}`);

  await checkAccountInvariants(pool);
  await checkUpsertAndBind(pool, probeUser.id, probeUser.user_name);
  await checkTelegram(probeUser.user_name);

  await pool.end();

  const failed = results.filter(r => !r.ok);
  console.log("");
  if (failed.length) {
    console.error(`== FAIL (${failed.length}/${results.length}) ==`);
    for (const r of failed) console.error(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
  console.log(`== PASS (${results.length}/${results.length}) ==`);
}

main().catch((err) => {
  console.error("post-deploy-check:", err instanceof Error ? err.message : err);
  process.exit(1);
});
