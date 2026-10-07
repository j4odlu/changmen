/**
 * [changmen 扩展] 双边预测市场提前锁利。
 *
 * 仅扫描「两边都是可卖 PM/PF、无庄家腿」的未结套利 Link：
 * 若两边同卖回款 − 组本金 ≥ 锁定利润 × (1 + 额外%/100)，则两边市价卖出。
 * 庄+预测市场不触发（避免打单边）。挂在 mainBetLoop 末尾，默认关闭。
 */
import type { ArbEarlyLockSellPrefs } from "@/types/extensionPrefs";
import type { OrderRow } from "@/types/order";
import type { PlatformAccount } from "@/models/platformAccount";
import { Currency, getExchange } from "@changmen/shared/currency";
import {
  estimatePolymarketManualSellProceedsUsdc,
  hasOpenPolymarketPosition,
  sellPolymarketBuyPosition,
  pmSubmitScope,
  type OrderRowLike,
} from "@changmen/venue-adapter/polymarket";
import { pfSubmitSell } from "@changmen/venue-adapter/predictfun";
import { saveOrders } from "@/api/order";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { a8Tip } from "@/shared/a8Notify";
import { isSingleLegLink } from "@changmen/client-core/shared/format";
import {
  estimateArbLockedProfitCny,
  isMakeupSyntheticOrderRow,
} from "@/shared/orderLink";
import { canManualSellPfBuy } from "@/stores/account/pfManualSell";
import { canManualSellPmBuy } from "@/stores/account/pmManualSell";
import { beginArbAutoSell, endArbAutoSell } from "@/extensions/arbBet/arbAutoSellLock";
import { useAccountStore } from "@/stores/accountStore";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useOddsStore } from "@/stores/oddsStore";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";

export const ARB_EARLY_LOCK_SCAN_MS = 5_000;
export const ARB_EARLY_LOCK_COOLDOWN_MS = 60_000;

export interface ArbEarlyLockDecisionInput {
  enabled: boolean;
  /** 相对锁定利润的额外百分比，如 10 = 需多 10% */
  minExtraProfitPct: number;
  lockedProfitCny: number;
  /** 两边可卖回款合计（CNY） */
  sellBothProceedsCny: number;
  /** 套利组总本金（CNY） */
  totalCostCny: number;
}

const cooldownUntil = new Map<string, number>();
let lastScanAt = 0;
let scanInFlight = false;

export function isArbEarlyLockSellEnabled(
  prefs: ArbEarlyLockSellPrefs | undefined | null,
): boolean {
  return prefs?.enabled === true;
}

/**
 * 纯判定：双边同卖净利是否优于锁定利润。
 * net = sellBothProceeds − totalCost；
 * 要求 net ≥ locked × (1 + minExtraProfitPct/100)。
 */
export function decideArbEarlyLockSell(
  input: ArbEarlyLockDecisionInput,
): boolean {
  if (!input.enabled)
    return false;
  if (!(Number.isFinite(input.lockedProfitCny)))
    return false;
  if (input.lockedProfitCny < 0)
    return false;
  if (!(input.sellBothProceedsCny > 0) || !(input.totalCostCny > 0))
    return false;
  const pct = Number.isFinite(input.minExtraProfitPct) ? input.minExtraProfitPct : 0;
  const threshold = input.lockedProfitCny * (1 + pct / 100);
  const net = input.sellBothProceedsCny - input.totalCostCny;
  return net >= threshold;
}

/** 未结组里是否还有非预测市场腿（庄家等） */
export function hasOpenBookmakerLeg(rows: OrderRow[]): boolean {
  return rows.some((row) => {
    if (isMakeupSyntheticOrderRow(row))
      return false;
    if (String(row.Status ?? "") !== "None")
      return false;
    if (row.PfSide === "sell" || row.PmSide === "sell")
      return false;
    const t = String(row.Type ?? "").trim();
    return t !== "Polymarket" && t !== "PredictFun";
  });
}

