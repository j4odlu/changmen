/**
 * CLOB async commit（2026-07-24）：FOK/FAK 成功可能只回 tradeIDs、不内联 transactionsHashes。
 * 对齐 @polymarket/clob-client-v2 `resolveTransactionsHashes` / `waitForResolvedTrades`：
 * 按 tradeID 调 `GET /data/trades?id=`，直至有 transaction_hash 或 status=FAILED。
 * @see https://docs.polymarket.com/changelog
 * @see https://github.com/Polymarket/clob-client-v2/pull/89
 */

export type PolymarketTradeHashRow = {
  id?: string;
  transaction_hash?: string;
  status?: string;
};

export type PolymarketOrderHashFields = {
  tradeIDs?: string[];
  tradeIds?: string[];
  /** 官方 SDK 字段名（多一个 s） */
  transactionsHashes?: string[];
  transactionHashes?: string[];
};

function asStringList(raw: unknown): string[] {
  if (!Array.isArray(raw))
    return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item ?? "").trim();
    if (s)
      out.push(s);
  }
  return out;
}

export function readPolymarketTradeIds(result: PolymarketOrderHashFields | null | undefined): string[] {
  return asStringList(result?.tradeIDs ?? result?.tradeIds);
}

export function readPolymarketTransactionHashes(
  result: PolymarketOrderHashFields | null | undefined,
): string[] {
  return asStringList(result?.transactionsHashes ?? result?.transactionHashes);
}

/** 有 tradeIDs 且尚无 hash → 需要按 id 轮询 /data/trades */
export function needsPolymarketTradeHashEnrichment(
  result: PolymarketOrderHashFields | null | undefined,
): boolean {
  return readPolymarketTradeIds(result).length > 0
    && readPolymarketTransactionHashes(result).length === 0;
}

/** 对齐 SDK isTradeResolved：FAILED 或已有 transaction_hash */
export function isPolymarketTradeHashResolved(trade: PolymarketTradeHashRow | null | undefined): boolean {
  if (!trade)
    return false;
  const status = String(trade.status ?? "").trim().toUpperCase();
  if (status === "FAILED")
    return true;
  return Boolean(String(trade.transaction_hash ?? "").trim());
}

/**
 * 按 tradeID 合并多轮 /data/trades?id= 结果。
 * FAILED 无 hash；有 hash 计入 hashes。
 */
export function collectPolymarketHashesFromTrades(
  tradeIds: string[],
  trades: PolymarketTradeHashRow[],
): { hashes: string[]; pendingIds: string[]; failedIds: string[] } {
  const want = [...new Set(tradeIds.map(id => String(id ?? "").trim()).filter(Boolean))];
  const byId = new Map<string, PolymarketTradeHashRow>();
  for (const row of trades) {
    const id = String(row?.id ?? "").trim();
    if (id && want.includes(id))
      byId.set(id, row);
  }
  const hashes: string[] = [];
  const pendingIds: string[] = [];
  const failedIds: string[] = [];
  const seenHash = new Set<string>();
  for (const id of want) {
    const row = byId.get(id);
    if (!row || !isPolymarketTradeHashResolved(row)) {
      pendingIds.push(id);
      continue;
    }
    const status = String(row.status ?? "").trim().toUpperCase();
    const hash = String(row.transaction_hash ?? "").trim();
    if (status === "FAILED") {
      failedIds.push(id);
      continue;
    }
    if (/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      const key = hash.toLowerCase();
      if (!seenHash.has(key)) {
        seenHash.add(key);
        hashes.push(hash);
      }
      continue;
    }
    // 有非空 hash 但格式异常：仍算 resolved（对齐 SDK Boolean(hash.length)），但不写入
    if (hash) {
      failedIds.push(id);
      continue;
    }
    pendingIds.push(id);
  }
  return { hashes, pendingIds, failedIds };
}

export function withPolymarketTransactionHashes<T extends PolymarketOrderHashFields>(
  result: T,
  hashes: string[],
): T {
  if (!hashes.length)
    return result;
  return {
    ...result,
    transactionsHashes: hashes,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type EnrichTradeHashesOpts = {
  /**
   * 官方：对每个 pending tradeID 调 getTrades({ id }, onlyFirstPage)。
   * 返回该 id 对应的 trades 行（可空）。
   */
  fetchTradesById: (tradeId: string) => Promise<PolymarketTradeHashRow[]>;
  intervalMs?: number;
  /** 默认 3s（热路径）；官方 SDK postOrder 为 30s */
  timeoutMs?: number;
};

/**
 * Best-effort：短轮询补齐 transactionsHashes；超时/失败原样返回，不抛错。
 */
export async function enrichPolymarketOrderTradeHashes<T extends PolymarketOrderHashFields>(
  result: T,
  opts: EnrichTradeHashesOpts,
): Promise<T> {
  if (!needsPolymarketTradeHashEnrichment(result))
    return result;
  const tradeIds = [...new Set(readPolymarketTradeIds(result))];
  const intervalMs = Math.max(50, Number(opts.intervalMs) || 250);
  const timeoutMs = Math.max(intervalMs, Number(opts.timeoutMs) || 3_000);
  const started = performance.now();
  const resolved = new Map<string, PolymarketTradeHashRow>();

  while (performance.now() - started < timeoutMs) {
    const pending = tradeIds.filter(id => !resolved.has(id));
    if (!pending.length)
      break;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remaining = Math.max(0, timeoutMs - (performance.now() - started));
      const pages = await Promise.race([Promise.all(
        pending.map(async (id) => {
          try {
            return await opts.fetchTradesById(id);
          }
          catch {
            return [] as PolymarketTradeHashRow[];
          }
        }),
      ), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), remaining); })]);
      if (timer) clearTimeout(timer);
      if (!pages) break;
      for (const trades of pages) {
        for (const trade of trades) {
          const id = String(trade?.id ?? "").trim();
          if (!id || !tradeIds.includes(id))
            continue;
          if (isPolymarketTradeHashResolved(trade))
            resolved.set(id, trade);
        }
      }
    }
    catch {
      /* best-effort */
    }
    if (tradeIds.every(id => resolved.has(id)))
      break;
    await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - (performance.now() - started))));
  }

  const { hashes } = collectPolymarketHashesFromTrades(tradeIds, [...resolved.values()]);
  if (!hashes.length)
    return result;
  return withPolymarketTransactionHashes(result, hashes);
}
