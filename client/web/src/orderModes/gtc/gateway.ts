import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { ResolveVenueStakeOpts } from "@changmen/venue-adapter/adaptation";
import type { PlatformAccount } from "@/models/platformAccount";
import { getExchange } from "@changmen/shared/currency";
import { resolveVenueStakeFromPlanCny } from "@changmen/venue-adapter/adaptation";
import { attachPolymarketDetectionQuote } from "@/domain/polymarket/attachDetectionQuote";
import { attachPredictFunDetectionQuote } from "@/domain/predictfun/attachDetectionQuote";
import { getProvider } from "@/runtime/providers";
import { createObservationContext, observeOption } from "@/services/orderObservation";
import { observationFailureEvidence } from "@/services/orderObservationEvidence";
import { submissionVenueStatus } from "@/services/venueSettlementEvidence";
import { useUserStore } from "@/stores/userStore";

export type GtcCheckOptions = ResolveVenueStakeOpts & { manual?: boolean; role?: "execute" | "precheckOnly"; skipStakeResolve?: boolean; pmQuoteScope?: "esport" | "sport" };

/** [changmen 扩展] One original counterpart submission. No FOK queue, binding, retry, or follow-copy event. */
export async function placeOtherLeg(account: PlatformAccount, option: BetOption, linkId: number): Promise<BetResult> {
  if (account.provider === "Polymarket" || !option.data || option.checkError)
    throw new Error("GTC 对侧缺少冻结预检，未发送订单");
  const provider = getProvider(account);
  if (!provider)
    throw new Error("GTC 对侧平台不支持");
  const startedAt = Date.now();
  observeOption(option, account, "submission_started", { source: "adapter_call" });
  const result = await provider.betting(account, option);
  result.link = linkId;
  result.diagnosticAttempt = option.diagnosticAttempt;
  result.observation = option.observation;
  observeOption(option, account, "submission_result", {
    orderId: result.orderId || undefined,
    outcome: result.pmSubmitUnknown ? "unknown" : result.success ? "accepted" : "adapter_failed",
    source: "adapter_result",
    observedStatus: submissionVenueStatus(result),
    durationMs: Date.now() - startedAt,
  });
  result.saveLog(account, startedAt);
  return result;
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
    ? await ensurePmVaultForAccounts(uid, [account])
    : await ensurePmVaultUnlocked(uid);
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
  account: PlatformAccount | undefined,
  option: BetOption,
  opts?: GtcCheckOptions,
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
    ? Promise.resolve(true)
    : ensureSharedVaultKeyForAccount(account).catch(() => false);
  if (!pm)
    await signingTask;
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
    const checked = pm
      ? await (await import("@changmen/venue-adapter/polymarket/gtc")).checkGtcBuy(account, option, signingTask, opts?.manual !== true)
      : await provider.checkBet(account, option, { role: opts?.role ?? "execute", prepareSigning: signingTask });
    // [changmen 扩展] adapter 返回新对象时只传递观察元数据，原业务返回值不变。
    try { checked.observation ??= option.observation; }
    catch { /* 观察字段写入失败不改变返回值 */ }
    try {
      // [changmen 扩展] 执行层按 data 判定可继续；数据与错误并存只能记录矛盾，不能宣称已拦截。
      const blocked = !checked.data;
      const inconsistent = !blocked && Boolean(checked.checkError);
      observeOption(checked, account, "precheck_result", { outcome: blocked ? "blocked" : inconsistent ? "inconsistent" : "prepared", durationMs: Date.now() - observationStartedAt, reasonCode: blocked ? "precheck_error" : inconsistent ? "precheck_inconsistent" : undefined, ...(blocked ? observationFailureEvidence(checked.checkError || "无盘口数据", checked.response, undefined, account.provider) : {}), ...(inconsistent ? { safeSummary: "预检同时返回盘口数据和错误，不能据此认定已拦截；是否提交请查看提交记录" } : {}) });
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
      try {
        const inconsistent = Boolean(option.data);
        observeOption(option, account, "precheck_result", {
          outcome: inconsistent ? "inconsistent" : "blocked",
          reasonCode: inconsistent ? "precheck_inconsistent" : "precheck_error",
          durationMs: Date.now() - observationStartedAt,
          ...(inconsistent
            ? { safeSummary: "预检抛出异常但仍保留盘口数据，不能据此认定已拦截；是否提交请查看提交记录" }
            : observationFailureEvidence(option.checkError, undefined, observationError)),
        });
      }
      catch { /* 旁路证据读取失败不阻断预检收尾 */ }
    }
    option.saveLog(account);
  }
}
