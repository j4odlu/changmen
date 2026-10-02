/**
 * 管理端 Client_Admin* 分发。由 router.handle 委托；行为与拆出前一致。
 * 勿从本文件 import router 的运行时符号，以免 ESM 环。
 */
import * as adminService from "../account/admin_service.js";
import { getAdminLeaderboardUsers, setAdminLeaderboardExcluded } from "../account/admin_leaderboard.js";
import { getMonthReport } from "../account/report_service.js";
import { getAdminMonthReportScope } from "../auth/role_filter.js";

interface ApiSuccess<T = unknown> {
  success: 1;
  msg: string;
  info: T | null;
}

interface ApiFailure {
  success: 0;
  msg: string;
  info: null;
}

type ApiEnvelope<T = unknown> = ApiSuccess<T> | ApiFailure;

interface EsportUser {
  id: string;
  userName: string;
  isAdmin?: boolean;
  role?: string;
  teamId?: string | null;
  setting?: Record<string, unknown>;
}

type AdminCtx = { user: EsportUser };

function ok<T>(info: T, msg = "ok"): ApiEnvelope<T> {
  return { success: 1, msg, info: info ?? null };
}

function fail(msg: string, info = null): ApiEnvelope {
  return { success: 0, msg, info };
}

export function isAdminAction(action: string): boolean {
  return String(action).startsWith("Client_Admin");
}

/**
 * @returns Admin action 的 ApiEnvelope；非 Admin action 返回 null（调用方继续 switch）
 */
