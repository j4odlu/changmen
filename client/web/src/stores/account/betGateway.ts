import type { ObservationContext } from "@changmen/shared/order_observation";
import type { ResolveVenueStakeOpts } from "@changmen/venue-adapter/adaptation";
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "@/stores/account/context";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { getExchange } from "@changmen/shared/currency";
import { resolveVenueStakeFromPlanCny } from "@changmen/venue-adapter/adaptation";
import { ElNotification } from "element-plus";
import { attachPolymarketDetectionQuote } from "@/domain/polymarket/attachDetectionQuote";
import { attachPredictFunDetectionQuote } from "@/domain/predictfun/attachDetectionQuote";
import { publishBettingEvent } from "@/realtime/publishBetting";
import { getProvider } from "@/runtime/providers";
import { createObservationContext, observeOption } from "@/services/orderObservation";
import { observationFailureEvidence } from "@/services/orderObservationEvidence";
import { submissionVenueStatus } from "@/services/venueSettlementEvidence";
import {
  bettingDetailHtml,
  bettingLoadingMessageHtml,
  bettingNotifyAccountLine,
  bettingResultMessageHtml,
} from "@/shared/a8Notify";
import { playOrderSuccessSound } from "@/shared/orderSound";
import { persistPolymarketMatchedBuyOrder } from "@/stores/account/pmOptimisticOrder";
import { persistPolymarketExecutionReject } from "@/stores/account/pmRejectOrder";
import { settleArbLegUntilTerminal } from "@/stores/betting/autoBet/arbLegSettle";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";
import { useMessageStore } from "@/stores/messageStore";
import { useUserStore } from "@/stores/userStore";
import { pmSubmissionFromResult, validatePmSubmission, type PmSubmission } from "@changmen/shared/pm_submission";
import { pmAccountSubmitAttempts, pmSubmitScope, pmSubmitMaker } from "@changmen/venue-adapter/polymarket";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { getPmSubmission } from "@/api/order";

