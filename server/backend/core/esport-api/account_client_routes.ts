/**
 * 账号/订单/流水等 Client_* 分发。由 router.handle 委托；行为与拆出前一致。
 * 勿 import router 运行时符号，以免 ESM 环。
 */
import * as accountService from "../account/account_service.js";
import * as accountStore from "../account/account_store.js";
import { getMonthReport } from "../account/report_service.js";
import * as dbStore from "../db/store.js";
import { getOrders, saveOrders } from "../orderModes/router.js";

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

interface AccountCtx { user: EsportUser | null }

/** GetData 偶发直接返回 JSON 数组/对象（非 envelope） */
type AccountActionResult = ApiEnvelope | unknown[] | Record<string, unknown>;

const ACCOUNT_CLIENT_ACTIONS = new Set([
  "Client_SaveData",
  "Client_SaveSportAccount",
  "Client_GetAccounts",
  "Client_SaveAccounts",
  "Client_GetData",
  "Client_GetUserDetail",
  "Client_GetOrderList",
  "Client_SaveOrder",
  "Client_SaveOrderBind",
  "Client_RebindOrderLink",
  "Client_SaveMoneyLog",
  "Client_DeleteMoneyLog",
  "Client_DeletePlayer",
  "Client_UpdateBalance",
  "Client_RefreshAccountBalance",
  "Client_GetMoneyLogs",
  "Client_GetMoneyLog",
  "Client_MonthReport",
  "Client_GetUserProfit",
  "Client_CreateTagPlatform",
  "Client_GetTagPlatforms",
  "Client_GetPlayerOrder",
  "Client_GetUsers",
  "Client_GetChatHistory",
  "Client_SaveUserLog",
]);

function ok<T>(info: T, msg = "ok"): ApiEnvelope<T> {
  return { success: 1, msg, info: info ?? null };
}

function fail(msg: string, info = null): ApiEnvelope {
  return { success: 0, msg, info };
}

export function isAccountClientAction(action: string): boolean {
  return ACCOUNT_CLIENT_ACTIONS.has(String(action));
}

/**
 * @returns 命中账号域则返回结果；否则 null（调用方继续 switch）
 */
export async function handleAccountClientAction(
  action: string,
  body: Record<string, unknown>,
  ctx: AccountCtx,
): Promise<AccountActionResult | null> {
  if (!isAccountClientAction(action))
    return null;

  switch (action) {
    case "Client_SaveData": {
      if (!body.key)
        return fail("key required");
      const saved = await accountService.handleSaveData(body.key, body.content ?? "", ctx.user!.id);
      return saved.ok ? ok(saved.info) : fail(saved.msg);
    }
    case "Client_SaveSportAccount": {
      const saved = await accountService.handleSaveSportAccount(body, ctx.user!.id);
      return saved.ok ? ok(saved.info) : fail(saved.msg);
    }
    case "Client_GetAccounts":
      return ok(await dbStore.refreshAccountsFromRdsIfEmpty(ctx.user!.id));
    case "Client_SaveAccounts": {
      let accounts: unknown[] = [];
      try { accounts = JSON.parse((body.accounts as string) || "[]"); }
      catch { return fail("accounts JSON ??"); }
      const saved = await accountService.handleSaveAccounts(accounts, ctx.user!.id);
      return saved.ok ? ok(saved.info) : fail(saved.msg);
    }
    case "Client_GetData": {
      // ACCOUNT 唯一真相是 players：每次 GetData 从 RDS 回源，避免内存缓存缺行误伤保存
      if (body.key === "ACCOUNT" && ctx.user?.id) {
        await dbStore.loadAccountsForUser(ctx.user.id);
      }
      const data = accountService.handleGetData(body.key, ctx.user!.id);
      // ACCOUNT/PROXY 等 key 可能直接返回 JSON，非 ok() 包装
      if (Array.isArray(data.direct))
        return data.direct as unknown[];
      if (data.direct && typeof data.direct === "object")
        return data.direct as Record<string, unknown>;
      return ok(data.info);
    }
    case "Client_GetUserDetail":
      return ok({ Id: ctx.user!.id });
    case "Client_GetOrderList": {
      const page = await getOrders(body, ctx.user!.id);
      return page.ok ? ok(page.info) : fail(page.msg);
    }
    case "Client_SaveOrder": {
      const saved = await saveOrders(body, ctx.user!.id);
      return saved.ok ? ok(saved.info) : fail(saved.msg);
    }
    case "Client_SaveOrderBind": {
      const saved = await accountService.handleSaveOrderBind(body, ctx.user!.id);
      return saved.ok ? ok(saved.info) : fail(saved.msg);
    }
    case "Client_RebindOrderLink": {
      const rebound = await accountService.handleRebindOrderLink(body, ctx.user!.id);
      return rebound.ok ? ok(rebound.info) : fail(rebound.msg);
    }
    case "Client_SaveMoneyLog": {
      const saved = await accountService.handleSaveMoneyLog(body, ctx.user!.id);
      return saved.ok ? ok(saved.info) : fail(saved.msg);
    }
    case "Client_DeleteMoneyLog": {
      const deleted = await accountService.handleDeleteMoneyLog(body, ctx.user!.id);
      return deleted.ok ? ok(deleted.info) : fail(deleted.msg);
    }
    case "Client_DeletePlayer": {
      const deleted = await accountService.handleDeletePlayer(body, ctx.user!.id);
      return deleted.ok ? ok(deleted.info) : fail(deleted.msg);
    }
    case "Client_UpdateBalance": {
      const updated = await accountService.handleUpdateBalance(body, ctx.user!.id);
      return updated.ok ? ok(updated.info) : fail(updated.msg);
    }
    case "Client_RefreshAccountBalance":
      return fail("已废弃：PM 余额请用 Pm_RefreshBalance");
    case "Client_GetMoneyLogs": {
      const page = await accountService.handleGetMoneyLogs(body, ctx.user!.id);
      return page.ok ? ok(page.info) : fail(page.msg);
    }
    case "Client_GetMoneyLog": {
      const row = await accountService.handleGetMoneyLog(body, ctx.user!.id);
      return row.ok ? ok(row.info) : fail(row.msg);
    }
    case "Client_MonthReport":
      return ok(await getMonthReport(body.month, ctx.user!.id));
    case "Client_GetUserProfit": {
      const profit = await accountService.handleGetUserProfit();
      return profit.ok ? ok(profit.info) : fail(profit.msg || "操作失败");
    }
    case "Client_CreateTagPlatform": {
      await accountStore.ensureSeed();
      const created = await accountService.handleCreateTagPlatform(body, ctx.user?.id ?? "");
      return created.ok ? ok(created.info) : fail(created.msg);
    }
    case "Client_GetTagPlatforms": {
      await accountStore.ensureSeed();
      const tags = await accountService.handleGetTagPlatforms();
      return ok(tags.info);
    }
    case "Client_GetPlayerOrder": {
      const orders = await accountService.handleGetPlayerOrder(body, ctx.user!.id);
      return orders.ok ? ok(orders.info) : fail(orders.msg);
    }
    case "Client_GetUsers": {
      const users = accountService.handleGetUsers();
      return ok(users.info);
    }
    case "Client_GetChatHistory":
      return ok([]);
    case "Client_SaveUserLog": {
      const saved = await accountService.handleSaveUserLog(body, ctx.user?.id ?? "");
      return saved.ok ? ok(saved.info) : fail(saved.msg);
    }
    default:
      return fail(`未知账号端 action: ${action}`);
  }
}
