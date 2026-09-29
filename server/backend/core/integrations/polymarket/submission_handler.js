import { fetchPmSubmissionLogs } from "@changmen/db";
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
  const rows = await fetchPmSubmissionLogs(userId, orderId);
  // 只返回金额/时间快照，不暴露日志、签名、钱包或凭证。
  return { ok: true, info: recoverPmSubmissionFromLogs(rows, owned.player, orderId) };
}
