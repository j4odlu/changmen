import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@/models/platformAccount";
import { toRaw } from "vue";

const revisions = new WeakMap<PlatformAccount, number>();
const loading = new WeakMap<PlatformAccount, { tasks: Set<symbol>; inherited: boolean }>();

/** [changmen 扩展] 仅 PM 查单与余额查询共用计数，避免一项完成时清掉另一项的加载状态。 */
export function beginPmAccountLoading(account: PlatformAccount): () => void {
  if (account.provider !== "Polymarket") return () => {};
  const identity = toRaw(account);
  let state = loading.get(identity);
  if (!state) {
    state = { tasks: new Set(), inherited: account.loadingBalance };
    loading.set(identity, state);
  }
  const current = state;
  const task = Symbol();
  current.tasks.add(task);
  account.loadingBalance = true;
  return () => {
    if (!current.tasks.delete(task)) return;
    if (current.tasks.size) account.loadingBalance = true;
    else {
      loading.delete(identity);
      if (!current.inherited) account.loadingBalance = false;
    }
  };
}

/** [changmen 扩展] PM 明确余额拒绝之后，拒绝前发出的余额查询不得覆盖新事实。 */
export function pmBalanceRevision(account: PlatformAccount): number {
  return revisions.get(toRaw(account)) ?? 0;
}

/** 新场馆事实出现后，较早发出的 PM 余额查询失效；不更改账号筛选条件。 */
export function invalidatePmBalanceQueries(account: PlatformAccount): void {
  if (account.provider === "Polymarket")
    revisions.set(toRaw(account), pmBalanceRevision(account) + 1);
}

/** 只接受已提交且明确被场馆拒绝的余额错误；授权不足、网络异常和受理未知不据此改余额。 */
export function applyPmBalanceRejection(account: PlatformAccount, result: BetResult): boolean {
  if (account.provider !== "Polymarket" || result.success || result.pending || result.pmSubmitUnknown)
    return false;
  const response = result.response as { success?: boolean; errorMsg?: unknown; pmSubmitRejected?: boolean } | undefined;
  const tip = result.tip as { pmPosted?: boolean } | null;
  if (response?.success !== false || (response.pmSubmitRejected !== true && tip?.pmPosted !== true))
    return false;
  const message = typeof response.errorMsg === "string" ? response.errorMsg : "";
  if (!/the balance is not enough|insufficient (?:available )?balance|not enough balance(?!\s*\/\s*allowance)/i.test(message))
    return false;

  // CLOB balance / order amount 使用 collateral 的 6 位最小单位，只解析明确的 balance 数字段。
  const match = /\bbalance:\s*(\d+)\s*,\s*order amount:\s*\d+\b/i.exec(message);
  const units = match ? Number(match[1]) : NaN;
  const balance = Number.isSafeInteger(units) && units >= 0 ? units / 1_000_000 : undefined;
  invalidatePmBalanceQueries(account);
  account.balance = balance;
  account.balanceStale = true;
  return true;
}
