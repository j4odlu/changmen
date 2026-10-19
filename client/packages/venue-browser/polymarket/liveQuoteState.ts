const lastLiveQuoteTs = new Map<string, number>();
/** 纠偏 fo 后保护窗：无 timestamp 的迟到 WS 不得在此期间把 fo 打回去 */
const LIVE_BOOK_WS_GUARD_MS = 2_000;

export function resetPolymarketLiveQuoteTsForTests(): void {
  lastLiveQuoteTs.clear();
}

/** 「盘口价高于检测价」刚写过 fo：后续更旧的 WS 帧丢掉 */
export function notePolymarketLiveBookQuote(assetId: string, atMs = Date.now()): void {
  const id = String(assetId || "").trim();
  if (!id)
    return;
  const prev = lastLiveQuoteTs.get(id) ?? 0;
  if (atMs > prev)
    lastLiveQuoteTs.set(id, atMs);
}

/**
 * 是否采用本条 WS 卖一。
 * - 有交易所 timestamp：严格新于上次（纠偏 fo 时会钉墙钟）
 * - 无 timestamp：纠偏 fo 后 2s 内拒绝，避免 hub 迟到帧回绕
 */
export function shouldApplyPolymarketWsQuote(assetId: string, exchangeTs?: number): boolean {
  const id = String(assetId || "").trim();
  if (!id)
    return false;
  const prev = lastLiveQuoteTs.get(id) ?? 0;
  const incoming = Number(exchangeTs);
  if (!Number.isFinite(incoming) || incoming <= 0) {
    if (prev > 0 && Date.now() - prev < LIVE_BOOK_WS_GUARD_MS)
      return false;
    return true;
  }
  if (incoming < prev)
    return false;
  lastLiveQuoteTs.set(id, incoming);
  return true;
}
