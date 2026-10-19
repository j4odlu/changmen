/** 对齐 A8 `TQ` Map — PB 下注需 lineId，由采集器写入 */

const lineByBetId = new Map<string, number>();

export function setPbLineId(betId: string, lineId: number): void {
  if (betId && lineId) lineByBetId.set(betId, lineId);
}

export function getPbLineId(betId: string): number {
  return lineByBetId.get(betId) ?? 0;
}
