import type { PlatformAccount } from "@/models/platformAccount";

/** [changmen 扩展] GTC 成交历史独立保存，不读写 FOK 的 BETCOUNT/BETACCOUNT/lastOdds。 */
function historyKey(kind: "COUNT" | "ACCOUNTS" | "ODDS", owner: string, betId: number, side: string, accountId?: number): string {
  return `PM_GTC_V2_${kind}:${JSON.stringify([owner, betId, side, accountId ?? null])}`;
}

export function readGtcBetCount(owner: string, accountId: number, betId: number, side: string): number {
  const raw = sessionStorage.getItem(historyKey("COUNT", owner, betId, side, accountId));
  return raw ? Number(raw) || 0 : 0;
}

export function readGtcLastOdds(owner: string, accountId: number, betId: number, side: string): number | undefined {
  const raw = sessionStorage.getItem(historyKey("ODDS", owner, betId, side, accountId));
  return raw == null ? undefined : Number(raw);
}

export function readGtcUsedAccounts(owner: string, betId: number, side: string): number[] {
  const raw = sessionStorage.getItem(historyKey("ACCOUNTS", owner, betId, side));
  return raw ? JSON.parse(raw) as number[] : [];
}

export function markGtcSuccess(owner: string, accountId: number, betId: number, side: string, odds?: number): void {
  if (!owner || !accountId)
    return;
  const used = readGtcUsedAccounts(owner, betId, side);
  if (!used.includes(accountId)) {
    used.push(accountId);
    sessionStorage.setItem(historyKey("ACCOUNTS", owner, betId, side), JSON.stringify(used));
  }
  sessionStorage.setItem(historyKey("COUNT", owner, betId, side, accountId), String(readGtcBetCount(owner, accountId, betId, side) + 1));
  if (odds !== undefined)
    sessionStorage.setItem(historyKey("ODDS", owner, betId, side, accountId), String(odds));
}

/** 只由自动 GTC 在发送原始双腿前检查，旧 FOK 选号/预检不增加任何分支。 */
export function assertGtcHistoryAllowsLeg(owner: string, account: PlatformAccount, betId: number, side: string, odds: number, noSameBet: boolean): void {
  if (account.maxBetCount && readGtcBetCount(owner, account.accountId, betId, side) >= account.maxBetCount)
    throw new Error("GTC 已达同场同边盘口订单上限");
  const previousOdds = readGtcLastOdds(owner, account.accountId, betId, side);
  if (account.lastOdds && previousOdds != null && previousOdds >= odds)
    throw new Error("GTC 赔率不大于上笔成功单");
  if (noSameBet && readGtcUsedAccounts(owner, betId, side === "Home" ? "Away" : "Home").includes(account.accountId))
    throw new Error("GTC 同场反向下注账号已排除");
}