export type CheckBettingOpts = ResolveVenueStakeOpts & {
  role?: "execute" | "precheckOnly";
  /** 场馆额已换过：再预检只验盘口，不改 betMoney（勿用 skipAccountRate，USDT 会二次÷汇率） */
  skipStakeResolve?: boolean;
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
  if (!account)
    return false;
  const {
    accountTokenHasPrivateKey,
    ensurePmVaultUnlocked,
    ensurePmVaultForAccounts,
    hasVault,
    isVaultKeyProvider,
    mergeVaultKeysIntoAccounts,
    normalizePmVaultUserId,
  } = await import("@/security/pmVault");
  if (!isVaultKeyProvider(account.provider))
    return true;
  if (String(account.provider) === "Polymarket") {
    const { getRetainedPmPrivateKey } = await import("@/security/pmVault/retainedPmSession");
    getRetainedPmPrivateKey(account.accountId);
  }
  if (accountTokenHasPrivateKey(account.token))
    return true;

  const user = useUserStore();
  if (!user.userId && user.isLoggedIn)
    await user.fetchUserInfo();
  const uid = normalizePmVaultUserId(user.userId);
  if (!uid || !(await hasVault(uid)))
    return false;
  const unlocked = String(account.provider) === "Polymarket"
    ? await ensurePmVaultForAccounts(uid, [account]) : await ensurePmVaultUnlocked(uid);
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

/**
 * delayed 受理后：跟到已成交 / 未成交再提示。
 * 本地查询耗尽仍 pendingConfirm 时保持待确认，后台退避续查。
 */
function notifyPendingVenueConfirm(
  store: AccountStoreContext,
  account: PlatformAccount,
  accountLine: string,
  detailHtml: string,
  result: BetResult,
  option: BetOption,
  toastSeconds: number,
) {
  const orderId = String(result.orderId ?? "").trim();
  if (!orderId)
    return;
  const pmScope = account.provider === "Polymarket" ? pmSubmitScope(account) : undefined;
  const key = pmScope ? `${pmScope}:${orderId}` : `${account.accountId}:${orderId}`;
  const existing = pendingVenueBetConfirmations.get(key);
  if (existing) { schedulePendingVenueBetConfirmation(store, existing); return; }
  const task: PendingVenueBetConfirmation = {
    observation: option.observation,
    linkId: option.diagnosticLinkId,
    key,
    pmScope,
    accountId: account.accountId,
    provider: account.provider,
    orderId,
    matchId: option.matchId,
    venueBetId: option.betId,
    itemId: option.itemId,
    betRowId: Number(option.bet?.id ?? option.betId) || 0,
    target: option.target,
    betMoney: option.betMoney,
    odds: option.odds,
    accountLine,
    detailHtml,
    toastSeconds,
    attempts: 0,
    nextPollAt: Date.now(),
    pmSubmission: account.provider === "Polymarket" ? pmSubmissionFromResult(result, account.accountId) ?? undefined : undefined,
  };
  pendingVenueBetConfirmations.set(task.key, task);
  persistPendingVenueBetConfirmations();
  void runPendingVenueBetConfirmation(store, task);
}

const PENDING_VENUE_CONFIRM_KEY = "PENDING_VENUE_BET_CONFIRM";

interface PendingVenueBetConfirmation {
  pmScope?: string;
  pmSubmission?: PmSubmission;
  /** 已由套利/补单队列计数的尝试，恢复页只核对与同步原单。 */
  recoveryOnly?: boolean;
  observation?: ObservationContext;
  linkId?: number;
  key: string;
  accountId: number;
  provider: string;
  orderId: string;
  matchId: string;
  venueBetId: string;
  itemId: string;
  betRowId: number;
  target: BetOption["target"];
  betMoney: number;
  odds: number;
  accountLine: string;
  detailHtml: string;
  toastSeconds: number;
  attempts: number;
  nextPollAt: number;
}

function loadPendingVenueBetConfirmations(): Map<string, PendingVenueBetConfirmation> {
  try {
    const rows = JSON.parse(sessionStorage.getItem(PENDING_VENUE_CONFIRM_KEY) || "[]") as PendingVenueBetConfirmation[];
    return new Map(rows.filter(row => row?.key && row.orderId).map(row => [row.key, row]));
  }
  catch {
    return new Map();
  }
}

const pendingVenueBetConfirmations = loadPendingVenueBetConfirmations();
const pendingVenueConfirmationFlights = new Set<string>();
const pendingVenueConfirmationTimers = new Map<string, ReturnType<typeof setTimeout>>();

function persistPendingVenueBetConfirmations(): void {
  try {
    sessionStorage.setItem(
      PENDING_VENUE_CONFIRM_KEY,
      JSON.stringify([...pendingVenueBetConfirmations.values()]),
    );
  }
  catch {
    /* sessionStorage 不可用时仍保留当前页单飞续查 */
  }
}

function schedulePendingVenueBetConfirmation(
  store: AccountStoreContext,
  task: PendingVenueBetConfirmation,
): void {
  if (pendingVenueConfirmationTimers.has(task.key) || pendingVenueConfirmationFlights.has(task.key))
    return;
  const delay = Math.max(0, task.nextPollAt - Date.now());
  const timer = setTimeout(() => {
    pendingVenueConfirmationTimers.delete(task.key);
    void runPendingVenueBetConfirmation(store, task);
  }, delay);
  pendingVenueConfirmationTimers.set(task.key, timer);
}

async function runPendingVenueBetConfirmation(
  store: AccountStoreContext,
  task: PendingVenueBetConfirmation,
): Promise<void> {
  if (pendingVenueConfirmationFlights.has(task.key))
    return;
  if (task.nextPollAt > Date.now()) {
    schedulePendingVenueBetConfirmation(store, task);
    return;
  }
  const account = store.findAccount(task.accountId);
  if (!account) {
    task.nextPollAt = Date.now() + 5_000;
    pendingVenueBetConfirmations.set(task.key, task);
    persistPendingVenueBetConfirmations();
    schedulePendingVenueBetConfirmation(store, task);
    return;
  }
  // 新任务绑定用户/钱包；旧会话仅在当前钱包的持久化原单能核实时迁移。
  if (task.provider === "Polymarket") {
    try {
      if (account.provider !== "Polymarket") return;
      const scope = pmSubmitScope(account);
      if (!task.pmScope && pmAccountSubmitAttempts(account).some(attempt =>
        attempt.orderHash === task.orderId || attempt.acceptedOrderId === task.orderId)) task.pmScope = scope;
      if (!task.pmScope) {
        // 兼容升级前会话：由服务端校验账号归属，再用原签名 maker 核对当前钱包。
        const version = getAuthSessionVersion();
        let recovered;
        try { recovered = validatePmSubmission(await getPmSubmission(account.accountId, task.orderId), task.orderId, account.accountId); }
        catch {
          task.nextPollAt = Date.now() + 5_000;
          schedulePendingVenueBetConfirmation(store, task);
          return;
        }
        if (!isAuthSessionCurrent(version) || scope !== pmSubmitScope(account)) return;
        if (!recovered?.makerAddress || recovered.makerAddress !== pmSubmitMaker(account)) return;
        task.pmSubmission = recovered;
        task.pmScope = scope;
        persistPendingVenueBetConfirmations();
      }
      if (task.pmScope !== scope) return;
    } catch { return; }
  }
  const sessionVersion = getAuthSessionVersion();

  if (pendingVenueConfirmationFlights.has(task.key)) return;
  pendingVenueConfirmationFlights.add(task.key);
  try {
    const result = Object.assign(new BetResult(task.provider as BetOption["type"], true), {
      success: task.pmSubmission?.submitUnknown !== true,
      pmSubmitUnknown: task.pmSubmission?.submitUnknown,
      pmSubmittedAt: task.pmSubmission?.submittedAt,
      ...(task.pmSubmission ? { beginTime: task.pmSubmission.submittedAt,
        request: { order: { side: "BUY", makerAmount: task.pmSubmission.makerAmount, maker: task.pmSubmission.makerAddress } } } : {}),
      orderId: task.orderId,
      pending: true,
      observation: task.observation,
      link: task.linkId || 0,
    });
    const option = new BetOption(
      task.provider as BetOption["type"],
      task.matchId,
      task.venueBetId,
      task.itemId,
      task.betMoney,
      task.target,
      task.odds,
    );
    option.observation = task.observation;
    option.diagnosticLinkId = task.linkId;
    const { rejected, pendingConfirm, orders } = await settleArbLegUntilTerminal(account, result, {
      rejectWaitSec: 0,
      betOption: option,
    });
    if (!isAuthSessionCurrent(sessionVersion)
      || task.pmScope && task.pmScope !== pmSubmitScope(account)) return;
    try {
      const exactObservedOrder = orders.find(order => String(order.orderId) === task.orderId);
      observeOption(option, account, "settlement_observed", {
        orderId: task.orderId,
        outcome: pendingConfirm ? "timeout" : rejected ? "unfilled" : "filled",
        source: String(result.message).includes("超时策略判拒") ? "timeout_policy" : exactObservedOrder ? "adapter" : "orchestration_result",
        observedStatus: exactObservedOrder?.status,
        phase: "reject_detection",
      });
    }
    catch { /* 观察快照异常不改变原单确认的后续处理 */ }
    if (pendingConfirm) {
      task.pmSubmission = pmSubmissionFromResult(result, account.accountId) ?? task.pmSubmission;
      task.attempts += 1;
      task.nextPollAt = Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(task.attempts - 1, 5));
      pendingVenueBetConfirmations.set(task.key, task);
      persistPendingVenueBetConfirmations();
      return;
    }

    pendingVenueBetConfirmations.delete(task.key);
    persistPendingVenueBetConfirmations();
    const titleSuffix = rejected ? "未成交" : "已成交";
    ElNotification({
      title: "",
      message: bettingResultMessageHtml(
        account.provider,
        task.accountLine,
        task.detailHtml,
        `<p>${result.message || ""}</p>`,
        titleSuffix,
      ),
      type: rejected ? "error" : "success",
      dangerouslyUseHTMLString: true,
      duration: task.toastSeconds === 0 ? 3000 : task.toastSeconds * 1000,
      customClass: `notification ${account.provider}`,
    });
    if (!rejected && !task.recoveryOnly) {
      void playOrderSuccessSound({ betRowId: task.betRowId || task.venueBetId });
      void publishBettingEvent(option);
      // PF/PM：受理≠成交；成功计数推迟到 filled
      if (isPendingConfirmVenueProvider(account.provider)) {
        const betRowId = Number(task.betRowId);
        if (Number.isFinite(betRowId) && betRowId > 0)
          markSuccessfulBet(account, betRowId, option.target, option.odds);
      }
    }
    if (isPendingConfirmVenueProvider(account.provider)) {
      try {
        const { refreshAccountBalance } = await import("@/stores/account/balanceRefresh");
        await refreshAccountBalance(store, account);
      }
      catch {
        /* 刷新失败不阻断 toast */
      }
      try {
        const { refreshOrderListAfterBind } = await import("@/stores/betting/arbOrderBind");
        refreshOrderListAfterBind();
      }
      catch {
        /* 侧栏刷新失败不阻断 toast */
      }
    }
  }
  catch {
    if (pendingVenueBetConfirmations.has(task.key)) {
      task.attempts += 1;
      task.nextPollAt = Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(task.attempts - 1, 5));
      pendingVenueBetConfirmations.set(task.key, task);
      persistPendingVenueBetConfirmations();
    }
  }
  finally {
    pendingVenueConfirmationFlights.delete(task.key);
    const current = pendingVenueBetConfirmations.get(task.key);
    if (current && isAuthSessionCurrent(sessionVersion))
      schedulePendingVenueBetConfirmation(store, current);
  }
}

