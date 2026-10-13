/** [changmen 扩展] GTC 订单投影；旧执行记录始终是唯一控制来源。 */
import { gtcUnits } from "@changmen/shared/pm_gtc";
import { sqlOrderBelongsToRange } from "../order_link_filter.js";
import { localDayBounds } from "./time_bounds.js";
import { getPgPool } from "./common.js";

let validatedPool;
function projectionWriteFlag() {
  const value = process.env.PM_ORDERS_MINIMAL_PROJECTION_WRITE;
  if (![undefined,"","0","1"].includes(value)) throw new Error("PM_ORDERS_MINIMAL_PROJECTION_WRITE 只能是 0 或 1");
  return value !== "0";
}
export function pmOrdersMinimalProjectionWritesEnabled() {
  return pmOrdersMinimalEnabled() && projectionWriteFlag();
}
export function pmOrdersMinimalEnabled() {
  const value = process.env.PM_ORDERS_MINIMAL;
  if (value != null && value !== "" && value !== "0" && value !== "1")
    throw new Error("PM_ORDERS_MINIMAL 只能是 0 或 1");
  if (value !== "1") return false;
  projectionWriteFlag();
  if (process.env.ORDERS_EXECUTION_COMPAT === "1")
    throw new Error("最小订单模式不能同时开启旧完整并表兼容");
  if (![undefined,"","0"].includes(process.env.ORDERS_EXECUTION_COMPAT)) throw new Error("旧兼容开关值无效");
  if (!validatedPool) throw new Error("PM 最小订单 schema 尚未通过启动验证");
  return true;
}
export async function preparePmOrdersMinimal(pool) {
  if (process.env.PM_ORDERS_MINIMAL !== "1") { pmOrdersMinimalEnabled(); return; }
  projectionWriteFlag();
  if (process.env.ORDERS_EXECUTION_COMPAT === "1") throw new Error("最小订单模式不能同时开启旧完整并表兼容");
  if (![undefined,"","0"].includes(process.env.ORDERS_EXECUTION_COMPAT)) throw new Error("旧兼容开关值无效");
  if (validatedPool === pool) return;
  validatedPool = undefined;
  if (!pool || (await pool.query("SELECT public.validate_pm_orders_minimal_v1() AS valid")).rows?.[0]?.valid !== true)
    throw new Error("PM 最小订单 schema 验证失败");
  validatedPool = pool;
}

export function minimalHookRow(row) {
  if (!Object.hasOwn(row, "pm_order_mode") && !Object.hasOwn(row, "pm_order_snapshot")) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !["pm_order_mode", "pm_order_snapshot"].includes(key)));
}

// 不复制授权/计划/成交明细，不推导新的费用或财务金额。
export function minimalGtcSnapshot(row, updatedAt) {
  if (row.submit !== "accepted" || !row.orderId || row.orderId.toLowerCase() !== row.plan.orderHash.toLowerCase()) return null;
  const detail = Object.values(row.fills).filter(fill => fill.status !== "FAILED")
    .reduce((sum, fill) => sum + gtcUnits(fill.shares), 0n);
  const agrees = row.order && gtcUnits(row.order.matched) === gtcUnits(row.matched) && detail === gtcUnits(row.matched);
  const financial = row.financialOrder;
  return { version: 1, executionId: row.id, revision: row.revision, updatedAt,
    submit: row.submit, orderStatus: row.order?.status ?? null,
    matchedShares: agrees ? row.matched : null, remainingShares: row.open,
    complete: row.complete, terminal: row.terminal, hasError: Boolean(row.error),
    buyFinancial: financial ? { ...financial } : agrees && row.matched === "0"
      ? { pmShares: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, betMoney: 0 } : null };
}

