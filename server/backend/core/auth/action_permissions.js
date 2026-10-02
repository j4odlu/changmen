import { canAccessAdminPanel, isAdminUser } from "./admin_auth.js";

const PUBLIC_ACTIONS = new Set([
  "Client_Logout",
  "Client_RefreshToken",
  "Client_SaveUserLog",
]);

const ADMIN_ONLY_ACTIONS = new Set([
  "Client_AdminLeaderboardUsers",
  "Client_AdminSetLeaderboardExcluded",
  "Client_AdminCreateUser",
  "Client_AdminSetUserAdmin",
  "Client_AdminSetUserRole",
  "Client_AdminDeleteUser",
  "Client_AdminDeleteOrders",
  "Client_AdminDeleteFootballOrders",
  "Client_AdminUpsertTeam",
  "Client_AdminDeleteTeam",
  "Client_AdminPolymarketBuilder",
  "Client_AdminAccounts",
  "Client_AdminPredictFunMembers",
  "Client_AdminGetPredictFunFeeConfig",
  "Client_AdminSavePredictFunFeeConfig",
  "Client_AdminGetMarketHubRoute",
  "Client_AdminSaveMarketHubRoute",
  "Client_AdminEnsurePredictFunHouseAccount",
  "Client_AdminPredictFunRecharge",
  "Client_AdminPredictFunMoneyLogs",
  "Client_AdminPredictFunMemberOrders",
  "Client_AdminUpdateAccountFields",
  "Client_AdminMaintenance",
]);

const LEADER_ALLOWED_ACTIONS = new Set([
  "Client_AdminDashboard",
  "Client_AdminUsers",
  "Client_AdminOrders",
  "Client_AdminOrdersMatrix",
  "Client_AdminFootballOrders",
  "Client_AdminFootballMonthReport",
  "Client_AdminOrderLogs",
  "Client_AdminResetPassword",
  "Client_AdminRenameUser",
  "Client_AdminMonthReport",
  "Client_AdminTeams",
  "Client_AdminPlatformAnalytics",
  "Client_AdminValueBet",
  "Client_AdminUpdateAccountMultiply",
  "Client_AdminUpdateUserBetTarget",
  "Client_AdminUserTradeAccounts",
]);

/**
 * @returns {{ success: 0, msg: string } | null} 返回 null 表示通过
 */
export function checkActionAuth(action, user) {
  if (PUBLIC_ACTIONS.has(action))
    return null;
  if (!user)
    return { success: 0, code: "AUTH_REQUIRED", msg: "未登录", info: null };
  if (ADMIN_ONLY_ACTIONS.has(action) && !isAdminUser(user)) {
    return { success: 0, msg: "无管理员权限", info: null };
  }
  if (LEADER_ALLOWED_ACTIONS.has(action) && !canAccessAdminPanel(user)) {
    return { success: 0, msg: "无管理权限", info: null };
  }
  return null;
}

export { ADMIN_ONLY_ACTIONS, LEADER_ALLOWED_ACTIONS, PUBLIC_ACTIONS };