/** 账号加载后恢复手动/正 EV 单的场馆待确认任务。 */
export function resumePendingVenueConfirmations(store: AccountStoreContext): void {
  for (const account of store.accounts ?? []) {
    if (account.provider !== "Polymarket") continue;
    try {
      for (const attempt of pmAccountSubmitAttempts(account)) {
        const recovery = attempt.recovery;
        if (attempt.side !== "BUY" || !recovery) continue;
        const orderId = attempt.acceptedOrderId || attempt.orderHash;
        const pmScope = pmSubmitScope(account);
        const key = `${pmScope}:${orderId}`;
        const pmSubmission: PmSubmission = { orderId, accountId: account.accountId, makerAmount: attempt.makerAmount,
          stakeUsdc: Number(attempt.makerAmount) / 1e6, submittedAt: attempt.submittedAt,
          ...(!attempt.acceptedOrderId ? { submitUnknown: true } : {}) };
        const legacy = [...pendingVenueBetConfirmations.values()].find(task => task.provider === "Polymarket"
          && task.accountId === account.accountId && task.orderId === orderId && (!task.pmScope || task.pmScope === pmScope));
        if (legacy) { Object.assign(legacy, recovery, { pmScope, pmSubmission }); continue; }
        if (pendingVenueBetConfirmations.has(key)) continue;
        pendingVenueBetConfirmations.set(key, { ...recovery, target: recovery.target as BetOption["target"],
          key, pmScope, accountId: account.accountId, provider: "Polymarket", orderId,
          betRowId: recovery.betRowId ?? 0, accountLine: "", detailHtml: "",
          toastSeconds: 3, attempts: 0, nextPollAt: Date.now(),
          pmSubmission });
      }
    } catch { /* 凭证尚未加载时保留原记录，下次恢复 */ }
  }
  persistPendingVenueBetConfirmations();
  for (const task of pendingVenueBetConfirmations.values())
    schedulePendingVenueBetConfirmation(store, task);
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
  const signingTask = pm && opts?.role === "precheckOnly"
    ? Promise.resolve(true) : ensureSharedVaultKeyForAccount(account).catch(() => false);
  if (!pm) await signingTask;
  const provider = getProvider(account);
  if (!provider) {
    option.checkError = `场馆${option.type}不被支持`;
    observeOption(option, account, "precheck_result", { outcome: "blocked", reasonCode: "unsupported_provider" });
    return option;
  }
  let observedPrecheckResult = false;
  const observationStartedAt = Date.now();
  let observationError: unknown;
  try {
    attachPolymarketDetectionQuote(option);
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
    const checked = await provider.checkBet(account, option, { role: opts?.role ?? "execute", prepareSigning: signingTask });
    // [changmen 扩展] adapter 返回新对象时只传递观察元数据，原业务返回值不变。
    try { checked.observation ??= option.observation; }
    catch { /* 观察字段写入失败不改变返回值 */ }
    try {
      const blocked = !checked.data || Boolean(checked.checkError);
      observeOption(checked, account, "precheck_result", { outcome: blocked ? "blocked" : "prepared", durationMs: Date.now() - observationStartedAt,
        reasonCode: blocked ? "precheck_error" : undefined,
        ...(blocked ? observationFailureEvidence(checked.checkError || "无盘口数据", checked.response, undefined, account.provider) : {}) });
    }
    catch { /* 观察快照读取失败不改变 adapter 返回值 */ }
    observedPrecheckResult = true;
    return checked;
  }
  catch (e) {
    observationError = e;
    option.checkError = e instanceof Error ? e.message : JSON.stringify(e);
    return option;
  }
  finally {
    if (!observedPrecheckResult) {
      try { observeOption(option, account, "precheck_result", { outcome: "blocked", reasonCode: "precheck_error", durationMs: Date.now() - observationStartedAt, ...observationFailureEvidence(option.checkError, undefined, observationError) }); }
      catch { /* 旁路证据读取失败不阻断预检收尾 */ }
    }
    option.saveLog(account);
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
  if (account.provider !== "Polymarket") await ensureSharedVaultKeyForAccount(account);
  const provider = getProvider(account);
  if (!provider) {
    observeOption(option, account, "submission_result", { outcome: "not_submitted", reasonCode: "unsupported_provider" });
    return new BetResult(option.type, false, "平台不支持");
  }

  const platformLabel = store.getPlatformName(account.platformId, account.platformName);
  const accountLine = bettingNotifyAccountLine(account, platformLabel);
  const detailHtml = bettingDetailHtml({
    matchTitle: option.match?.title,
    betName: option.bet?.getBetName(),
    target: option.target,
    itemOdds: option.item?.getOdds(option.target),
    betMoney: option.betMoney,
    odds: option.odds,
    betCount: option.betCount,
  });

  const loading = ElNotification({
    title: "",
    message: bettingLoadingMessageHtml(account.provider, accountLine, detailHtml),
    dangerouslyUseHTMLString: true,
    duration: 10_000,
    customClass: `notification loading ${account.provider}`,
  });

  const beginTime = Date.now();
  let result: BetResult = new BetResult(account.provider, false, "未知错误");
  let observationSubmitted = false;
  let observationThrew = false;
  let observationCallAt: number | undefined;
  let observationDuration: number | undefined;
  let observationError: unknown;
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
      observeOption(option, account, "submission_started", { source: "adapter_call" });
      observationSubmitted = true;
      observationCallAt = Date.now();
      result = await provider.betting(account, option);
      observationDuration = Date.now() - observationCallAt;
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
    ElNotification({
      title: "",
      message: bettingResultMessageHtml(
        account.provider,
        accountLine,
        detailHtml,
        `<p>${result.message || ""}</p>`,
        statusSuffix,
      ),
      type: notifyType,
      dangerouslyUseHTMLString: true,
      customClass: `notification ${account.provider}`,
      duration: toastSeconds === 0 ? 3000 : toastSeconds * 1000,
    });
    useMessageStore().delayMessage(account, Date.now() - beginTime);
    result.saveLog(account, beginTime);
    if (result.success && !result.pending) {
      void playOrderSuccessSound({ betRowId: option.betId });
      void publishBettingEvent(option);
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
      );
    }
  }
  return result;
}