export async function persistMinimalGtcOrder(client, row) {
  if (!pmOrdersMinimalProjectionWritesEnabled() || row.decision !== "closed") return;
  const snapshot = minimalGtcSnapshot(row, 0);
  if (!snapshot) return;
  const source = await client.query("SELECT updated_at FROM pm_gtc_executions WHERE id=$1 AND owner=$2 AND (record->>'revision')::bigint=$3", [row.id,row.owner,row.revision]);
  if (source.rows.length !== 1) throw new Error("GTC 投影来源版本改变");
  snapshot.updatedAt = Number(source.rows[0].updated_at);
  const candidates = await client.query(`SELECT id,provider,execution_id,raw,pm_order_mode,pm_order_snapshot FROM orders
    WHERE user_id=$1 AND player_id=$2 AND lower(order_id)=lower($3) ORDER BY id FOR UPDATE`, [row.owner, row.plan.playerId, row.orderId]);
  if (candidates.rows.length > 1) throw new Error("GTC 原单大小写身份冲突");
  const prior = candidates.rows[0];
  if (prior && (prior.provider !== "Polymarket" || (prior.pm_order_mode && prior.pm_order_mode !== "GTC") || (prior.execution_id && prior.execution_id !== row.id)
    || (prior.raw?.pmGtcExecutionId && prior.raw.pmGtcExecutionId !== row.id))) throw new Error("GTC 原单归属冲突");
  if (prior?.pm_order_snapshot && (prior.pm_order_snapshot.executionId !== row.id || prior.pm_order_snapshot.revision > row.revision))
    throw new Error("GTC 订单投影版本冲突");
  if (prior) {
    await client.query(`UPDATE orders SET pm_order_mode='GTC',pm_order_snapshot=$2,execution_id=$3 WHERE id=$1`, [prior.id, snapshot, row.id]);
    return;
  }
  // 仅缺行后台写入短暂 NOWAIT 锁并重查，防止普通 writer 以另一大小写抢先插入。
  await client.query("LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE NOWAIT");
  const repeat = await client.query("SELECT id FROM orders WHERE user_id=$1 AND player_id=$2 AND lower(order_id)=lower($3)", [row.owner, row.plan.playerId, row.orderId]);
  if (repeat.rows.length) throw new Error("GTC 原单入库竞争，请重新核对");
  await client.query(`INSERT INTO orders(user_id,player_id,order_id,link,provider,match,bet,item,create_at,raw,
    financial_ready,execution_id,pm_order_mode,pm_order_snapshot)
    VALUES($1,$2,$3,$4,'Polymarket',$5,$6,$7,$8,$9,false,$10,'GTC',$11)`,
  [row.owner,row.plan.playerId,row.orderId,row.plan.linkId,row.plan.match,row.plan.bet,row.plan.item,row.createdAt,
    { pmGtcExecutionId: row.id, pmSide: "buy", pmTokenId: row.plan.tokenId, pmConditionId: row.plan.conditionId, pmOrigin: "changmen" },row.id,snapshot]);
}

export function minimalFinancialSql(sql) {
  // 原 GTC 财务 SQL 已处理资格晋升/删除后重入；只标记 PM 原单模式。
  const columns = "status,create_at,raw)";
  const values = "0,'None',$10,$11";
  const target = "SELECT order_id,execution_id,financial_ready FROM orders";
  const guard = "THEN (SELECT CASE WHEN execution_id=";
  const guardEnd = "OR (execution_id IS NULL AND financial_ready) THEN order_id";
  const conflict = "ON CONFLICT(user_id,order_id,player_id) DO UPDATE SET";
  if ([columns, values, target, guard, guardEnd, conflict].some(boundary => sql.split(boundary).length !== 2)) throw new Error("GTC 原财务写入边界改变");
  // CTE 读取后可能等待另一 writer；ON CONFLICT 获取行锁后重新验证当前身份。
  // 冲突时写入 NULL order_id 触发原 NOT NULL，整笔执行事实/财务事务一同回滚。
  const lockedIdentity = `orders.provider='Polymarket' AND (orders.pm_order_mode IS NULL OR orders.pm_order_mode='GTC')
    AND (NULLIF(orders.raw->>'pmGtcExecutionId','') IS NULL OR orders.raw->>'pmGtcExecutionId'=($11::jsonb->>'pmGtcExecutionId'))
    AND (orders.execution_id=($11::jsonb->>'pmGtcExecutionId')::uuid OR (orders.execution_id IS NULL AND orders.financial_ready))`;
  return sql.replace("SELECT order_id,execution_id,financial_ready FROM orders", "SELECT order_id,execution_id,financial_ready,raw,pm_order_mode FROM orders")
    .replace("THEN (SELECT CASE WHEN execution_id=", "THEN (SELECT CASE WHEN (pm_order_mode IS NULL OR pm_order_mode='GTC') AND (NULLIF(raw->>'pmGtcExecutionId','') IS NULL OR raw->>'pmGtcExecutionId'=($11::jsonb->>'pmGtcExecutionId')) AND (execution_id=")
    .replace("OR (execution_id IS NULL AND financial_ready) THEN order_id", "OR (execution_id IS NULL AND financial_ready)) THEN order_id")
    .replace(columns, "status,create_at,raw,pm_order_mode)")
    .replace(values, "0,'None',$10,$11,'GTC'")
    .replace(conflict, `${conflict} order_id=CASE WHEN ${lockedIdentity} THEN orders.order_id ELSE NULL END, pm_order_mode='GTC',`);
}

