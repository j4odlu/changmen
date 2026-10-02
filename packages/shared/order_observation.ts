/** [changmen 扩展] 旁路观察协议；不得作为下注、补单或订单状态的输入。 */
export const OBSERVATION_TITLE = "[changmen] OrderObservation/v1";
export const OBSERVATION_KINDS = ["precheck_started", "precheck_result", "submission_started", "submission_result", "settlement_observed", "queue_created", "queue_replaced", "queue_canceled", "queue_removed", "decision", "bind_result", "transport_gap"] as const;
export type ObservationKind = typeof OBSERVATION_KINDS[number];
export interface ObservationContext {
  attemptId?: string;
  queueId?: string;
  anchorAttemptId?: string;
  anchorOrderId?: string;
  ownerUserId?: string;
  sequence?: number;
}
export interface OrderObservationEvent {
  version: 1;
  eventId: string;
  ownerUserId: string;
  kind: ObservationKind;
  occurredAt: number;
  sequence: number;
  linkId: number;
  attemptId?: string;
  queueId?: string;
  anchorAttemptId?: string;
  anchorOrderId?: string;
  provider?: string;
  accountId?: number;
  orderId?: string;
  target?: string;
  phase?: string;
  outcome?: string;
  source?: string;
  reasonCode?: string;
  odds?: number;
  amount?: number;
  planAmount?: number;
  exchange?: number;
  rate?: number;
  currency?: string;
  observedStatus?: string;
  receivedAt?: number;
}

/** 白名单复制；禁止把 request/response/token/config 整体写入事件。 */
export function normalizeObservationEvent(raw: unknown, ownerUserId: string): OrderObservationEvent | null {
  if (!raw || typeof raw !== "object")
    return null;
  if (typeof ownerUserId !== "string" || !ownerUserId.trim() || ownerUserId.length > 160)
    return null;
  const row = raw as Record<string, unknown>;
  if (row.version !== 1 || row.ownerUserId !== ownerUserId || !OBSERVATION_KINDS.includes(row.kind as ObservationKind))
    return null;
  if (typeof row.eventId !== "string" || !/^[\w-]{8,80}$/.test(row.eventId))
    return null;
  if (!Number.isSafeInteger(row.linkId) || !Number.isSafeInteger(row.sequence) || Number(row.sequence) < 1
    || !Number.isSafeInteger(row.occurredAt) || Number(row.occurredAt) <= 0) {
    return null;
  }
  const event: OrderObservationEvent = {
    version: 1,
    eventId: row.eventId,
    ownerUserId,
    kind: row.kind as ObservationKind,
    linkId: Number(row.linkId),
    sequence: Number(row.sequence),
    occurredAt: Number(row.occurredAt),
  };
  for (const key of ["attemptId", "queueId", "anchorAttemptId", "anchorOrderId", "provider", "orderId", "target", "phase", "outcome", "source", "reasonCode", "currency", "observedStatus"] as const) {
    if (typeof row[key] === "string" && row[key].length <= 160)
      event[key] = row[key];
  }
  for (const key of ["accountId", "odds", "amount", "planAmount", "exchange", "rate"] as const) {
    if (typeof row[key] === "number" && Number.isFinite(row[key]))
      event[key] = row[key];
  }
  return event;
}
