/** [changmen 扩展] 阶段二财务消费者兼容。只读验证后显式启用，不创建 schema。 */
let readyPool;

export function ordersExecutionCompatibilityEnabled() {
  const mode = process.env.ORDERS_EXECUTION_COMPAT;
  if (mode != null && mode !== "" && mode !== "0" && mode !== "1")
    throw new Error("ORDERS_EXECUTION_COMPAT 只能是 0 或 1");
  if (mode !== "1")
    return false;
  if (!readyPool)
    throw new Error("orders 执行兼容 schema 尚未通过启动验证");
  return true;
}

export async function prepareOrdersExecutionCompatibility(pool) {
  if (process.env.ORDERS_EXECUTION_COMPAT !== "1") {
    ordersExecutionCompatibilityEnabled();
    return;
  }
  if (!pool)
    throw new Error("orders 执行兼容需要数据库");
  if (readyPool === pool)
    return;
  readyPool = undefined;
  // 函数以固定版本、列类型、约束、索引、视图及删除保护定义验证；没有 DDL。
  const result = await pool.query("SELECT public.validate_orders_execution_schema_v1() AS valid");
  if (result.rows?.[0]?.valid !== true)
    throw new Error("orders 执行兼容 schema 验证失败");
  readyPool = pool;
}

/** 常量表名/别名；兼容模式在 SQL 的 COUNT/LIMIT/JOIN 之前过滤，不在 JS 丢行。 */
export function financialOrdersRelation(alias = "") {
  if (alias && !/^[a-z_]+$/i.test(alias))
    throw new Error("非法 orders 别名");
  const enabled = ordersExecutionCompatibilityEnabled();
  const table = enabled ? "public.orders_financial" : "orders";
  if (!alias && enabled)
    return `${table} AS orders`;
  return alias ? `${table} ${alias}` : table;
}

export function ordinaryOrdersUpsertSql(sql, hasWhere = false) {
  if (!ordersExecutionCompatibilityEnabled())
    return sql;
  const insertBoundary = "  ON CONFLICT (user_id, order_id, player_id) DO UPDATE SET";
  const returnBoundary = "  RETURNING *, (xmax = 0) AS was_inserted";
  if (sql.split(insertBoundary).length !== 2 || sql.split(returnBoundary).length !== 2)
    throw new Error("普通 orders upsert 边界已改变");
  // 客户端 SaveOrder 不能把未知控制行写成零金额财务单，也不能插入 hash 大小写副本。
  return sql.replace(insertBoundary, `  ${hasWhere ? "AND" : "WHERE"} NOT EXISTS (SELECT 1 FROM orders pending
    WHERE pending.user_id=t.user_id AND pending.player_id=t.player_id
      AND lower(pending.order_id)=lower(t.order_id) AND NOT pending.financial_ready)
${insertBoundary}`).replace(returnBoundary, `  WHERE orders.financial_ready
${returnBoundary}`);
}

/** 保持普通首次财务入库 hook 的原列形状，控制 payload 不进入旧消费者。 */
export function financialOrdersHookRow(row) {
  const control = new Set(["execution_kind", "execution_id", "execution_wallet_key", "execution_active", "execution_record", "execution_updated_at", "financial_ready"]);
  // 空扩展 schema、兼容尚未启用时 RETURNING * 也会多出 NULL 控制列。
  if (![...control].some(key => Object.hasOwn(row, key)))
    return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !control.has(key)));
}

/** 幂等财务删除：控制原单仅隐藏财务，其余行物理删除；同一语句按 id 排序加更新锁。 */
export const DELETE_FINANCIAL_ORDERS_SQL = `WITH targets AS MATERIALIZED (
  SELECT id, execution_id FROM orders WHERE id=ANY($1::bigint[]) AND financial_ready
  ORDER BY id FOR UPDATE
), hidden AS (
  UPDATE orders o SET financial_ready=false FROM targets t
  WHERE o.id=t.id AND t.execution_id IS NOT NULL AND o.financial_ready RETURNING o.id
), removed AS (
  DELETE FROM orders o USING targets t
  WHERE o.id=t.id AND t.execution_id IS NULL AND o.financial_ready RETURNING o.id
)
SELECT id FROM hidden UNION ALL SELECT id FROM removed`;

export function financialDeletionIds(ids) {
  return [...new Set(ids.filter(id => typeof id === "string" || Number.isSafeInteger(id))
    .map(id => String(id).trim())
    .filter(id => /^\d+$/.test(id) && BigInt(id) > 0n && BigInt(id) <= 9223372036854775807n))];
}

/** 真正切换控制源前仍锁旧表，使用 UPDATE 避免后续合表产生 SHARE→UPDATE 升级。 */
export function gtcExecutionLockSql() {
  return ordersExecutionCompatibilityEnabled()
    ? "SELECT record FROM pm_gtc_executions WHERE id=$1 AND owner=$2 FOR UPDATE"
    : "SELECT record FROM pm_gtc_executions WHERE id=$1 AND owner=$2 FOR SHARE";
}

/** 原财务资格内的一次原写入：不增加 await/查询，也不新增普通 inserted hook。 */
export function gtcFinancialUpsertSql(sql) {
  if (!ordersExecutionCompatibilityEnabled())
    return sql;
  const values = "VALUES($1,$2,$3,$4,'Polymarket',$5,$6,$7,$8,$9,0,'None',$10,$11)";
  const conflict = "ON CONFLICT(user_id,order_id,player_id) DO UPDATE SET";
  if (sql.split(values).length !== 2 || sql.split(conflict).length !== 2 || sql.split("orders.raw").length !== 4)
    throw new Error("GTC 财务原写入边界已改变");
  // 标量原单查询保留库内拼写；重复行产生 cardinality violation，身份冲突产生 NOT NULL 错误。
  // 仍由原 INSERT/ON CONFLICT 获取目标更新锁，没有额外锁升级或查询往返。
  const prefix = `WITH gtc_financial_target AS MATERIALIZED (
    SELECT order_id,execution_id,financial_ready FROM orders
    WHERE user_id=$1 AND player_id=$2 AND lower(order_id)=lower($3)
  ) `;
  const originalId = `CASE WHEN EXISTS(SELECT 1 FROM gtc_financial_target)
    THEN (SELECT CASE WHEN execution_id=($11::jsonb->>'pmGtcExecutionId')::uuid
      OR (execution_id IS NULL AND financial_ready) THEN order_id ELSE NULL END FROM gtc_financial_target)
    ELSE $3 END`;
  // 已删除财务再入库与旧「删除后 INSERT」一致，控制和主键保持；已知财务旧账本原样累计。
  const priorRaw = "(CASE WHEN orders.financial_ready THEN orders.raw ELSE '{}'::jsonb END)";
  sql = sql.replaceAll("orders.raw", priorRaw);
  sql = sql.replace(values, `SELECT $1,$2,${originalId},$4,'Polymarket',$5,$6,$7,$8,$9,0,'None',$10,$11`);
  const columns = ["link", "provider", "match", "bet", "item", "money", "status", "create_at", "changmen_bet"];
  const promotion = columns.map(column => `${column}=CASE WHEN orders.financial_ready THEN orders.${column} ELSE EXCLUDED.${column} END,`).join("\n        ");
  return prefix + sql.replace(conflict, `${conflict}\n        financial_ready=true,\n        ${promotion}`);
}
