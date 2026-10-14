/** [changmen 扩展] 只读恢复聚合：两张表、两个读取分区，任何分区失败不抹掉另一分区结果。 */
import { listPmGtc } from "@changmen/db";
import { gtcUnits } from "@changmen/shared/pm_gtc";
import { GTC_RECOVERY_KNOWN_LIMIT, gtcRecoveryFinancialKey } from "@changmen/shared/pm_gtc_recovery";
import { getGtcMonitorOrders } from "./orders.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function decode(value) {
  try { return typeof value === "string" ? JSON.parse(value) : value; }
  catch { throw new Error("GTC 恢复参数无效"); }
}
function boolean(value, fallback = false) {
  const parsed = value == null ? fallback : decode(value);
  if (typeof parsed !== "boolean")
    throw new Error("GTC 恢复开关无效");
  return parsed;
}
function identities(value, limit) {
  const ids = decode(value ?? []);
  if (!Array.isArray(ids) || ids.length > limit || ids.some(id => typeof id !== "string" || !uuid.test(id)))
    throw new Error("GTC 恢复身份无效");
  return [...new Set(ids.map(id => id.toLowerCase()))];
}
function dictionary(value, valid) {
  const known = decode(value ?? {});
  if (!known || typeof known !== "object" || Array.isArray(known) || Object.keys(known).length > GTC_RECOVERY_KNOWN_LIMIT
    || Object.entries(known).some(([id, item]) => !uuid.test(id) || !valid(item))) {
    throw new Error("GTC 恢复已知数据无效");
  }
  return Object.fromEntries(Object.entries(known).map(([id, item]) => [id.toLowerCase(), item]));
}
function mayHaveFinancialOriginal(row) {
  const zeroComplete = row.terminal && row.complete && !row.error && row.open === "0" && gtcUnits(row.matched) === 0n
    && !Object.keys(row.fills).length && (!row.order || (gtcUnits(row.order.matched) === 0n && !row.order.tradeIds.length))
    && (row.submit === "rejected" || (row.submit === "accepted" && row.order && row.orderId));
  const pmMayExist = row.pmAuthorized || row.orderId || !["prepared", "not_attempted"].includes(row.submit)
    || Number(row.financialOrder?.pmShares) > 0;
  return Boolean(pmMayExist && (row.orderId || row.plan.orderHash) && !zeroComplete)
    || Boolean(row.other.orderId && ["authorized", "accepted", "pending", "unknown", "filled"].includes(row.other.state));
}
const failed = error => ({ ok: false, message: error instanceof Error ? error.message : "GTC 恢复读取失败" });

export async function recoverPmGtc(body, owner) {
  if (!owner)
    throw new Error("请先登录");
  // 所有输入在读取前校验；认证归属始终来自 HTTP 会话。
  const discover = boolean(body.discover, true);
  const recoverDiscovered = boolean(body.recoverDiscovered, true);
  const known = dictionary(body.knownRevisions, value => Number.isSafeInteger(value) && value >= 0);
  const knownOrders = dictionary(body.knownOrders, value => typeof value === "string" && value.length <= 200000);
  const requested = identities(body.monitorIds, 1000);
  const skipped = new Set(identities(body.skipMonitorIds, GTC_RECOVERY_KNOWN_LIMIT));
  const readOrders = async (ids, records) => {
    try {
      const rows = await getGtcMonitorOrders({ ids }, owner, records);
      const unchangedIds = ids.filter(id => knownOrders[id] === gtcRecoveryFinancialKey(rows.filter(row => row.PmGtcExecutionId === id)));
      const unchanged = new Set(unchangedIds);
      return { ok: true, ids, unchangedIds, rows: rows.filter(row => !unchanged.has(row.PmGtcExecutionId)) };
    }
    catch (error) { return { ...failed(error), ids, unchangedIds: [] }; }
  };
  const executionsTask = discover
    ? listPmGtc(owner, undefined, known).then((rows) => {
        if (rows.some(row => row.owner !== owner || !uuid.test(row.id)))
          throw new Error("GTC 恢复执行归属无效");
        return { ok: true, rows };
      }).catch(failed)
    : Promise.resolve(null);
  // 已知原单财务读取先发起，执行分区失败仍可以成功恢复财务。
  const ordersTask = requested.length ? readOrders(requested) : Promise.resolve(null);
  const [executions, requestedOrders] = await Promise.all([executionsTask, ordersTask]);
  const orders = requestedOrders ? [requestedOrders] : [];
  if (recoverDiscovered && executions?.ok) {
    const requestedSet = new Set(requested);
    const records = [];
    for (const row of executions.rows) {
      if (requestedSet.has(row.id) || skipped.has(row.id))
        continue;
      try {
        if (mayHaveFinancialOriginal(row))
          records.push(row);
      }
      catch (error) { orders.push({ ...failed(error), ids: [row.id], unchangedIds: [] }); }
    }
    for (let offset = 0; offset < records.length; offset += 1000) {
      const batch = records.slice(offset, offset + 1000);
      orders.push(await readOrders(batch.map(row => row.id), batch));
    }
  }
  return { executions, orders };
}
