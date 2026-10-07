import { pmSubmissionFromResult } from "@changmen/shared/pm_submission";

/** [changmen 扩展] 只接受明确属于该账号、原单 ID 一致的 BUY POST；拒绝矛盾证据。 */
export function recoverPmSubmissionFromLogs(rows, player, orderId) {
  if (rows.length > 20)
    return null;
  let snapshot = null;
  for (const row of rows) {
    let data;
    try { data = typeof row.data === "string" ? JSON.parse(row.data) : row.data; }
    catch { continue; }
    if (!data || typeof data !== "object")
      continue;
    if (data.accountId != null) {
      if (Number(data.accountId) !== Number(player.id))
        continue;
    }
    else if (!player.playerName || !String(row.title).startsWith("[Polymarket](")
      || !String(row.title).includes(`,${player.playerName}) 下注 =>`)) {
      continue;
    }
    if (data.result?.provider !== "Polymarket")
      continue;
    const found = pmSubmissionFromResult(data.result, Number(player.id));
    if (!found || found.orderId !== orderId)
      continue;
    if (snapshot && (snapshot.makerAmount !== found.makerAmount || snapshot.submittedAt !== found.submittedAt))
      return null;
    if (snapshot?.makerAddress && found.makerAddress && snapshot.makerAddress !== found.makerAddress)
      return null;
    snapshot = { ...found, ...(found.makerAddress || snapshot?.makerAddress
      ? { makerAddress: found.makerAddress || snapshot.makerAddress } : {}) };
  }
  return snapshot;
}
