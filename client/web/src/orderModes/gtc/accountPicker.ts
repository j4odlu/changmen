import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "@/stores/account/context";
import type { PlatformId } from "@/types/esport";
import { useUserStore } from "@/stores/userStore";

/** [A8 可证实] Io.getAccount：多账号时按 account.profit 与 implied 优选 */
function pickByAccountProfitA8(
  candidates: PlatformAccount[],
  options: BetOption[],
  configProfit: number,
): PlatformAccount | undefined {
  const implied = 1 / options.reduce((sum, o) => sum + 1 / o.odds, 0);
  const sorted = candidates
    .filter(a => a.profit === 0 || a.profit >= implied)
    .sort((a, b) => {
      const av = a.profit === 0 ? configProfit : a.profit;
      const bv = b.profit === 0 ? configProfit : b.profit;
      return av - bv;
    });
  return sorted[0];
}

/** 首屏余额刷新完成前不跑 getProviders / 自动套利（避免 balance=undefined 误判） */
export function accountsFundingReady(store: AccountStoreContext): boolean {
  if (!store.loaded || store.accounts.length === 0)
    return false;
  if (store.accounts.some(a => a.loadingBalance))
    return false;
  return store.accounts.some(a => a.balance !== undefined);
}

export function formatAccountFundingHint(
  accounts: PlatformAccount[],
  threshold: number,
): string {
  if (!accounts.length)
    return "无已加载账号";
  return accounts
    .map((acc) => {
      const bal = acc.getBalance();
      if (bal === undefined)
        return `${acc.provider}/${acc.playerName}:未加载`;
      const mark = bal < threshold ? `<${threshold}` : "";
      return `${acc.provider}/${acc.playerName}:${Math.floor(bal)}${mark}`;
    })
    .join("，");
}

export function getProviders(store: AccountStoreContext, minBetMoney?: number) {
  const config = useUserStore().config;
  // [changmen 扩展] 合计模式按选腿后的实际注码选号，不能要求单账号余额达到整组总额。
  const threshold = minBetMoney ?? (config.betMoneyMode === "total" ? 0 : config.betMoney);
  const map = new Map<PlatformId, PlatformAccount[]>();
  for (const acc of store.accounts) {
    const bal = acc.getBalance();
    if (bal === undefined || bal < threshold || (config.betMoneyMode === "total" && bal <= 0))
      continue;
    if (!map.has(acc.provider))
      map.set(acc.provider, []);
    map.get(acc.provider)!.push(acc);
  }
  return map;
}

export function pickAccount(
  store: AccountStoreContext,
  provider: PlatformId,
  betMoney: number,
  excludeAccountIds: number[] = [],
  filter?: (acc: PlatformAccount) => boolean,
  options?: BetOption[],
) {
  if (!provider)
    return undefined;
  const candidates = store.accounts.filter((acc) => {
    if (excludeAccountIds.includes(acc.accountId))
      return false;
    if (acc.maxOrder && acc.todayOrder && acc.todayOrder >= acc.maxOrder)
      return false;
    const bal = acc.getBalance();
    if (bal === undefined)
      return false;
    if (filter && !filter(acc))
      return false;
    return acc.provider === provider && bal >= betMoney;
  });
  if (!candidates.length)
    return undefined;
  if (candidates.length === 1)
    return candidates[0];

  const configProfit = useUserStore().config.profit;
  if (options?.length === 2 && candidates.some(a => a.profit !== 0)) {
    const picked = pickByAccountProfitA8(candidates, options, configProfit);
    if (picked)
      return picked;
  }

  const idx = store.providerPickIndex.get(provider) ?? 0;
  store.providerPickIndex.set(provider, idx + 1);
  return candidates[idx % candidates.length];
}
