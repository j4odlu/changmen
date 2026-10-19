import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { PmBuyPreflightTasks } from "../pmBuyPreflight";
import { parseTokenConfig, resolveApiCreds, resolvePrivateKey } from "../../../auth/l2Auth";
import { getPolymarketOrderClientRuntime, polymarketSigningGeneration } from "../../client/pmOrderClientCache";
import { pmPrepareSubmit, pmSubmitClockReady } from "../../../orders/pmClientApi";
import { measurePmExecution, recordPmExecutionMetric } from "../../../pmExecutionMetrics";
import { resolveOptimizedFokBlockReason } from "./pmBetGuard";
import { beginWsBookShadow } from "../../../../pm-book-diagnostics/shadowObserver";

function readRuntime(account: PlatformAccount, gateway: string, missing = "PM 钱包或 API 凭据未就绪，请解锁钱包并检查账号") {
  const config = parseTokenConfig(account.token);
  const creds = resolveApiCreds(config);
  const privateKey = resolvePrivateKey(config);
  if (!privateKey || !creds.address || !creds.apiKey || !creds.secret || !creds.passphrase) throw new Error(missing);
  const signatureType = Number(creds.signatureType ?? 0);
  return getPolymarketOrderClientRuntime({ gateway, config, creds, privateKey,
    signatureType: [1, 2, 3].includes(signatureType) ? signatureType : 0 });
}

/** [changmen 扩展] 双腿预检开始前准备；不初始化 signer，不查询市场，不签单。冷准备单独计时。 */
export async function prepareOptimizedFokExecution(account: PlatformAccount, linkId?: number): Promise<void> {
  await measurePmExecution("outbound_prepare", { preflightMode: "optimized", stage: "before_pair_check",
    accountId: Number(account.accountId) || undefined, ...(linkId != null ? { linkId } : {}) }, async () => {
    const token = account.token, gateway = account.gateway;
    const generation = polymarketSigningGeneration(account);
    readRuntime(account, gateway || "https://clob.polymarket.com");
    if (!pmSubmitClockReady(account)) await pmPrepareSubmit(account);
    if (token !== account.token || gateway !== account.gateway || generation !== polymarketSigningGeneration(account))
      throw new Error("PM 准备期间钱包或账号已改变，请新建尝试");
    if (!pmSubmitClockReady(account)) throw new Error("PM 提交校时未就绪");
  });
}

/** [changmen 扩展] 动态 FOK 热路径仅等待本轮订单簿；准备不足立即失败，不在这里补做网络准备。 */
export async function runOptimizedFokPreflight<T>(account: PlatformAccount, option: BetOption, tasks: PmBuyPreflightTasks<T>) {
  const local = resolveOptimizedFokBlockReason(option);
  if (local) throw new Error(local);
  const started = performance.now();
  const runtime = tasks.role === "precheckOnly" ? null : {
    ...readRuntime(account, tasks.gateway, tasks.missingCredentialsMessage),
    binding: tasks.runtimeBinding(), generation: polymarketSigningGeneration(account),
  };
  if (tasks.measureStages) recordPmExecutionMetric({ kind: "runtime", preflightMode: "optimized", tokenId: option.itemId,
    ms: performance.now() - started, success: true });
  if (tasks.role !== "precheckOnly" && !pmSubmitClockReady(account))
    throw new Error("PM 提交准备未完成，请先完成校时再新建投注尝试");
  const finishShadow = beginWsBookShadow({ tokenId: option.itemId, gateway: tasks.gateway,
    simulation: tasks.shadowInput,
    tick: option.data?.pmBufferMode === "tick" || Boolean(option.data?.pmTickQuote)
      || (option.data?.pmPriceQuote as { mode?: string } | undefined)?.mode === "tick",
    proxied: Boolean(account.proxyId), role: tasks.role ?? "execute", linkId: option.diagnosticLinkId,
    attemptId: option.observation?.attemptId, executionId: option.observation?.executionId,
    leg: `${option.type}:${option.target}:${option.itemId}` });
  let market: T;
  try { market = await tasks.market(); }
  catch (error) { finishShadow(undefined, true); throw error; }
  finishShadow(market, false);
  const latest = resolveOptimizedFokBlockReason(option);
  if (latest) throw new Error(latest);
  return { market: { status: "fulfilled" as const, value: market },
    guard: { status: "fulfilled" as const, value: null },
    clock: { status: "fulfilled" as const, value: undefined },
    runtime: { status: "fulfilled" as const, value: runtime } };
}
