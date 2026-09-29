/** [changmen 扩展] 原始 BUY 申请快照；只含记账字段，不保存签名或凭证。 */
export interface PmSubmission {
  orderId: string;
  accountId: number;
  makerAmount: string;
  stakeUsdc: number;
  submittedAt: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** CLOB makerAmount 固定为微单位，不按金额大小猜币种。 */
export function pmMakerAmountUsdc(value: unknown): number | null {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text))
    return null;
  const micro = Number(text);
  return Number.isSafeInteger(micro) && micro > 0 ? micro / 1_000_000 : null;
}

export function pmSubmissionFromResult(value: unknown, accountId: number): PmSubmission | null {
  const result = record(value);
  const response = record(result.response);
  const orderId = String(result.orderId || response.orderID || "").trim();
  const order = record(record(result.request).order);
  const stakeUsdc = pmMakerAmountUsdc(order.makerAmount);
  const submittedAt = Number(result.beginTime);
  if (!orderId || (response.orderID && response.orderID !== orderId)
    || String(order.side).toUpperCase() !== "BUY" || stakeUsdc == null
    || !Number.isSafeInteger(accountId) || accountId <= 0
    || !Number.isSafeInteger(submittedAt) || submittedAt <= 0)
    return null;
  return { orderId, accountId, makerAmount: String(order.makerAmount), stakeUsdc, submittedAt };
}

export function validatePmSubmission(value: unknown, orderId: string, accountId: number): PmSubmission | null {
  const row = record(value);
  if (row.orderId !== orderId || row.accountId !== accountId)
    return null;
  const parsed = pmSubmissionFromResult({
    orderId, beginTime: row.submittedAt,
    request: { order: { side: "BUY", makerAmount: row.makerAmount } },
  }, accountId);
  return parsed && parsed.stakeUsdc === row.stakeUsdc ? parsed : null;
}
