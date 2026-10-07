import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { VenueLegSettlement, VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { saveUserLog } from "@/api/chat";
import { useAccountStore } from "@/stores/accountStore";
import { observeOption } from "./orderObservation";
import { rayRejectFailureEvidence } from "./orderObservationEvidence";
import { settlementEvidenceOrder, submissionVenueStatus } from "./venueSettlementEvidence";

function accountPlatformLabel(account: PlatformAccount): string {
  try {
    const store = useAccountStore();
    if (typeof store.getPlatformName === "function") {
      return store.getPlatformName(
        account.platformId,
        account.platformName,
      );
    }
  }
  catch {
    /* 诊断日志不能影响下注主链路 */
  }
  return account.platformName || account.provider;
}

/** [A8 可证实] bundle `Ap.saveLog` */
export function saveBetOptionLog(option: BetOption, account: PlatformAccount): void {
  const platformLabel = accountPlatformLabel(account);
  const title = `[${option.type}](${platformLabel},${account.playerName}) 请求盘口数据 => ${!!option.data} / 耗时${Date.now() - option.startTime}ms / ${option.odds}:${option.newOdds || "N/A"}`;
  void saveUserLog(title, {
    options: {
      type: option.type,
      match: option.match?.title,
      matchId: option.matchId,
      bet: option.bet?.getBetName(),
      betId: option.betId,
      target: option.target,
      itemId: option.itemId,
      odds: option.odds,
      newOdds: option.newOdds,
      betMoney: option.betMoney,
      planBetMoney: option.planBetMoney,
      stakeExchange: option.stakeExchange,
      stakeRate: option.stakeRate,
      stakeCurrency: option.stakeCurrency,
      linkId: option.diagnosticLinkId,
      attemptType: option.diagnosticAttempt,
      betCount: option.betCount,
      config: option.config,
      loseOrder: option.loseOrder,
    },
    checkError: option.checkError,
    response: option.response,
    request: option.request,
    data: option.data,
  });
}

/** [A8 可证实] bundle `uo.saveLog` */
export function saveBetResultLog(result: BetResult, account: PlatformAccount): void {
  const platformLabel = accountPlatformLabel(account);
  const title = `[${result.provider}](${platformLabel},${account.playerName}) 下注 => ${result.success} / 耗时:${Date.now() - result.beginTime}ms`;
  void saveUserLog(title, { accountId: account.accountId, result });
}

function settlementRejectReason(result: BetResult): string | null {
  const reject = result.reject;
  if (typeof reject === "string" && reject.trim() && reject !== "timeout")
    return reject.trim();
  if (reject && typeof reject === "object") {
    const row = reject as Record<string, unknown>;
    const reason = row.reason ?? row.message ?? row.error;
    if (reason != null && String(reason).trim())
      return String(reason).trim();
  }
  return null;
}

/**
 * [changmen 扩展] 记录 POST 受理后的场馆终态，供管理端准确区分即时失败与事后拒单。
 * 仅写诊断日志，不参与下注、补单或订单状态判断。
 */
export function saveVenueSettlementLog(params: {
  account: PlatformAccount;
  option: BetOption;
  result: BetResult;
  orders: VenueOrder[];
  settlement: VenueLegSettlement;
  linkId?: number;
}): void {
  // 任一日志字段异常都必须被隔离，不能改变下注/补单结果。
  try {
    const { account, option, result, orders, settlement, linkId } = params;
    let reason: string | undefined;
    try {
      const evidenceOrder = settlementEvidenceOrder(option, result, orders);
      const status = submissionVenueStatus(result);
      const mode = account.provider !== "Polymarket" || status === "delayed" || result.pmSubmitUnknown ? "reject_detection"
        : status === "matched" ? "direct_fill" : "confirmation";
      reason = evidenceOrder?.venueRejectReason;
      const reasonEvidence = settlement === "unfilled" && account.provider === "RAY" && reason
        ? rayRejectFailureEvidence(reason) : {};
      observeOption(option, account, "settlement_observed", {
        orderId: evidenceOrder?.orderId || result.orderId || undefined,
        outcome: settlement,
        source: settlement === "unfilled" && String(result.message).includes("超时策略判拒") ? "timeout_policy" : evidenceOrder ? "adapter" : "orchestration_result",
        phase: mode,
        observedStatus: evidenceOrder?.status,
        ...reasonEvidence,
      });
    }
    catch { /* 新观察异常不能跳过原有日志 */ }
    const exactOrderId = String(result.orderId ?? "").trim();
    const observedOrder = exactOrderId
      ? orders.find(order => String(order.orderId) === exactOrderId)
      : orders[0] ?? null;
    const orderId = String(observedOrder?.orderId ?? exactOrderId).trim() || null;
    const observedAt = Date.now();
    const placedAt = Number(observedOrder?.createAt || result.beginTime) || null;
    const rejectDelayMs = placedAt == null ? null : Math.max(0, observedAt - placedAt);
    const policyRejected = settlement === "unfilled" && String(result.message).includes("超时策略判拒");
    const stateLabel = settlement === "unfilled"
      ? policyRejected ? "超时策略判拒" : "确认拒单"
      : settlement === "timeout"
        ? "仍待确认"
        : "确认成交";
    const platformLabel = accountPlatformLabel(account);

    void saveUserLog(
      // [changmen 扩展] 保留管理端按“拒单”识别的历史日志格式；实时阶段由观察事件区分。
      `[${account.provider}](${platformLabel},${account.playerName}) 拒单检测 => ${stateLabel}`,
      {
        diagnosticVersion: 2,
        provider: account.provider,
        accountId: account.accountId,
        linkId: Number(linkId) || null,
        orderId,
        target: option.target,
        match: option.match?.title ?? null,
        bet: option.bet?.getBetName() ?? null,
        odds: option.newOdds || option.odds,
        betMoney: option.betMoney,
        planBetMoney: option.planBetMoney,
        stakeExchange: option.stakeExchange,
        stakeRate: option.stakeRate,
        stakeCurrency: option.stakeCurrency,
        attemptType: option.diagnosticAttempt,
        loseOrder: option.loseOrder,
        placedAt,
        observedAt,
        rejectDelayMs,
        settlement,
        settlementMessage: result.message,
        decisionBasis: policyRejected ? "timeout_policy" : null,
        observedStatus: observedOrder?.status ?? (orders.length ? "unknown" : "missing"),
        rejectReason: settlement === "unfilled" ? reason || settlementRejectReason(result) : null,
      },
    ).catch(() => {});
  }
  catch {
    /* 诊断日志不能影响下注、拒单判断或补单 */
  }
}

/** [changmen 扩展] 补单只入队但尚未真正下单，也要在诊断中留下证据。 */
export function saveMakeUpQueueLog(params: {
  linkId: number;
  target: string;
  match: string;
  bet: string;
  anchorBetMoney: number;
  anchorOdds: number;
  failedLegOdds: number;
  failedPlatformLabel: string;
}): void {
  try {
    void saveUserLog("补单入队", {
      diagnosticVersion: 2,
      attemptType: "makeup_queue",
      linkId: params.linkId,
      target: params.target,
      match: params.match,
      bet: params.bet,
      betMoney: params.anchorBetMoney,
      odds: params.anchorOdds,
      failedLegOdds: params.failedLegOdds,
      failedPlatformLabel: params.failedPlatformLabel,
      observedAt: Date.now(),
    }).catch(() => {});
  }
  catch {
    /* 诊断日志不能影响补单入队 */
  }
}

/** [changmen 扩展] 自动补单因锚腿确认拒单而撤销，持久化供管理端还原队列终态。 */
export function saveMakeUpCancelLog(params: {
  linkId: number;
  betId: number;
  target: string;
  match: string;
  bet: string;
  failedPlatformLabel: string;
  anchorProvider: string;
  anchorAccountId: number;
  anchorTarget: string;
  reason: string;
}): void {
  try {
    void saveUserLog("补单取消", {
      diagnosticVersion: 2,
      attemptType: "makeup_cancel",
      linkId: params.linkId,
      betId: params.betId,
      target: params.target,
      match: params.match,
      bet: params.bet,
      failedPlatformLabel: params.failedPlatformLabel,
      anchorProvider: params.anchorProvider,
      anchorAccountId: params.anchorAccountId,
      anchorTarget: params.anchorTarget,
      reason: params.reason,
      observedAt: Date.now(),
    }).catch(() => {});
  }
  catch {
    /* 诊断日志不能影响补单撤销 */
  }
}