export function minimalFinancialDeletionSql(sql) {
  if (!pmOrdersMinimalEnabled()) return sql;
  const target = "SELECT id, execution_id FROM orders WHERE";
  if (sql.split(target).length !== 2) throw new Error("GTC 财务删除边界改变");
  // 历史七列副本不代表已有展示原单；只保留能满足非财务资格的 GTC 投影。
  return sql.replace(target, `SELECT id, CASE WHEN provider='Polymarket' AND pm_order_mode='GTC'
    AND pm_order_snapshot->>'version'='1' AND pm_order_snapshot->>'submit'='accepted'
    AND pm_order_snapshot->>'executionId'=execution_id::text THEN execution_id ELSE NULL END AS execution_id FROM orders WHERE`);
}

export async function fetchMinimalOrderListPage(date, owner, pageIndex=1, pageSize=1024) {
  if (!pmOrdersMinimalEnabled()) throw new Error("最小订单读取未启用");
  const pool = getPgPool();
  if (!pool || !owner) return { rows: [], total: 0 };
  const { dayStart, dayEnd } = localDayBounds(date);
  const size=Math.max(1,Math.min(Number(pageSize)||1024,5000)), page=Math.max(1,Number(pageIndex)||1);
  const where=`user_id=$1 AND ${sqlOrderBelongsToRange(2,3)} AND
    (financial_ready OR (provider='Polymarket' AND pm_order_mode='GTC' AND pm_order_snapshot IS NOT NULL))`;
  const params=[String(owner),dayStart,dayEnd];
  const count=await pool.query(`SELECT count(*)::int AS n FROM orders WHERE ${where}`,params);
  const result=await pool.query(`SELECT * FROM orders WHERE ${where} ORDER BY create_at DESC LIMIT $4 OFFSET $5`,[...params,size,(page-1)*size]);
  return { rows:result.rows,total:count.rows[0]?.n??0 };
}

export function minimalClientOrder(row, result) {
  if (!pmOrdersMinimalEnabled() || row.provider !== "Polymarket" || !["FOK","GTC"].includes(row.pm_order_mode)) return result;
  const dto={ ...result, PmOrderMode: row.pm_order_mode };
  if (row.financial_ready !== false) return dto;
  const view=row.pm_order_snapshot;
  if (row.pm_order_mode !== "GTC" || !view || view.executionId !== row.execution_id) throw new Error("非财务 GTC 投影身份无效");
  return { ...dto, DisplayOnly:true, PmGtcExecutionId:view.executionId,
    ...(view.terminal && view.complete && view.hasError === false && view.matchedShares === "0" ? { Status:"Return" } : {}),
    PmShares:view.matchedShares==null?undefined:Number(view.matchedShares),
    PmGtcBuyShares:view.matchedShares==null?undefined:Number(view.matchedShares),
    BetMoney:view.buyFinancial?.betMoney, Money:undefined, Odds:undefined,
    PmFillPrice:view.buyFinancial?.pmFillPrice, PmStakeUsdc:view.buyFinancial?.pmStakeUsdc,
    PmFeeUsdc:view.buyFinancial?.pmFeeUsdc };
}
