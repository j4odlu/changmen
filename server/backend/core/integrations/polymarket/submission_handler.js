import { validatePmSubmission } from "@changmen/shared/pm_submission";
import { fetchPmSubmissionLogs, fetchOrdersByPlayerOrderIdsStrict, fetchOrdersByPlayerStrict } from "@changmen/db";
import { assertPlayerOwnedByUser } from "../../account/player_ownership.js";
import { recoverPmSubmissionFromLogs } from "./submission_snapshot.js";

export async function handlePmGetSubmission(body, userId) {
  if (!userId)
    return { ok: false, msg: "请先登录" };
  const orderId = String(body.orderId ?? "").trim();
  if (!/^0x[0-9a-f]{64}$/i.test(orderId))
    return { ok: false, msg: "原单 ID 无效" };
  const owned = await assertPlayerOwnedByUser(body.playerId, userId);
  if (!owned.ok)
    return owned;
  if (owned.player?.provider !== "Polymarket")
    return { ok: false, msg: "不是 PM 账号" };
  const orders = await fetchOrdersByPlayerOrderIdsStrict(Number(owned.player.id), userId, [orderId]);
  const stored = orders.find(row => row.provider === "Polymarket" && String(row.order_id).toLowerCase() === orderId.toLowerCase());
  const submission = validatePmSubmission(stored?.raw?.pmSubmission, stored?.order_id, Number(owned.player.id));
  if (submission) return { ok: true, info: submission };
  const rows = await fetchPmSubmissionLogs(userId, orderId);
  // 只返回金额/时间快照，不暴露日志、签名、钱包或凭证。
  return { ok: true, info: recoverPmSubmissionFromLogs(rows, owned.player, orderId) };
}

/** [changmen 扩展] 恢复检测只返回查询身份与提交证据，不把名称交给确认任务。 */
export async function handlePmGetPendingOrders(body, userId) {
  if (!userId) return { ok: false, msg: "请先登录" };
  const owned = await assertPlayerOwnedByUser(body.playerId, userId);
  if (!owned.ok) return owned;
  if (owned.player?.provider !== "Polymarket") return { ok: false, msg: "不是 PM 账号" };
  const rows = await fetchOrdersByPlayerStrict(Number(owned.player.id), userId, { pmPendingOnly: true });
  const info = [];
  for (const row of rows) {
    const raw = row.raw || {};
    const submission = validatePmSubmission(raw.pmSubmission, row.order_id, Number(owned.player.id));
    if (!submission || raw.pmGtcExecutionId) continue;
    info.push({ orderId: row.order_id, submission, matchId: String(raw.venueMatchId || ""),
      conditionId: String(raw.pmConditionId || ""), tokenId: String(raw.pmTokenId || ""),
      target: String(raw.venueItemId || "Home"), odds: Number(row.odds) || 0, linkId: Number(row.link) || 0 });
  }
  return { ok: true, info };
}
