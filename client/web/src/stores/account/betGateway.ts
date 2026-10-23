import type { ResolveVenueStakeOpts } from "@changmen/venue-browser/adapter/adaptation";
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "@/stores/account/context";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { getExchange } from "@changmen/shared/currency";
import { resolveVenueStakeFromPlanCny } from "@changmen/venue-browser/adapter/adaptation";
import { attachPolymarketDetectionQuote } from "@/services/polymarketQuotes";
import { attachPredictFunDetectionQuote } from "@/services/predictFunQuotes";
import { publishBettingEvent } from "@/realtime/publishBetting";
import { getProvider } from "@/runtime/providers";
import { createObservationContext, observeOption } from "@/services/orderObservation";
import { observationFailureEvidence } from "@/services/orderObservationEvidence";
import { submissionVenueStatus } from "@/services/venueSettlementEvidence";
import { bettingDetailHtml, bettingNotifyAccountLine } from "@/shared/a8Notify";
import { showBetResultNotification, startBetNotification } from "@/shared/betNotification";
import { playOrderSuccessSound } from "@/shared/orderSound";
import { persistPolymarketMatchedBuyOrder } from "@/stores/account/pmOptimisticOrder";
import { persistPolymarketExecutionReject } from "@/stores/account/pmRejectOrder";
import { useMessageStore } from "@/stores/messageStore";
import { useUserStore } from "@/stores/userStore";
import { getRetainedPmPrivateKey } from "@/security/pmVault/retainedPmSession";
import { applyPmBalanceRejection } from "@/domain/polymarket/pmBalanceRejection";
import { persistPendingPmOrder } from "@/stores/account/pmPendingOrder";
import { capturePmFokPreflightMode, prepareOptimizedFokExecution } from "@changmen/venue-browser/adapter/polymarket";
import { notifyPendingVenueConfirm } from "./pendingVenueConfirmationRunner";
export { pausePendingVenueConfirmations, resumePendingVenueConfirmations } from "./pendingVenueConfirmationRecovery";


export type CheckBettingOpts = ResolveVenueStakeOpts & {
  /** [changmen 扩展] 本次 PM 单腿模式，非 PM provider 忽略。 */
  pmOrderMode?: "FOK" | "GTC";
  /** [changmen 扩展] 仅 PM GTC 人工挂单允许无即时深度；自动套利默认仍检查深度。 */
  pmGtcAllowResting?: boolean;
  requireClobConfirmation?: boolean;
  /** [changmen 扩展] 双腿编排已完成动态 FOK 准备；与 CLOB 状态确认无关。 */
  pmDynamicPrepared?: true;
  role?: "execute" | "precheckOnly";
  /** 场馆额已换过：再预检只验盘口，不改 betMoney（勿用 skipAccountRate，USDT 会二次÷汇率） */
  skipStakeResolve?: boolean;
  /** [changmen 扩展] 体育板/POD 的独立报价不使用电竞 tick 缓冲。默认电竞。 */
  pmQuoteScope?: "esport" | "sport";
};

export interface PlaceBetOpts {
  /** [changmen 扩展] 套利/补单最终 Link；PM api_failed 落库用 */
  linkId?: number;
  /**
   * 套利双腿 POST：禁止在本函数内再预检。
   * 无 data 直接失败，避免 Parallel 时一边 check+bet、另一边还在拉簿。
   */
  requirePreparedQuote?: boolean;
}

async function ensureSharedVaultKeyForAccount(account: PlatformAccount | undefined): Promise<boolean> {
  if (!account || account.provider === "Polymarket")
    return false;
  const {
    accountTokenHasPrivateKey,
    ensurePmVaultUnlocked,
    hasVault,
    isVaultKeyProvider,
    mergeVaultKeysIntoAccounts,
    normalizePmVaultUserId,
  } = await import("@/security/pmVault");
  if (!isVaultKeyProvider(account.provider))
    return true;
  if (accountTokenHasPrivateKey(account.token))
    return true;

  const user = useUserStore();
  if (!user.userId && user.isLoggedIn)
    await user.fetchUserInfo();
  const uid = normalizePmVaultUserId(user.userId);
  if (!uid || !(await hasVault(uid)))
    return false;
  const unlocked = await ensurePmVaultUnlocked(uid);
  if (!unlocked)
    return false;

  const { useAccountStore } = await import("@/stores/accountStore");
  const accountStore = useAccountStore();
  mergeVaultKeysIntoAccounts(accountStore.accounts, uid);
  const shared = account.accountId ? accountStore.findAccount(Number(account.accountId)) : undefined;
  if (shared?.token && accountTokenHasPrivateKey(shared.token))
    account.token = shared.token;
  return accountTokenHasPrivateKey(account.token);
}

