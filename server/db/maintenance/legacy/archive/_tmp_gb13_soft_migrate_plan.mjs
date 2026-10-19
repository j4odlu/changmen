#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const uid = (await pool.query(`SELECT id FROM profiles WHERE user_name ILIKE 'GB13'`)).rows[0]?.id;

const { rows: active } = await pool.query(
  `SELECT id, platform_name, player_name, provider,
          account_data->>'venueAccountName' AS van,
          account_data->>'venueMemberId' AS vmid,
          account_data->>'gateway' AS gateway
   FROM players WHERE owner_user_id = $1 AND deleted_at IS NULL ORDER BY id`,
  [uid],
);

const { rows: deleted } = await pool.query(
  `SELECT id, platform_name, player_name, provider,
          account_data->>'gateway' AS gateway
   FROM players WHERE owner_user_id = $1 AND deleted_at IS NOT NULL ORDER BY id`,
  [uid],
);

/** manual successor map from platform/player_name/gateway analysis */
const successorHint = [
  [80, 111, "星空 luzihao1, gateway 一致"],
  [84, 119, "星空-好博 luzihao1"],
  [78, 118, "九游 chengcong1 -> chengcong"],
  [106, 118, "九游 chengcong1 -> chengcong"],
  [77, null, "4-米兰 jingwen11, 无明确活跃对应"],
  [107, 111, "星空 luzihao1 (旧)"],
  [108, 111, "星空"],
  [109, 111, "星空"],
  [110, 111, "星空"],
  [112, 119, "星空-好博"],
];

console.log("=== 活跃 OB 账号 ===");
for (const a of active) console.log(`${a.id}\t${a.platform_name}/${a.player_name}\tvan=${a.van}\tgateway=${a.gateway?.slice(0, 40) ?? "-"}`);

const { rows: softOrders } = await pool.query(
  `SELECT o.id, o.player_id, o.order_id, o.provider, o.link, o.status, o.bet_money, o.match,
          pl.platform_name, pl.player_name
   FROM orders o
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1 AND pl.deleted_at IS NOT NULL
   ORDER BY o.player_id, o.order_id`,
  [uid],
);

/** @type {Record<string, number>} */
const summary = {
  migrate: 0,
  delete_dup_active: 0,
  delete_dup_soft: 0,
  uncertain: 0,
};

/** @type {Array<object>} */
const plan = [];

for (const o of softOrders) {
  const dupActive = await pool.query(
    `SELECT player_id FROM orders k
     JOIN players pk ON pk.id = k.player_id AND pk.deleted_at IS NULL
     WHERE k.user_id = $1 AND k.order_id = $2 AND k.provider = $3`,
    [uid, o.order_id, o.provider],
  );
  const dupSoft = await pool.query(
    `SELECT player_id FROM orders k
     JOIN players pl ON pl.id = k.player_id AND pl.deleted_at IS NOT NULL
     WHERE k.user_id = $1 AND k.order_id = $2 AND k.provider = $3 AND k.player_id <> $4`,
    [uid, o.order_id, o.provider, o.player_id],
  );

  let action = "?";
  let target = null;
  let reason = "";

  if (dupActive.rows.length) {
    action = "DELETE";
    reason = `活跃 player ${dupActive.rows.map((r) => r.player_id).join(",")} 已有`;
    summary.delete_dup_active += 1;
  } else if (dupSoft.rows.length) {
    action = "DELETE_OR_MERGE";
    reason = `软删重复 player ${dupSoft.rows.map((r) => r.player_id).join(",")}`;
    summary.delete_dup_soft += 1;
  } else {
    const hint = successorHint.find(([from]) => Number(from) === Number(o.player_id));
    const to = hint?.[1] ?? null;

    if (o.link != null) {
      const { rows: legs } = await pool.query(
        `SELECT player_id, provider, link FROM orders
         WHERE user_id = $1 AND link = $2 AND player_id IN (
           SELECT id FROM players WHERE owner_user_id = $1 AND deleted_at IS NULL
         )`,
        [uid, o.link],
      );
      if (legs.length) {
        const obLeg = legs.find((l) => l.provider === "OB");
        if (obLeg) {
          target = Number(obLeg.player_id);
          action = "ALREADY_ON_ACTIVE_VIA_LINK";
          reason = `同 link 活跃 OB pid=${target}`;
        } else {
          target = to;
          action = to ? "MIGRATE" : "UNCERTAIN";
          reason = to
            ? `无活跃 OB 同 order，对腿 ${legs.map((l) => `${l.provider}:${l.player_id}`).join("+")}，迁到 ${to} (${hint[2]})`
            : `对腿存在但无活跃 OB  successor`;
        }
      } else if (to) {
        target = to;
        action = "MIGRATE";
        reason = `独有订单，映射 ${o.player_id}->${to} (${hint[2]})`;
        summary.migrate += 1;
      } else {
        action = "UNCERTAIN";
        reason = "无 successor 映射";
        summary.uncertain += 1;
      }
    } else if (to) {
      target = to;
      action = "MIGRATE";
      reason = `独有无 link，映射 ${o.player_id}->${to}`;
      summary.migrate += 1;
    } else {
      action = "UNCERTAIN";
      reason = "无 link 且无 successor";
      summary.uncertain += 1;
    }

    if (action === "MIGRATE") summary.migrate += 1;
    if (action === "UNCERTAIN") summary.uncertain += 1;
    if (action === "ALREADY_ON_ACTIVE_VIA_LINK") summary.uncertain += 1;
  }

  plan.push({
    id: o.id,
    from: o.player_id,
    from_name: `${o.platform_name}/${o.player_name}`,
    order_id: o.order_id,
    link: o.link,
    action,
    target,
    reason,
    match: o.match,
  });
}

console.log("\n=== 逐单归属计划 ===");
for (const p of plan) {
  console.log(
    `${p.action.padEnd(22)} id=${p.id} pid=${p.from}(${p.from_name}) order=${p.order_id} -> ${p.target ?? "-"} | ${p.reason}`,
  );
}

console.log("\n=== 汇总（按建议动作）===");
const byAction = {};
for (const p of plan) byAction[p.action] = (byAction[p.action] ?? 0) + 1;
console.log(byAction);

console.log("\n=== 按目标 player 迁移计数（MIGRATE）===");
const byTarget = {};
for (const p of plan.filter((x) => x.action === "MIGRATE")) {
  byTarget[p.target] = (byTarget[p.target] ?? 0) + 1;
}
console.log(byTarget);

await pool.end();
