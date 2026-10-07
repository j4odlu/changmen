import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { fetchPolymarketOrderRow } from "./orderStatus";
import { fetchPolymarketConfirmedTradeForOrder } from "./orders";
import { acceptPmSubmitAttempt, pmSubmitAttemptForOrder, type PmRecoveredEvidence } from "./pmSubmitJournal";
import { readPolymarketOrderWatch } from "./userWs";

/** [changmen 扩展] 空列表/404/读取失败都不能解除未知提交；只认原单的官方证据。 */
export async function recoverPmUnknownSubmission(account: PlatformAccount, orderHash: string,
  side: "BUY" | "SELL", submittedAt: number): Promise<PmRecoveredEvidence | null> {
  const watch = readPolymarketOrderWatch(orderHash, account);
  let row = watch?.row;
  if (!row?.id || row.id.toLowerCase() !== orderHash.toLowerCase()) {
    try { row = await fetchPolymarketOrderRow(account, orderHash) ?? undefined; } catch { /* 继续按精确 trade 查询 */ }
  }
  let accepted = Boolean(row?.id && row.id.toLowerCase() === orderHash.toLowerCase()
    && ["matched", "live", "unmatched", "delayed", "canceled", "cancelled", "expired"].includes(String(row.status).toLowerCase()));
  let trade: PmRecoveredEvidence["trade"];
  if (!accepted) {
    try {
      const fill = await fetchPolymarketConfirmedTradeForOrder(account, orderHash,
        Math.max(10 * 60_000, Date.now() - submittedAt + 60_000), side, true);
      accepted = Boolean(fill);
      if (fill) {
        trade = { size: String(fill.size), price: String(fill.price) };
        row = { ...row, id: orderHash, status: String(fill.status ?? "MATCHED"),
          size_matched: String(fill.size), associate_trades: fill.id ? [String(fill.id)] : undefined };
      }
    }
    catch { /* 未取得证据仍未知 */ }
  }
  const evidence: PmRecoveredEvidence = { row: row ? { id: row.id, status: row.status,
    size_matched: row.size_matched, original_size: row.original_size,
    associate_trades: row.associate_trades } : null, ...(trade ? { trade } : {}) };
  if (accepted && pmSubmitAttemptForOrder(account, orderHash)) {
    try { acceptPmSubmitAttempt(account, orderHash, orderHash, evidence); } catch { /* 此次真实证据仍可用于收尾 */ }
  }
  return accepted ? evidence : null;
}
