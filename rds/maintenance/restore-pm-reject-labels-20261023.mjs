/**
 * [changmen 扩展] 用户指定的两笔 PM 原单：按各自预检日志恢复名称。
 * 仅修改 match/bet/item 及 raw 同名字段；默认只预览，--apply 才提交。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { changmenPath } from "@changmen/storage/paths";
import {
  ensurePgPoolReady, getPgPool, fetchUserLogsInRange, fetchOrdersByPlayerOrderIdsStrict,
} from "@changmen/db";

const owner = "6ae8c38e-c4a2-4b2d-9896-733196115322";
const playerId = 292;
const ids = [
  "0x5b64885bcdcb7b2772c2a005d599a0f69ca5acf9f3a43552aa8f29050843685b",
  "0x9c6e1fe71a6af94ea946b1d514f307a251ee17e29c63bfd16cf74fe788d5081e",
];
const apply = process.argv.includes("--apply");
assert(process.argv.slice(2).every(arg => arg === "--apply"), "Only --apply is accepted; the two targets are fixed");

function parseData(row) {
  try { return JSON.parse(row.data); } catch { return {}; }
}
function display(row) {
  return { match: row.match, bet: row.bet, item: row.item };
}
function checkRow(row, plan) {
  assert.equal(row.user_id, owner);
  assert.equal(Number(row.player_id), playerId);
  assert.equal(row.provider, "Polymarket");
  assert.equal(row.order_id, plan.orderId);
  if (JSON.stringify(display(row)) === JSON.stringify(plan.names)) return false;
  assert.equal(row.match || "", "", "Unexpected existing event name; do not overwrite");
  assert.equal(row.bet, "FOK未成交", "Unexpected existing market name; do not overwrite");
  assert.equal(row.item, "Home", "Unexpected existing direction; do not overwrite");
  return true;
}
function assertOnlyLabelsChanged(before, after, names) {
  const expected = { ...before, ...names, raw: { ...before.raw, ...names } };
  assert.deepEqual(after, expected, "Fields outside the three labels and their raw mirrors changed");
}

await ensurePgPoolReady();
const pool = getPgPool();
let client;
try {
  const logs = await fetchUserLogsInRange(owner,
    Date.parse("2026-10-23T00:25:20+08:00"), Date.parse("2026-10-23T00:25:40+08:00"), 100);
  const parsed = logs.map(row => ({ row, data: parseData(row) }));
  const plans = ids.map(orderId => {
    const submissions = parsed.filter(({ data }) => data.result?.orderId === orderId && Number(data.accountId) === playerId);
    assert.equal(submissions.length, 1, "Need one exact original submission log per order");
    const submit = submissions[0];
    const result = submit.data.result;
    assert.equal(result.request?.orderType, "FOK");
    assert.equal(result.request?.order?.side, "BUY");
    const checks = parsed.filter(({ row, data }) => data.options
      && String(row.title).startsWith("[Polymarket](pm,f43e) 请求盘口数据 => true")
      && String(data.options.itemId) === String(result.request.order.tokenId)
      && Math.abs(Number(row.create_at) - Number(result.pmSubmittedAt)) < 1000);
    assert.equal(checks.length, 1, "Need one unambiguous original precheck for each submission");
    const { row, data } = checks[0];
    const option = data.options;
    assert.equal(option.match, "Team Liquid vs 1w Team");
    assert.equal(option.bet, "[地图2] 获胜");
    assert.equal(option.target, "Home");
    const teams = option.match.split(" vs ");
    assert.equal(teams.length, 2);
    return { orderId, names: { match: option.match, bet: option.bet, item: teams[0] },
      evidence: { precheckLogId: row.id, submissionLogId: submit.row.id, target: option.target,
        matchId: option.matchId, conditionId: option.betId, tokenId: option.itemId } };
  });
  const preview = await fetchOrdersByPlayerOrderIdsStrict(playerId, owner, ids);
  assert.equal(preview.length, 2, "Both exact orders must exist under the same owner/account");
  for (const plan of plans) {
    const row = preview.find(row => row.order_id === plan.orderId);
    assert(row);
    console.log(JSON.stringify({ orderId: plan.orderId, before: display(row), after: plan.names, needsUpdate: checkRow(row, plan) }));
  }
  if (apply) {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const locked = (await client.query(
      `SELECT * FROM orders WHERE user_id=$1::uuid AND player_id=$2 AND provider='Polymarket'
       AND order_id=ANY($3::text[]) ORDER BY order_id FOR UPDATE`, [owner, playerId, ids],
    )).rows;
    assert.equal(locked.length, 2);
    const updates = plans.filter(plan => checkRow(locked.find(row => row.order_id === plan.orderId), plan));
    const backup = changmenPath("output", `pm-label-restoration-20261023-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.writeFileSync(backup, `${JSON.stringify({ createdAt: new Date().toISOString(), owner, playerId,
      before: locked, plans }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    assert.deepEqual(JSON.parse(fs.readFileSync(backup, "utf8")).before, locked, "Backup readback must match locked rows");
    for (const plan of updates) {
      const before = locked.find(row => row.order_id === plan.orderId);
      const result = await client.query(
        `UPDATE orders SET match=$1,bet=$2,item=$3,raw=COALESCE(raw,'{}'::jsonb)||$4::jsonb
         WHERE id=$5 AND user_id=$6::uuid AND player_id=$7 AND provider='Polymarket' AND order_id=$8 RETURNING *`,
        [plan.names.match, plan.names.bet, plan.names.item, JSON.stringify(plan.names), before.id, owner, playerId, plan.orderId],
      );
      assert.equal(result.rowCount, 1);
      assertOnlyLabelsChanged(before, result.rows[0], plan.names);
    }
    await client.query("COMMIT");
    const after = await fetchOrdersByPlayerOrderIdsStrict(playerId, owner, ids);
    assert.equal(after.length, 2);
    for (const plan of plans) {
      const row = after.find(row => row.order_id === plan.orderId);
      assertOnlyLabelsChanged(locked.find(row => row.order_id === plan.orderId), row, plan.names);
      console.log(JSON.stringify({ restored: row.order_id, ...display(row), status: row.status,
        betMoney: row.bet_money, money: row.money, link: row.link }));
    }
    console.log(JSON.stringify({ updated: updates.length, verified: after.length, backup }));
  }
  else console.log("Dry run only; use --apply to restore the two label sets.");
}
catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  throw error;
}
finally {
  client?.release();
  await pool?.end();
}