export async function checkBetting(
  _store: AccountStoreContext,
  account: PlatformAccount | undefined,
  option: BetOption,
  opts?: CheckBettingOpts,
) {
  try { option.observation ??= createObservationContext(); }
  catch { /* 不可写对象上的旁路元数据不能阻断预检 */ }
  observeOption(option, account, "precheck_started");
  if (!account) {
    option.checkError = `场馆${option.type}没有可用账号`;
    observeOption(option, account, "precheck_result", { outcome: "blocked", reasonCode: "no_account" });
    return option;
  }
  const pm = account.provider === "Polymarket";
  // [changmen 扩展] PM 交易路径只检查会话有效性；解锁与 signer 初始化由账号生命周期完成。
  if (pm) getRetainedPmPrivateKey(account.accountId);
  else await ensureSharedVaultKeyForAccount(account).catch(() => false);
  const provider = getProvider(account);
  if (!provider) {
    option.checkError = `场馆${option.type}不被支持`;
    observeOption(option, account, "precheck_result", { outcome: "blocked", reasonCode: "unsupported_provider" });
    return option;
  }
  let observedPrecheckResult = false;
  let checkedOption = option;
  const observationStartedAt = Date.now();
  let observationError: unknown;
  try {
    // [changmen 扩展] 人工及重试动态 FOK 在冻结报价前准备；双腿已提前准备，不能在此补等。
    if (pm && opts?.pmOrderMode !== "GTC" && opts?.role !== "precheckOnly" && !opts?.pmDynamicPrepared
      && capturePmFokPreflightMode(option) === "optimized") await prepareOptimizedFokExecution(account);
    attachPolymarketDetectionQuote(option, opts?.pmQuoteScope);
    attachPredictFunDetectionQuote(option);
    // [A8 适配] 编排 Plan CNY → 场馆原币（CNY / U / PM）；预检后不改，跌价由各场馆 checkBet 拒单
    if (!opts?.skipStakeResolve) {
      const planBetMoney = pm ? (option.planBetMoney ?? option.betMoney) : option.betMoney;
      const exchange = getExchange(account.currency);
      const venueBetMoney = resolveVenueStakeFromPlanCny(account, planBetMoney, option.odds, opts);
      option.planBetMoney = planBetMoney;
      option.stakeExchange = exchange;
      option.stakeRate = planBetMoney > 0 ? (venueBetMoney * exchange) / planBetMoney : 1;
      option.stakeCurrency = String(account.currency || "CNY");
      option.betMoney = venueBetMoney;
    }
    const checked = pm && opts?.pmOrderMode === "GTC"
      ? await (await import("@changmen/venue-browser/adapter/polymarket/gtc")).checkGtcBuy(account, option, undefined, opts?.pmGtcAllowResting !== true)
      : await provider.checkBet(account, option, { role: opts?.role ?? "execute", ...(opts?.requireClobConfirmation ? { requireClobConfirmation: true } : {}) });
    checkedOption = checked;
    // [changmen 扩展] adapter 返回新对象时只传递观察元数据，原业务返回值不变。
    try { checked.observation ??= option.observation; }
    catch { /* 观察字段写入失败不改变返回值 */ }
    try {
      // [changmen 扩展] 执行层按 data 判定可继续；数据与错误并存只能记录矛盾，不能宣称已拦截。
      const blocked = !checked.data;
      const inconsistent = !blocked && Boolean(checked.checkError);
      observeOption(checked, account, "precheck_result", { outcome: blocked ? "blocked" : inconsistent ? "inconsistent" : "prepared", durationMs: Date.now() - observationStartedAt,
        reasonCode: blocked ? "precheck_error" : inconsistent ? "precheck_inconsistent" : undefined,
        ...(blocked ? observationFailureEvidence(checked.checkError || "无盘口数据", checked.response, undefined, account.provider) : {}),
        ...(inconsistent ? { safeSummary: "预检同时返回盘口数据和错误，不能据此认定已拦截；是否提交请查看提交记录" } : {}) });
    }
    catch { /* 观察快照读取失败不改变 adapter 返回值 */ }
    observedPrecheckResult = true;
    return checked;
  }
  catch (e) {
    observationError = e;
    // [A8 可证实] RAY 预检沿用 account store 的 JSON.stringify(error)，包括盘口缺项异常。
    option.checkError = account.provider === "RAY" ? JSON.stringify(e)
      : e instanceof Error ? e.message : JSON.stringify(e);
    return option;
  }
  finally {
    if (!observedPrecheckResult) {
      try {
        const inconsistent = Boolean(option.data);
        observeOption(option, account, "precheck_result", {
          outcome: inconsistent ? "inconsistent" : "blocked", reasonCode: inconsistent ? "precheck_inconsistent" : "precheck_error", durationMs: Date.now() - observationStartedAt,
          ...(inconsistent ? { safeSummary: "预检抛出异常但仍保留盘口数据，不能据此认定已拦截；是否提交请查看提交记录" }
            : observationFailureEvidence(option.checkError, undefined, observationError)),
        });
      }
      catch { /* 旁路证据读取失败不阻断预检收尾 */ }
    }
    try { checkedOption.saveLog(account); }
    catch { /* 预检日志失败不能改变冻结盘口或阻断原单发送。 */ }
  }
}

