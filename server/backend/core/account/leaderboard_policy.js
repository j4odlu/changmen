import { isAdminUser } from "../auth/admin_auth.js";

/** [changmen 扩展] 显式配置优先；未配置时管理员默认排除，其他用户默认参与。 */
export function isExcludedFromLeaderboard(profile) {
  return typeof profile.leaderboard_excluded === "boolean"
    ? profile.leaderboard_excluded
    : isAdminUser(profile);
}