/** 未结、未退出的预测市场买单（不论当前能否手卖） */
export function collectOpenPredictionBuys(rows: OrderRow[]): OrderRow[] {
  return rows.filter((row) => {
    if (isMakeupSyntheticOrderRow(row))
      return false;
    if (String(row.Status ?? "") !== "None")
      return false;
    if (row.PmSide === "sell" || row.PfSide === "sell")
      return false;
    const t = String(row.Type ?? "").trim();
    if (t === "Polymarket")
      return hasOpenPolymarketPosition(row);
    if (t === "PredictFun") {
      const state = String(row.PfSellState ?? "").toLowerCase();
      if (state === "closed" || state === "settled")
        return false;
      return true;
    }
    return false;
  });
}

/** 可市价卖掉的预测市场买单（PM/PF） */
export function collectSellablePredictionBuys(rows: OrderRow[]): OrderRow[] {
  return rows.filter(r => canManualSellPmBuy(r) || canManualSellPfBuy(r));
}

/**
 * 是否双边预测市场套利组：
 * - 无庄家腿
 * - 未结预测买单 ≥ 2
 * - 且每一条都能卖（避免卖掉两腿后还留着不可卖敞口）
 */
export function isDualPredictionArbGroup(rows: OrderRow[]): boolean {
  if (hasOpenBookmakerLeg(rows))
    return false;
  const openPred = collectOpenPredictionBuys(rows);
  if (openPred.length < 2)
    return false;
  const sellable = collectSellablePredictionBuys(rows);
  return sellable.length === openPred.length;
}

function readPrefs(
  prefs?: ArbEarlyLockSellPrefs | null,
): ArbEarlyLockSellPrefs | undefined {
  if (prefs)
    return prefs;
  try {
    return useUserStore().extensionPrefs?.arbEarlyLockSell;
  }
  catch {
    return undefined;
  }
}

function usdtToCny(usdt: number): number {
  return usdt * getExchange(Currency.USDT);
}

function predCostCny(row: OrderRow): number {
  const t = String(row.Type ?? "").trim();
  if (t === "Polymarket") {
    const usdc = Number(row.PmStakeUsdc) || 0;
    if (usdc > 0)
      return usdtToCny(usdc);
    return Number(row.BetMoney) || 0;
  }
  if (t === "PredictFun") {
    const notional = Number(row.PfNotionalUsdt);
    if (Number.isFinite(notional) && notional > 0)
      return usdtToCny(notional);
    return usdtToCny(Number(row.BetMoney) || 0);
  }
  return Number(row.BetMoney) || 0;
}

async function estimatePmSellProceedsUsdc(
  account: PlatformAccount,
  row: OrderRow,
): Promise<number> {
  return estimatePolymarketManualSellProceedsUsdc({
    account,
    buyRow: row as OrderRowLike,
  });
}

/** PF：用 oddsStore 隐含价粗估（无深度）；失败返回 0 */
function estimatePfSellProceedsUsdt(row: OrderRow): number {
  const shares = Number(row.PfHoldShares) > 0
    ? Number(row.PfHoldShares)
    : Number(row.PfShares) || 0;
  if (!(shares > 0))
    return 0;
  const tokenId = String(row.PfTokenId ?? "").trim();
  if (!tokenId)
    return 0;
  try {
    const odds = useOddsStore().getOdds("PredictFun" as never, tokenId, 0);
    if (!(odds > 1))
      return 0;
    const price = 1 / odds;
    if (!(price > 0 && price < 1))
      return 0;
    return Math.round(shares * price * 0.98 * 10000) / 10000;
  }
  catch {
    return 0;
  }
}

function notify(title: string, message: string): void {
  try {
    a8Tip(title, message, 4000);
  }
  catch { /* ignore */ }
}