export async function placeBet(
  store: AccountStoreContext,
  account: PlatformAccount | undefined,
  option: BetOption,
  toastSeconds = 10,
  opts?: PlaceBetOpts,
) {
  try {
    option.observation ??= createObservationContext();
    if (opts?.linkId)
      option.diagnosticLinkId = opts.linkId;
  }
  catch { /* 不可写对象上的旁路元数据不能阻断提交 */ }
  if (!account) {
    observeOption(option, account, "submission_result", { outcome: "not_submitted", reasonCode: "no_account" });
    return new BetResult(option.type, false, "无可用账号");
  }
  // [changmen 扩展] 冻结预检已完成钱包准备，首腿成功后不再重启解锁链路。
  if (account.provider !== "Polymarket" && !opts?.requirePreparedQuote) await ensureSharedVaultKeyForAccount(account);
  const provider = getProvider(account);
  if (!provider) {
    observeOption(option, account, "submission_result", { outcome: "not_submitted", reasonCode: "unsupported_provider" });
    return new BetResult(option.type, false, "平台不支持");
  }

  let accountLine = "", detailHtml = "";
  try {
    const platformLabel = store.getPlatformName(account.platformId, account.platformName);
    accountLine = bettingNotifyAccountLine(account, platformLabel);
    detailHtml = bettingDetailHtml({
      matchTitle: option.match?.title,
      betName: option.bet?.getBetName(),
      target: option.target,
      itemOdds: option.item?.getOdds(option.target),
      betMoney: option.betMoney,
      odds: option.odds,
      betCount: option.betCount,
    });
  }
  catch { /* 展示数据读取失败不能阻断已经预检的场馆发送。 */ }

  const notificationDisplay = { provider: account.provider, accountLine, detailHtml };
  const loading = startBetNotification(notificationDisplay);

  const beginTime = Date.now();
  let result: BetResult = new BetResult(account.provider, false, "未知错误");
  let observationSubmitted = false;
  let observationThrew = false;
  let observationCallAt: number | undefined;
  let observationDuration: number | undefined;
  let observationError: unknown;
  let pendingOrderSave: Promise<void> | undefined;
  try {
    if (!option.data) {
      if (opts?.requirePreparedQuote || account.provider === "Polymarket") {
        result = new BetResult(option.type, false, option.checkError || "预检未通过");
      }
      else {
        option = await checkBetting(store, account, option);
        if (!option.data)
          result = new BetResult(option.type, false, option.checkError || "预检失败");
      }
    }
    if (option.data) {
      try { observeOption(option, account, "submission_started", { source: "adapter_call" }); }
      catch { /* 观察失败不阻断已预检的场馆发送。 */ }
      observationSubmitted = true;
      observationCallAt = Date.now();
      result = await provider.betting(account, option);
      observationDuration = Date.now() - observationCallAt;
      // [changmen 扩展] 先发布场馆余额事实，再异步补刷；A8 的余额筛选和账号轮换保持原样。
      if (account.provider === "Polymarket" && applyPmBalanceRejection(account, result))
        void import("@/stores/account/balanceRefresh")
          .then(({ refreshAccountBalance }) => refreshAccountBalance(store, account, { afterPmBalanceRejection: true }))
          .catch(() => {});
      if (account.provider === "Polymarket" && result.pending) {
        pendingOrderSave = persistPendingPmOrder(account, option, result);
        void pendingOrderSave.catch(error => { console.warn("[Polymarket] 待确认订单保存失败", error); });
        // 收到场馆回执即可继续；完整订单保存与官方确认并行，终态写入等待该保存。
      }
      // PM matched：官方 POST 成交即真相，立刻落库，勿干等 /data/trades
      if (result.success && !result.pending && account.provider === "Polymarket") {
        try {
          const saved = await persistPolymarketMatchedBuyOrder(account, option, result);
          observeOption(option, account, "bind_result", { orderId: result.orderId || undefined, outcome: saved ? "saved" : "unknown", source: "pm_optimistic_persist" });
          // 供手动/正EV：乐观落库失败时回退 waitForOrderId
          if (saved)
            result.tip = { pmOptimisticSaved: true };
        }
        catch {
          observeOption(option, account, "bind_result", { orderId: result.orderId || undefined, outcome: "failed", source: "pm_optimistic_persist" });
          /* 乐观落库失败不阻断下单成功；后续 Io.f / updateVenueOrders 仍可补 */
        }
      }
      // PM 已 POST 未成交（含无官方 orderId）：落库 Reject，供拒单率统计
      else if (!result.success && !result.pmSubmitUnknown && account.provider === "Polymarket") {
        try {
          if (Number(beginTime) > 0)
            result.beginTime = beginTime;
          await persistPolymarketExecutionReject(account, result, "api_failed", {
            betOption: option,
            linkId: opts?.linkId,
          });
        }
        catch {
          /* 拒单落库失败不阻断下单结果回传 */
        }
      }
    }
  }
  catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    observationThrew = true;
    observationError = e;
    if (observationCallAt !== undefined)
      observationDuration = Date.now() - observationCallAt;
    const message = raw.includes("Failed to fetch dynamically imported module")
      ? "页面资源已过期（服务端刚发版），请刷新页面后重试"
      : raw;
    result = new BetResult(
      account.provider,
      false,
      message,
      option.data,
    );
    // POST 前抛错 / 页面过期：不落拒单（无 pmPosted）
  }
  finally {
    result.link = result.pmSubmitUnknown && result.link > 0 ? result.link : Number(opts?.linkId || option.diagnosticLinkId) || 0;
    result.diagnosticAttempt = option.diagnosticAttempt;
    try {
      result.observation = option.observation;
      observeOption(option, account, "submission_result", {
        orderId: result.orderId || undefined,
        outcome: result.pmSubmitUnknown || observationThrew && observationSubmitted ? "unknown" : result.success ? "accepted" : observationSubmitted ? "adapter_failed" : "not_submitted",
        source: "adapter_result",
        observedStatus: submissionVenueStatus(result),
        durationMs: observationDuration,
        ...(!result.success ? observationFailureEvidence(result.message, result.response, observationError, result.provider) : {}),
      });
    }
    catch { /* 旁路写入或快照错误不能改变已取得的下注结果 */ }
    loading.close();
    const notifyType = result.pending ? "warning" : result.success ? "success" : "error";
    const statusSuffix = result.pending ? "确认中" : "";
    showBetResultNotification(notificationDisplay, {
      messageHtml: `<p>${result.message || ""}</p>`,
      statusSuffix,
      type: notifyType,
    }, toastSeconds);
    try { useMessageStore().delayMessage(account, Date.now() - beginTime); }
    catch { /* 延迟统计失败不改变已取得的场馆回执。 */ }
    try { result.saveLog(account, beginTime); }
    catch { /* 日志失败不丢弃真实回执或触发重复下单。 */ }
    if (result.success && !result.pending) {
      try { void playOrderSuccessSound({ betRowId: option.betId }).catch(() => {}); }
      catch { /* 成功音效失败不改变成交结果。 */ }
      try { void publishBettingEvent(option).catch(() => {}); }
      catch { /* 广播失败不改变成交结果。 */ }
    }
    if (
      result.pending
      && !option.loseOrder
      && isPendingConfirmVenueProvider(account.provider)
      && !option.deferPostAcceptSettlement
    ) {
      notifyPendingVenueConfirm(
        store,
        account,
        accountLine,
        detailHtml,
        result,
        option,
        toastSeconds,
        pendingOrderSave,
      );
    }
  }
  return result;
}
