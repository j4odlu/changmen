/**
 * changmen 操盘账号归属：每个 players 行必须 owner_user_id === 当前登录用户。
 * A8 前端只传 playerId；隔离由后端保证（非 A8 黑盒后端复刻）。
 */
import * as sb from "@changmen/db";

export async function assertPlayerOwnedByUser(playerId, userId) {  const batch = await assertPlayersOwnedByUser([playerId], userId);
  if (!batch.ok)
    return batch;
  return { ok: true, player: batch.players?.[0] };
}

/** SaveData ACCOUNT：一次 RDS 查询校验全部 accountId */
export async function assertPlayersOwnedByUser(playerIds, userId, snapshotRows) {
  if (!userId)
    return { ok: false, msg: "请先登录" };
  const ids = [...new Set((playerIds || []).map(id => Number(id)).filter(id => id > 0))];
  if (!ids.length)
    return { ok: false, msg: "accountId 无效，请先调用 Client_CreateTagPlatform" };
  const rows = snapshotRows ?? await sb.fetchPlayersByIds(ids);
  const byId = new Map(rows.map(r => [Number(r.id ?? r.playerId), r]));
  const players = [];
  for (const id of ids) {
    const player = byId.get(id);
    if (!player)
      return { ok: false, msg: `playerId ${id} 不存在，请先调用 Client_CreateTagPlatform` };
    if (!player.ownerUserId)
      return { ok: false, msg: `playerId ${id} 未完成归属迁移，拒绝操作` };
    if (player.ownerUserId !== String(userId))
      return { ok: false, msg: `playerId ${id} 不属于当前用户` };
    players.push({
      id: Number(player.id ?? player.playerId),
      ownerUserId: player.ownerUserId,
      platformId: player.platformId,
      platformName: player.platformName,
      provider: String(player.provider || ""),
      playerName: player.playerName,
      credit: player.credit,
      totalBalance: player.totalBalance,
      createdAt: player.createdAt,
      updatedAt: player.updatedAt,
    });
  }
  return { ok: true, players };
}

/** players 行是否为 PredictFun（不看用户可改的 ACCOUNT.provider） */
export function isPredictFunPlayerRow(player) {
  const provider = String(player?.provider ?? "").trim().toLowerCase();
  if (provider === "predictfun")
    return true;
  const name = String(player?.platformName ?? "").trim().toLowerCase();
  return name === "predictfun" || name.includes("predict.fun") || name.includes("predictfun");
}
