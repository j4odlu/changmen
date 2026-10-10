/** [changmen 扩展] Mode is ordinary order metadata, not a coordinator read dependency. */
const verifiedExecution = Symbol("verified-order-execution");

/** Only the GTC endpoint may establish a new identity, after its ownership/anchor checks. */
export function verifyOrderExecution(order, id) {
  Object.defineProperty(order, verifiedExecution, { value: String(id) });
}

/** Reuse the ordinary writer's existing strict read. No DB or execution-module calls. */
export function preserveOrderMode(raw, previous, incoming, existingById) {
  const parentId = String(incoming.pmBuyOrderId ?? incoming.PmBuyOrderId ?? incoming.pfBuyOrderId ?? incoming.PfBuyOrderId ?? "").toLowerCase();
  const parent = parentId && [...existingById.values()].find(row => String(row.order_id).toLowerCase() === parentId
    && (!raw.provider || row.provider === raw.provider));
  const identity = previous.pmGtcExecutionId || parent?.raw?.pmGtcExecutionId || incoming[verifiedExecution];
  if (!identity) {
    // JSON input cannot relabel an ordinary order or invent canonical GTC costs.
    for (const key of ["pmGtcExecutionId", "pmGtcRevision", "pmGtcBuyShares", "pmGtcBuyCost"])
      delete raw[key];
    return;
  }
  raw.pmGtcExecutionId = String(identity);
  for (const key of ["pmGtcRevision", "pmGtcBuyShares", "pmGtcBuyCost"]) {
    if (previous[key] != null)
      raw[key] = previous[key];
    else
      delete raw[key];
  }
}
