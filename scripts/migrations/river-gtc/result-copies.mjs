// [changmen 扩展] RIVER 存量结果副本补齐；两表、执行状态与原订单财务字段保持不变。
import assert from "node:assert/strict";
import { gtcOrderSnapshot } from "../../../rds/rds/orderModes/gtc/pm_gtc_order_snapshot.js";
import { digest } from "./jsonDigest.mjs";
export { digest };
export function planResultCopies(owner, executions, orders) {
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(owner), "explicit owner required");
  assert.equal(new Set(executions.map(row => row.id)).size, executions.length);
  const sources = new Map(executions.map(row => {
    assert.equal(row.owner, owner); assert.equal(row.record.owner, owner); assert.equal(row.record.id, row.id);
    return [row.id, row];
  }));
  const operations = [], unchanged = [];
  for (const order of orders) {
    assert.equal(order.user_id, owner);
    const source = sources.get(order.raw?.pmGtcExecutionId);
    assert(source, "every tagged order must have its owned execution");
    const row = source.record;
    if (order.provider !== "Polymarket" || String(order.raw?.pmSide).toLowerCase() === "sell") {
      unchanged.push({ id: order.id, reason: "counterpart-or-sell" }); continue;
    }
    assert.equal(String(order.player_id), String(row.plan.playerId), "original player identity");
    assert.equal(order.order_id.toLowerCase(), (row.orderId || row.plan.orderHash).toLowerCase(), "original PM identity");
    const snapshot = gtcOrderSnapshot(row);
    if (!snapshot) { unchanged.push({ id: order.id, reason: "outside-reviewed-copy-format" }); continue; }
    assert.equal(typeof snapshot.factsComplete, "boolean");
    if (Object.hasOwn(order.raw, "pmGtcOrderSnapshot")) {
      assert.deepEqual(order.raw.pmGtcOrderSnapshot, snapshot, "existing result copy must match the same execution revision");
      unchanged.push({ id: order.id, reason: "already-current" }); continue;
    }
    operations.push({ id: order.id, executionId: source.id, sourceHash: digest(source), beforeHash: digest(order), before: order, snapshot });
  }
  return { owner, checkedExecutions: executions.length, checkedOrders: orders.length, operations, unchanged };
}
export async function applyResultCopyBatch(client, plan, persistPrepared) {
  assert(plan.operations.length > 0 && plan.operations.length <= 25, "bounded nonempty batch");
  assert.equal(typeof persistPrepared, "function", "durable backup required");
  let commitSent = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='250ms'; SET LOCAL statement_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
    const changes = [];
    for (const op of plan.operations) {
      const source = (await client.query("SELECT * FROM public.pm_gtc_executions WHERE owner=$1 AND id=$2 FOR SHARE NOWAIT", [plan.owner, op.executionId])).rows[0];
      const order = (await client.query("SELECT * FROM public.orders WHERE user_id=$1 AND id=$2 FOR UPDATE NOWAIT", [plan.owner, op.id])).rows[0];
      assert.equal(digest(source), op.sourceHash, "execution changed since plan");
      assert.equal(digest(order), op.beforeHash, "order changed since plan");
      const verified = planResultCopies(plan.owner, [source], [order]);
      assert.deepEqual(verified.operations, [op], "complete planned copy payload");
      const updated = (await client.query(`UPDATE public.orders SET raw=jsonb_set(raw,'{pmGtcOrderSnapshot}',$4::jsonb,true)
        WHERE user_id=$1 AND id=$2 AND provider='Polymarket' AND raw->>'pmGtcExecutionId'=$3
          AND COALESCE(lower(raw->>'pmSide'),'')<>'sell' RETURNING *`, [plan.owner, op.id, op.executionId, op.snapshot])).rows;
      assert.equal(updated.length, 1, "one owned GTC original updated");
      const after = updated[0], restored = structuredClone(after); delete restored.raw.pmGtcOrderSnapshot;
      assert.deepEqual(restored, order, "entire original financial row unchanged apart from the result copy");
      changes.push({ ...op, afterHash: digest(after) });
    }
    const receipt = { owner: plan.owner, operations: changes };
    await persistPrepared(receipt);
    commitSent = true; await client.query("COMMIT");
    return receipt;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (commitSent) error.commitOutcomeRequiresReconciliation = true;
    throw error;
  }
}