async function sellPm(account: PlatformAccount, row: OrderRow): Promise<boolean> {
  const orderId = String(row.OrderID ?? "").trim();
  if (!orderId || !beginArbAutoSell(orderId))
    return false;
  try {
    const { trackPmManualSellClosing, clearPmManualSellClosing } = await import("@/stores/account/pmManualSell");
    const sessionVersion = getAuthSessionVersion();
    const scope = pmSubmitScope(account);
    const current = () => isAuthSessionCurrent(sessionVersion) && scope === pmSubmitScope(account);
    const result = await sellPolymarketBuyPosition({
      account,
      buyRow: row as OrderRowLike,
      onSubmitted: (info) => {
        if (current()) trackPmManualSellClosing(orderId, info, account);
      },
    });
    if (!current()) return false;
    if (!result.ok) {
      if (result.unfilled)
        clearPmManualSellClosing(orderId);
      return false;
    }
    if (result.ordersToSave?.length) {
      try {
        await saveOrders(account, result.ordersToSave);
        if (current()) clearPmManualSellClosing(orderId);
      }
      catch {
        // 保留 closing，等订单刷新 resume 再落库
        return false;
      }
    }
    else {
      clearPmManualSellClosing(orderId);
    }
    return true;
  }
  catch {
    return false;
  }
  finally {
    endArbAutoSell(orderId);
  }
}

async function sellPf(account: PlatformAccount, row: OrderRow): Promise<boolean> {
  const orderId = String(row.OrderID ?? "").trim();
  if (!orderId || !beginArbAutoSell(orderId))
    return false;
  try {
    await pfSubmitSell(account, orderId);
    return true;
  }
  catch {
    return false;
  }
  finally {
    endArbAutoSell(orderId);
  }
}

async function sellPredLeg(
  accountStore: ReturnType<typeof useAccountStore>,
  row: OrderRow,
): Promise<boolean> {
  const account = accountStore.findAccount(Number(row.PlayerID));
  if (!account)
    return false;
  const t = String(row.Type ?? "").trim();
  if (t === "Polymarket")
    return sellPm(account, row);
  if (t === "PredictFun")
    return sellPf(account, row);
  return false;
}

async function estimatePredSellProceedsCny(
  accountStore: ReturnType<typeof useAccountStore>,
  row: OrderRow,
): Promise<number> {
  const account = accountStore.findAccount(Number(row.PlayerID));
  if (!account)
    return 0;
  const t = String(row.Type ?? "").trim();
  if (t === "Polymarket") {
    const usdc = await estimatePmSellProceedsUsdc(account, row);
    return usdc > 0 ? usdtToCny(usdc) : 0;
  }
  if (t === "PredictFun") {
    const usdt = estimatePfSellProceedsUsdt(row);
    return usdt > 0 ? usdtToCny(usdt) : 0;
  }
  return 0;
}

function linkHasPendingMakeup(linkId: number): boolean {
  try {
    const lose = useLoseOrderStore();
    for (const order of lose.orders.values()) {
      if (Number(order.linkId) === linkId)
        return true;
    }
  }
  catch { /* ignore */ }
  return false;
}

interface DualPredTarget {
  linkId: number;
  legs: OrderRow[];
  lockedProfitCny: number;
  rows: OrderRow[];
  cooldownKey: string;
}

function collectDualPredTargets(orders: Map<number, OrderRow[]>): DualPredTarget[] {
  const out: DualPredTarget[] = [];
  for (const [linkId, rows] of orders) {
    // 不用 isLinkedArbOrderGroup：它要求「跨平台 Type」，会把 PM+PM / PF+PF 整组挡掉
    if (!(Number.isFinite(linkId) && linkId !== 0) || isSingleLegLink(linkId))
      continue;
    if (rows.length < 2)
      continue;
    if (linkHasPendingMakeup(linkId))
      continue;
    if (!isDualPredictionArbGroup(rows))
      continue;
    // 锁定利润要求至少两侧结果；同向两腿会在这里被滤掉
    const locked = estimateArbLockedProfitCny(rows);
    if (locked == null || !Number.isFinite(locked) || locked < 0)
      continue;
    const legs = collectSellablePredictionBuys(rows);
    const ids = legs
      .map(r => String(r.OrderID ?? "").trim())
      .filter(Boolean)
      .sort();
    if (ids.length < 2)
      continue;
    out.push({
      linkId,
      legs,
      lockedProfitCny: locked,
      rows,
      cooldownKey: `dual:${linkId}:${ids.join("+")}`,
    });
  }
  return out;
}

