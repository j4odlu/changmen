/** [changmen 扩展] 原始订单表查询与通知字段清理；没有存储模式切换。 */
export function financialOrdersRelation(alias = "") {
  if (alias && !/^[a-z_]+$/i.test(alias))
    throw new Error("非法 orders 别名");

  const table = "orders";

  return alias ? `${table} ${alias}` : table;
}
export function financialOrdersHookRow(row) {

  const control = new Set(["pm_order_mode", "pm_order_snapshot", "execution_kind", "execution_id", "execution_wallet_key", "execution_active", "execution_record", "execution_updated_at", "financial_ready"]);
  // RETURNING * 可能包含历史内部列；通知只发送原业务字段。
  if (![...control].some(key => Object.hasOwn(row, key)))
    return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !control.has(key)));
}
