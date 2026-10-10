import { upsertOrders, upsertPmGtcOrders } from "@changmen/db";

/** [changmen 扩展] Only canonical GTC buys need protection against stale venue snapshots. */
export function saveRowsByExecution(rows) {
  const protectedBuy = row => row.provider === "Polymarket" && row.raw?.pmSide !== "sell"
    && row.raw?.pmGtcExecutionId && row.raw.pmGtcBuyCost != null;
  const gtc = rows.filter(protectedBuy);
  if (!gtc.length)
    return upsertOrders(rows);
  const ordinary = rows.filter(row => !protectedBuy(row));
  if (!ordinary.length)
    return upsertPmGtcOrders(gtc);
  // An unrelated canonical GTC refresh must not hold up an ordinary FOK batch.
  void upsertPmGtcOrders(gtc).catch(error => console.warn("[GTC] snapshot save failed:", error.message));
  return upsertOrders(ordinary);
}