/**
 * 主循环钩子：节流扫描；失败不影响调用方。
 * @returns 本轮成功双边同卖的组数
 */
export async function runArbEarlyLockSellTick(opts?: {
  prefs?: ArbEarlyLockSellPrefs | null;
  now?: number;
  force?: boolean;
}): Promise<number> {
  if (scanInFlight)
    return 0;
  const prefs = readPrefs(opts?.prefs);
  if (!isArbEarlyLockSellEnabled(prefs))
    return 0;
  const now = opts?.now ?? Date.now();
  if (!opts?.force && now - lastScanAt < ARB_EARLY_LOCK_SCAN_MS)
    return 0;
  lastScanAt = now;
  scanInFlight = true;
  let soldGroups = 0;
  try {
    const orderStore = useOrderStore();
    const accountStore = useAccountStore();
    const targets = collectDualPredTargets(orderStore.orders);
    for (const target of targets) {
      const cd = cooldownUntil.get(target.cooldownKey) ?? 0;
      if (now < cd)
        continue;

      let sellBoth = 0;
      let okEstimate = true;
      for (const leg of target.legs) {
        const p = await estimatePredSellProceedsCny(accountStore, leg);
        if (!(p > 0)) {
          okEstimate = false;
          break;
        }
        sellBoth += p;
      }
      if (!okEstimate) {
        cooldownUntil.set(target.cooldownKey, now + ARB_EARLY_LOCK_COOLDOWN_MS);
        continue;
      }

      const totalCost = target.legs.reduce((sum, r) => sum + predCostCny(r), 0);
      const pctRaw = Number(prefs?.minExtraProfitPct);
      const should = decideArbEarlyLockSell({
        enabled: true,
        minExtraProfitPct: Number.isFinite(pctRaw) ? pctRaw : 0,
        lockedProfitCny: target.lockedProfitCny,
        sellBothProceedsCny: sellBoth,
        totalCostCny: totalCost,
      });
      if (!should) {
        cooldownUntil.set(
          target.cooldownKey,
          now + Math.min(15_000, ARB_EARLY_LOCK_COOLDOWN_MS),
        );
        continue;
      }

      cooldownUntil.set(target.cooldownKey, now + ARB_EARLY_LOCK_COOLDOWN_MS);

      const results: boolean[] = [];
      for (const leg of target.legs)
        results.push(await sellPredLeg(accountStore, leg));

      const okCount = results.filter(Boolean).length;
      if (okCount === target.legs.length) {
        soldGroups += 1;
        notify(
          "提前锁利",
          `Link ${target.linkId} 双边预测市场同卖净利优于锁定，已全部卖出`,
        );
      }
      else if (okCount > 0) {
        // 部分成功 = 暂时单边，必须刷新订单并提示手处理
        notify(
          "提前锁利部分失败",
          `Link ${target.linkId} 仅 ${okCount}/${target.legs.length} 腿卖出成功，请手动处理剩余`,
        );
      }
      else {
        notify("提前锁利失败", `Link ${target.linkId} 双边卖出均未成功`);
      }

      if (okCount > 0) {
        for (const leg of target.legs) {
          const account = accountStore.findAccount(Number(leg.PlayerID));
          if (!account)
            continue;
          try {
            await accountStore.refreshBalance(account);
          }
          catch { /* ignore */ }
        }
        try {
          await useOrderStore().fetchOrders();
        }
        catch { /* ignore */ }
      }
    }
  }
  catch {
    /* never break main loop */
  }
  finally {
    scanInFlight = false;
  }
  return soldGroups;
}
