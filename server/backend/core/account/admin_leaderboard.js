import * as db from "@changmen/db";
import { assertAdmin, isAdminUser } from "../auth/admin_auth.js";
import { isExcludedFromLeaderboard } from "./leaderboard_policy.js";

function toRow(row) {
  return {
    userId: String(row.id),
    userName: String(row.user_name || ""),
    isAdmin: isAdminUser(row),
    excluded: isExcludedFromLeaderboard(row),
  };
}

/** [changmen 扩展] 仅管理员可查询和修改全局排行榜排除策略。 */
export async function getAdminLeaderboardUsers(caller) {
  assertAdmin(caller);
  return (await db.fetchLeaderboardUsers()).map(toRow);
}

export async function setAdminLeaderboardExcluded(body, caller) {
  assertAdmin(caller);
  if (typeof body.userId !== "string" || !body.userId.trim())
    throw new Error("请选择用户");
  // post() 使用 form 编码，布尔值会以字符串到达服务端。
  if (![true, false, "true", "false", 1, 0, "1", "0"].includes(body.excluded))
    throw new Error("排除状态必须为布尔值");
  const excluded = [true, "true", 1, "1"].includes(body.excluded);
  return toRow(await db.setUserLeaderboardExcluded(body.userId.trim(), excluded));
}