export async function handleAdminAction(
  action: string,
  body: Record<string, unknown>,
  ctx: AdminCtx,
): Promise<ApiEnvelope | null> {
  if (!isAdminAction(action))
    return null;

  switch (action) {
    case "Client_AdminDashboard": {
      const date = body.date ? String(body.date) : undefined;
      return ok(await adminService.getAdminDashboard(date, ctx.user));
    }
    case "Client_AdminUsers": {
      const date = body.date ? String(body.date) : undefined;
      return ok(await adminService.listAdminUsers(date, ctx.user));
    }
    case "Client_AdminUserConfigDetail": {
      try {
        return ok(
          await adminService.getAdminUserConfigDetail(
            (body.userId ?? body.id) as string,
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "查询失败");
      }
    }
    case "Client_AdminOrders": {
      return ok(await adminService.listAdminOrders(body, ctx.user));
    }
    case "Client_AdminOrdersMatrix": {
      return ok(await adminService.listAdminOrdersMatrix(body, ctx.user));
    }
    case "Client_AdminFootballOrders": {
      try {
        const { listAdminFootballOrders } = await import("../football/football_order_service.js");
        return ok(await listAdminFootballOrders(body));
      }
      catch (err) {
        return fail((err as Error).message || "查询失败");
      }
    }
    case "Client_AdminDeleteFootballOrders": {
      try {
        const { deleteAdminFootballOrders } = await import("../football/football_order_service.js");
        return ok(await deleteAdminFootballOrders(body));
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminFootballMonthReport": {
      const scoped = await getAdminMonthReportScope(ctx.user, {
        userId: body.userId ?? body.user_id,
        teamId: body.teamId ?? body.team_id,
      }) as { error?: string; userId?: string; userIds?: string[] };
      if (scoped.error)
        return fail(scoped.error);
      try {
        const { getFootballMonthReport } = await import("../football/football_month_report.js");
        return ok(
          await getFootballMonthReport(
            body.month ? String(body.month) : undefined,
            scoped.userId,
            scoped.userIds,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "查询失败");
      }
    }
    case "Client_AdminOrderLogs": {
      try {
        return ok(await adminService.listAdminOrderLogs(body, ctx.user));
      }
      catch (err) {
        return fail((err as Error).message || "查询失败");
      }
    }
    case "Client_AdminCreateUser": {
      try {
        return ok(
          await adminService.createAdminUser(
            (body.userName ?? body.username) as string,
            body.password as string,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminResetPassword": {
      try {
        return ok(
          await adminService.resetAdminUserPassword(
            (body.userId ?? body.id) as string,
            body.password as string,
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminRenameUser": {
      try {
        return ok(
          await adminService.renameAdminUser(
            (body.userId ?? body.id) as string,
            (body.userName ?? body.username) as string,
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminSetUserAdmin": {
      try {
        const isAdmin
          = body.isAdmin === true || body.isAdmin === 1 || body.isAdmin === "1";
        return ok(
          await adminService.setAdminUserAdmin(
            (body.userId ?? body.id) as string,
            isAdmin,
            ctx.user.id,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminSetUserRole": {
      try {
        return ok(
          await adminService.setAdminUserRole(
            (body.userId ?? body.id) as string,
            body.role as string,
            (body.teamId ?? null) as string | null,
            ctx.user.id,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "设置失败");
      }
    }
    case "Client_AdminTeams": {
      return ok(await adminService.listTeams());
    }
    case "Client_AdminUpsertTeam": {
      try {
        return ok(await adminService.upsertTeam(body.id as string, body.name as string));
      }
      catch (err) {
        return fail((err as Error).message || "保存团队失败");
      }
    }
    case "Client_AdminDeleteTeam": {
      try {
        return ok(await adminService.deleteTeam((body.id ?? body.teamId) as string));
      }
      catch (err) {
        return fail((err as Error).message || "删除团队失败");
      }
    }
    case "Client_AdminDeleteUser": {
      try {
        return ok(
          await adminService.deleteAdminUser(
            (body.userId ?? body.id) as string,
            ctx.user.id,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "删除用户失败");
      }
    }
    case "Client_AdminDeleteOrders": {
      try {
        return ok(await adminService.deleteAdminOrders(body, ctx.user));
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminMonthReport": {
      const scoped = await getAdminMonthReportScope(ctx.user, {
        userId: body.userId ?? body.user_id,
        teamId: body.teamId ?? body.team_id,
      }) as { error?: string; userId?: string; userIds?: string[] };
      if (scoped.error)
        return fail(scoped.error);
      return ok(
        await getMonthReport(
          body.month ? String(body.month) : undefined,
          scoped.userId,
          scoped.userIds,
        ),
      );
    }
    case "Client_AdminPlatformAnalytics": {
      return ok(await adminService.getPlatformAnalytics(body, ctx.user));
    }
    case "Client_AdminValueBetAnalytics": {
      return ok(await adminService.getValueBetOrderAnalytics(body, ctx.user));
    }
    case "Client_AdminPolymarketBuilder": {
      return ok(await adminService.getPolymarketBuilderDashboard(body, ctx.user));
    }
    case "Client_AdminValueBet": {
      const { getValueBetDashboard } = await import("./value_bet_service.js");
      return ok(await getValueBetDashboard());
    }
    case "Client_AdminUpdateAccountMultiply": {
      try {
        return ok(
          await adminService.updateAdminAccountMultiply(
            (body.userId ?? body.id) as string,
            Number(body.accountId ?? body.playerId),
            body.multiply,
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminAccounts": {
      try {
        return ok(await adminService.listAdminAccounts(ctx.user));
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminPredictFunMembers": {
      try {
        return ok(await adminService.listAdminPredictFunMembers(ctx.user));
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminGetPredictFunFeeConfig": {
      try {
        return ok(await adminService.getAdminPredictFunFeeConfig(ctx.user));
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminSavePredictFunFeeConfig": {
      try {
        return ok(await adminService.saveAdminPredictFunFeeConfig(body, ctx.user));
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminGetMarketHubRoute": {
      try {
        return ok(adminService.getAdminMarketHubRoute(ctx.user));
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminSaveMarketHubRoute": {
      try {
        return ok(adminService.saveAdminMarketHubRoute(body, ctx.user));
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminEnsurePredictFunHouseAccount": {
      try {
        return ok(
          await adminService.ensurePredictFunHouseAccount(
            (body.userId ?? body.id) as string,
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminPredictFunRecharge": {
      try {
        return ok(
          await adminService.rechargeAdminPredictFunMember(
            (body.userId ?? body.id) as string,
            Number(body.accountId ?? body.playerId),
            body,
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminPredictFunMoneyLogs": {
      try {
        return ok(
          await adminService.listAdminPredictFunMoneyLogs(
            (body.userId ?? body.id) as string,
            Number(body.accountId ?? body.playerId),
            body,
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminPredictFunMemberOrders": {
      try {
        return ok(
          await adminService.listAdminPredictFunMemberOrders(
            (body.userId ?? body.id) as string,
            Number(body.accountId ?? body.playerId),
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminUpdateAccountFields": {
      try {
        return ok(
          await adminService.updateAdminAccountFields(
            (body.userId ?? body.id) as string,
            Number(body.accountId ?? body.playerId),
            (body.patch ?? body) as Record<string, unknown>,
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminUpdateUserBetTarget": {
      try {
        return ok(
          await adminService.updateAdminUserBetTarget(
            (body.userId ?? body.id) as string,
            body.betTarget ?? body.BetTarget,
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminUserTradeAccounts": {
      try {
        return ok(
          await adminService.getAdminUserTradeAccounts(
            (body.userId ?? body.id) as string,
            String(body.provider ?? body.Provider ?? ""),
            ctx.user,
          ),
        );
      }
      catch (err) {
        return fail((err as Error).message || "操作失败");
      }
    }
    case "Client_AdminLeaderboardUsers": {
      try {
        return ok(await getAdminLeaderboardUsers(ctx.user));
      }
      catch (err: any) {
        return fail(err.message || "查询失败");
      }
    }
    case "Client_AdminSetLeaderboardExcluded": {
      try {
        return ok(await setAdminLeaderboardExcluded(body, ctx.user));
      }
      catch (err: any) {
        return fail(err.message || "保存失败");
      }
    }
    case "Client_AdminMaintenance": {
      try {
        return ok(await adminService.getAdminMaintenanceReport());
      }
      catch (err) {
        return fail((err as Error).message || "诊断失败");
      }
    }
    default:
      return fail(`未知管理端 action: ${action}`);
  }
}
