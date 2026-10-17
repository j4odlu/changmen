import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { parseTokenConfig, resolveApiCreds, resolvePrivateKey } from "../../l2Auth";
import { getPolymarketOrderClientRuntime, preparePolymarketOrderClientRuntime, polymarketSigningGeneration, polymarketSigningSessionGeneration } from "../../pmOrderClientCache";
import { pmPrepareSubmit } from "../../pmClientApi";
import { resolvePolymarketBetBlockReason } from "../../pmBetGuard";
import { resolvePolymarketBetBlockReason as resolveLegacyBlockReason } from "./legacy/pmBetGuard";
import type { PmFokPreflightMode } from "./pmFokPreflightMode";
import { getPolymarketPmSportBlockReasonFromOption } from "../../pmSportGuard";
import { measurePmExecution } from "../../pmExecutionMetrics";
import { runOptimizedFokPreflight } from "./optimized/pmFastPreflight";

export interface PmPreflightBinding {
  binding: string;
  generation: number;
}

/** [changmen 扩展] 凭据绑定只留在内存；各模式决定额外参与绑定的字段。 */
export function capturePmPreflightBinding(account: PlatformAccount, binding: () => string): PmPreflightBinding {
  return { binding: binding(), generation: polymarketSigningGeneration(account) };
}

export function matchesPmPreflightBinding(account: PlatformAccount, snapshot: PmPreflightBinding, binding: () => string): boolean {
  return snapshot.binding === binding() && snapshot.generation === polymarketSigningGeneration(account);
}

export function assertPmPreflightSportAllowed(option: BetOption): void {
  const reason = getPolymarketPmSportBlockReasonFromOption(option);
  if (reason) throw new Error(reason);
}

export interface PmBuyPreflightTasks<T> {
  gateway: string;
  /** 每轮只调用一次；FOK/GTC 自己保留报价、份数和深度语义。 */
  market: () => Promise<T>;
  shadowInput?: import("./optimized/wsBook/executionMath").SimulationInput;
  role?: "execute" | "precheckOnly";
  requireClobConfirmation?: boolean;
  /** GTC 固定使用优化检查；只有 FOK 调用方可指定线上原有检查。 */
  sportMode?: PmFokPreflightMode;
  runtimeBinding: () => string;
  missingCredentialsMessage: string;
  runtimeTokenChangedMessage?: string;
  measureStages?: boolean;
}

/**
 * [changmen 扩展] PM 公共买入预检的并发阶段。经典 FOK 保留原有 signer 自动准备能力。
 * GTC 与动态 FOK 仍由各自准备阶段提供 signer。
 * 保留各模式的错误优先级：返回具名 settled 结果，由模式层按原顺序解释。
 * 本地终局在所有异步阶段返回后再次核验；提交前的核验仍由各执行器保留。
 */
export async function runPmBuyPreflight<T>(account: PlatformAccount, option: BetOption, tasks: PmBuyPreflightTasks<T>) {
  if (tasks.sportMode === "optimized") return runOptimizedFokPreflight(account, option, tasks);
  const measure = <R>(kind: "guard" | "clock" | "runtime", action: () => Promise<R>) =>
    tasks.measureStages ? measurePmExecution(kind, { tokenId: option.itemId, preflightMode: tasks.sportMode ?? "gtc" }, action) : action();
  const market = tasks.market();
  const guard = measure("guard", () => tasks.sportMode === "legacy"
    ? resolveLegacyBlockReason(option)
    : resolvePolymarketBetBlockReason(option, tasks.requireClobConfirmation));
  const clock = tasks.role === "precheckOnly" ? Promise.resolve()
    : measure("clock", () => pmPrepareSubmit(account));
  const runtime = tasks.role === "precheckOnly" ? Promise.resolve(null) : measure("runtime", async () => {
    const config = parseTokenConfig(account.token);
    const creds = resolveApiCreds(config);
    const privateKey = resolvePrivateKey(config);
    if (!privateKey || !creds.address || !creds.apiKey || !creds.secret || !creds.passphrase)
      throw new Error(tasks.missingCredentialsMessage);
    const token = account.token;
    const snapshot = capturePmPreflightBinding(account, tasks.runtimeBinding);
    const sessionGeneration = tasks.sportMode === "legacy" ? polymarketSigningSessionGeneration(account) : 0;
    const signatureType = Number(creds.signatureType ?? 0);
    const input = { gateway: tasks.gateway, config, creds, privateKey,
      signatureType: [1, 2, 3].includes(signatureType) ? signatureType : 0 };
    const prepared = tasks.sportMode === "legacy"
      ? await preparePolymarketOrderClientRuntime(input) : getPolymarketOrderClientRuntime(input);
    if (tasks.sportMode === "legacy") {
      // 初始化会产生新的账号版本；只接受仍在缓存中的同一实例，不能复活已撤销的 signer。
      if (sessionGeneration !== polymarketSigningSessionGeneration(account)
        || getPolymarketOrderClientRuntime(input).runtime !== prepared.runtime)
        throw new Error("PM 钱包会话已失效");
      snapshot.generation = polymarketSigningGeneration(account);
    }
    if (tasks.runtimeTokenChangedMessage && token !== account.token)
      throw new Error(tasks.runtimeTokenChangedMessage);
    return { ...prepared, ...snapshot };
  });
  const [marketResult, guardResult, clockResult, runtimeResult] = await Promise.allSettled([market, guard, clock, runtime]);
  if (tasks.sportMode !== "legacy") assertPmPreflightSportAllowed(option);
  return { market: marketResult, guard: guardResult, clock: clockResult, runtime: runtimeResult };
}
