/**
 * Polymarket / PredictFun 语义 action 分发（Pm_* / Pf_*）。
 * 由 router.handle 委托；业务在 integrations/*_client_handlers。
 * 勿 import router 运行时符号，以免 ESM 环。
 */
import { isAdminUser } from "../auth/admin_auth.js";
import { handlePmGetSubmission } from "../integrations/polymarket/submission_handler.js";
import {
  handlePmCancelOrder,
  handlePmGetBook,
  handlePmGetOpenOrders,
  handlePmGetOrder,
  handlePmGetTrades,
  handlePmHeartbeat,
  handlePmHttpRequest,
  handlePmSubmitOrder,
  handleRefreshPmBalance,
} from "../integrations/polymarket/pm_client_handlers.js";
import {
  handlePfCheckBet,
  handlePfGetOrder,
  handlePfGetOrders,
  handlePfHouseRedeemResolved,
  handlePfRecoverStuckOrders,
  handlePfRefreshBalance,
  handlePfSettleOpenOrders,
  handlePfSubmitOrder,
  handlePfSubmitSell,
} from "../integrations/predictfun/pf_client_handlers.js";

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

type PmPfCtx = { user: EsportUser };

function ok<T>(info: T, msg = "ok"): ApiEnvelope<T> {
  return { success: 1, msg, info: info ?? null };
}

function fail(msg: string, info = null): ApiEnvelope {
  return { success: 0, msg, info };
}

export function isPmPfAction(action: string): boolean {
  const a = String(action);
  return a.startsWith("Pm_") || a.startsWith("Pf_");
}

/**
 * @returns 命中 Pm/Pf 则返回 envelope；否则 null
 */
export async function handlePmPfAction(
  action: string,
  body: Record<string, unknown>,
  ctx: PmPfCtx,
): Promise<ApiEnvelope | null> {
  if (!isPmPfAction(action))
    return null;

  switch (action) {
    case "Pm_GetSubmission": {
      const snapshot = await handlePmGetSubmission(body, ctx.user.id);
      return snapshot.ok ? ok(snapshot.info) : fail(snapshot.msg);
    }
    case "Pm_RefreshBalance": {
      const refreshed = await handleRefreshPmBalance(body, ctx.user.id);
      return refreshed.ok ? ok(refreshed.info) : fail(refreshed.msg);
    }
    case "Pm_HttpRequest": {
      const proxied = await handlePmHttpRequest(body, ctx.user.id);
      if (!proxied.ok)
        return fail(proxied.msg);
      const upstream = proxied.info as { status?: number; text?: string } | undefined;
      if (upstream?.status != null && upstream.status >= 400) {
        const snippet = String(upstream.text || "").slice(0, 160) || `HTTP ${upstream.status}`;
        return fail(snippet);
      }
      return ok(upstream);
    }
    case "Pm_SubmitOrder": {
      const submitted = await handlePmSubmitOrder(body, ctx.user.id);
      return submitted.ok ? ok(submitted.info) : fail(submitted.msg);
    }
    case "Pm_CancelOrder": {
      const cancelled = await handlePmCancelOrder(body, ctx.user.id);
      return cancelled.ok ? ok(cancelled.info) : fail(cancelled.msg);
    }
    case "Pm_GetTrades": {
      const trades = await handlePmGetTrades(body, ctx.user.id);
      return trades.ok ? ok(trades.info) : fail(trades.msg);
    }
    case "Pm_GetOrder": {
      const order = await handlePmGetOrder(body, ctx.user.id);
      return order.ok ? ok(order.info) : fail(order.msg);
    }
    case "Pm_GetBook": {
      const book = await handlePmGetBook(body, ctx.user.id);
      return book.ok ? ok(book.info) : fail(book.msg);
    }
    case "Pm_Heartbeat": {
      const heartbeat = await handlePmHeartbeat(body, ctx.user.id);
      return heartbeat.ok ? ok(heartbeat.info) : fail(heartbeat.msg);
    }
    case "Pm_GetOpenOrders": {
      const openOrders = await handlePmGetOpenOrders(body, ctx.user.id);
      return openOrders.ok ? ok(openOrders.info) : fail(openOrders.msg);
    }
    case "Pf_CheckBet": {
      const checked = await handlePfCheckBet(body, ctx.user.id);
      return checked.ok ? ok(checked.info) : fail(checked.msg);
    }
    case "Pf_SubmitOrder": {
      const submittedPf = await handlePfSubmitOrder(body, ctx.user.id);
      return submittedPf.ok ? ok(submittedPf.info) : fail(submittedPf.msg);
    }
    case "Pf_SubmitSell": {
      const soldPf = await handlePfSubmitSell(body, ctx.user.id);
      return soldPf.ok ? ok(soldPf.info) : fail(soldPf.msg);
    }
    case "Pf_RefreshBalance": {
      const pfBal = await handlePfRefreshBalance(body, ctx.user.id);
      return pfBal.ok ? ok(pfBal.info) : fail(pfBal.msg);
    }
    case "Pf_GetOrder": {
      const pfOrder = await handlePfGetOrder(body, ctx.user.id);
      return pfOrder.ok ? ok(pfOrder.info) : fail(pfOrder.msg);
    }
    case "Pf_GetOrders": {
      const pfOrders = await handlePfGetOrders(body, ctx.user.id);
      return pfOrders.ok ? ok(pfOrders.info) : fail(pfOrders.msg);
    }
    case "Pf_SettleOpenOrders": {
      const pfSettle = await handlePfSettleOpenOrders(body, ctx.user.id);
      return pfSettle.ok ? ok(pfSettle.info) : fail(pfSettle.msg);
    }
    case "Pf_HouseRedeemResolved": {
      if (!isAdminUser(ctx.user))
        return fail("需要管理员权限");
      const pfRedeem = await handlePfHouseRedeemResolved(body, ctx.user.id);
      return pfRedeem.ok ? ok(pfRedeem.info) : fail(pfRedeem.msg);
    }
    case "Pf_RecoverStuckOrders": {
      const pfRecover = await handlePfRecoverStuckOrders(body, ctx.user.id);
      return pfRecover.ok ? ok(pfRecover.info) : fail(pfRecover.msg);
    }
    default:
      return fail(`未知预测市场 action: ${action}`);
  }
}
