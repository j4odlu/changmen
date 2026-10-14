/** [changmen 扩展] 已有财务写入的附加快照；不作为下单、授权、补单或监控的输入。 */
const traditionalProviders = new Set(["OB", "RAY", "IA", "SABA", "PB", "HG"]);

export function gtcOrderSnapshot(row) {
  const plan = row.plan;
  // 仅识别原计划明确的自动 PM GTC＋传统场馆；未知组合保持旧处理。
  if (!plan || plan.source != null || !traditionalProviders.has(plan.otherProvider)
    || !Number.isSafeInteger(plan.otherPlayerId) || plan.otherPlayerId <= 0
    || !["A", "B"].includes(plan.originalPmLeg))
    return;
  return {
    version: 1,
    timeInForce: "GTC",
    executionRevision: row.revision ?? null,
    requestedShares: plan.shares ?? null,
    cumulativeMatchedShares: row.matched ?? null,
    openShares: row.open ?? null,
    officialStatus: row.order?.status ?? null,
    submitState: row.submit ?? null,
    principalUsdc: row.principal ?? null,
    feeUsdc: row.fee ?? null,
    factsComplete: row.complete ?? null,
    observedAt: row.observedAt ?? null,
  };
}
