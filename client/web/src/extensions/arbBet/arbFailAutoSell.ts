/**
 * [changmen 扩展] 套利失败敞口自动减仓。
 *
 * 触发（须开启 `extensionPrefs.arbFailAutoSell`）：
 * - finalize：一腿 PM/PF 已确认成交，对侧拒单/失败，且未能入补单队列
 * - 补单放弃：LoseOrder 出队且未补成（match 消失 / betting 返回 null / 用户手动取消）
 *
 * 不做止盈；9999 单边故意敞口不触发。
 */
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { ArbFailAutoSellPrefs } from "@/types/extensionPrefs";
import type { OrderRow } from "@/types/order";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbBetPlaced } from "@/stores/betting/autoBet/phases/types";
import type { ArbLegSettleSnapshot } from "@/stores/betting/autoBet/phases/settleBothArbLegs";
import type { ArbMakeUpEnqueueResult } from "@/stores/betting/autoBet/arbMakeUpFromRejects";
import {
  isPolymarketProvider,
  isPredictFunProvider,
  isPredictionMarketUsdtStakeProvider,
} from "@changmen/shared/account_multiply";
import {
  hasOpenPolymarketPosition,
  resolvePmRemainingShares,
  sellPolymarketBuyPosition,
  pmSubmitScope,
  type OrderRowLike,
} from "@changmen/venue-adapter/polymarket";
import { pfSubmitSell } from "@changmen/venue-adapter/predictfun";
import { saveOrders } from "@/api/order";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { a8Tip } from "@/shared/a8Notify";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/orderModes/fok/financialOrders";
import { useUserStore } from "@/stores/userStore";
import { canManualSellPfBuy } from "@/stores/account/pfManualSell";
import { canManualSellPmBuy } from "@/stores/account/pmManualSell";
import { beginArbAutoSell, endArbAutoSell } from "@/extensions/arbBet/arbAutoSellLock";

export type ArbFailAutoSellSide = "A" | "B";

export interface ArbFailAutoSellDecisionInput {
  enabled: boolean;
  betBothLegs: boolean;
  singleLegByRate: boolean;
  providerA: string;
  providerB: string;
  /** 已确认成交（非拒、非 pending） */
  okA: boolean;
  okB: boolean;
  pendingConfirmA: boolean;
  pendingConfirmB: boolean;
  makeupEnqueuedA: boolean;
  makeupEnqueuedB: boolean;
}

export interface ArbFailAutoSellDecision {
  sellSide: ArbFailAutoSellSide;
  provider: string;
}

function readArbFailAutoSellPrefs(
  prefs?: ArbFailAutoSellPrefs | null,
): ArbFailAutoSellPrefs | undefined {
  if (prefs)
    return prefs;
  try {
    return useUserStore().extensionPrefs?.arbFailAutoSell;
  }
  catch {
    return undefined;
  }
}

export function isArbFailAutoSellEnabled(
  prefs: ArbFailAutoSellPrefs | undefined | null,
): boolean {
  return prefs?.enabled === true;
}

/** 纯判定：是否应对某侧 PM/PF 成交腿市价减仓 */
export function decideArbFailAutoSell(
  input: ArbFailAutoSellDecisionInput,
): ArbFailAutoSellDecision | null {
  if (!input.enabled)
    return null;
  if (!input.betBothLegs || input.singleLegByRate)
    return null;
  if (input.pendingConfirmA || input.pendingConfirmB)
    return null;
  if (input.makeupEnqueuedA || input.makeupEnqueuedB)
    return null;
  if (input.okA && input.okB)
    return null;

  if (
    input.okA
    && !input.okB
    && isPredictionMarketUsdtStakeProvider(input.providerA)
  ) {
    return { sellSide: "A", provider: input.providerA };
  }
  if (
    input.okB
    && !input.okA
    && isPredictionMarketUsdtStakeProvider(input.providerB)
  ) {
    return { sellSide: "B", provider: input.providerB };
  }
  return null;
}

function pickFilledPredictionBuy(
  orders: VenueOrder[],
  preferredOrderId: string,
): VenueOrder | undefined {
  const preferred = preferredOrderId.trim().toLowerCase();
  const buys = orders.filter((o) => {
    const provider = String(o.provider ?? "").trim();
    if (!isPredictionMarketUsdtStakeProvider(provider))
      return false;
    if (o.pmSide === "sell" || o.pfSide === "sell")
      return false;
    const st = String(o.status ?? "none").toLowerCase();
    if (st === "reject" || st === "lose" || st === "win")
      return false;
    if (isPolymarketProvider(provider)) {
      if (resolvePmRemainingShares(o) <= 0.0001 && !hasOpenPolymarketPosition(o))
        return false;
    }
    if (isPredictFunProvider(provider)) {
      if (o.pfSellState === "closed" || o.pfSellState === "settled")
        return false;
    }
    return true;
  });
  if (!buys.length)
    return undefined;
  if (preferred) {
    const hit = buys.find(o => String(o.orderId ?? "").trim().toLowerCase() === preferred);
    if (hit)
      return hit;
  }
  return buys[0];
}

async function sellPmBuy(
  account: PlatformAccount,
  buy: VenueOrder | OrderRow,
): Promise<{ ok: boolean; error?: string }> {
  const orderId = "orderId" in buy && buy.orderId != null
    ? String(buy.orderId).trim()
    : String((buy as OrderRow).OrderID ?? "").trim();
  if (!orderId)
    return { ok: false, error: "缺少 orderId" };
  if (!beginArbAutoSell(orderId))
    return { ok: false, error: "卖出进行中" };
  try {
    const { trackPmManualSellClosing, clearPmManualSellClosing } = await import("@/stores/account/pmManualSell");
    const sessionVersion = getAuthSessionVersion();
    const scope = pmSubmitScope(account);
    const current = () => isAuthSessionCurrent(sessionVersion) && scope === pmSubmitScope(account);
    const result = await sellPolymarketBuyPosition({
      account,
      buyRow: buy as VenueOrder | OrderRowLike,
      onSubmitted: (info) => {
        if (current()) trackPmManualSellClosing(orderId, info, account);
      },
    });
    if (!current()) return { ok: false, error: "用户或钱包已改变，原卖单保留待确认" };
    if (!result.ok) {
      if (result.unfilled)
        clearPmManualSellClosing(orderId);
      return { ok: false, error: result.error ?? "PM 卖出失败" };
    }
    if (result.ordersToSave?.length) {
      try {
        await saveOrders(account, result.ordersToSave);
        if (current()) clearPmManualSellClosing(orderId);
      }
      catch (err) {
        return {
          ok: false,
          error: `链上已卖，落库失败：${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    else {
      clearPmManualSellClosing(orderId);
    }
    return { ok: true };
  }
  catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  finally {
    endArbAutoSell(orderId);
  }
}

async function sellPfBuy(
  account: PlatformAccount,
  buyOrderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const orderId = String(buyOrderId ?? "").trim();
  if (!orderId)
    return { ok: false, error: "缺少 orderId" };
  if (!beginArbAutoSell(orderId))
    return { ok: false, error: "卖出进行中" };
  try {
    await pfSubmitSell(account, orderId);
    return { ok: true };
  }
  catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  finally {
    endArbAutoSell(orderId);
  }
}

function notify(
  setMessage: ((msg: string) => void) | undefined,
  title: string,
  message: string,
): void {
  setMessage?.(message);
  try {
    a8Tip(title, message, 4000);
  }
  catch {
    /* ignore UI */
  }
}

/** finalize 收尾：按判定卖掉成交侧 PM/PF */
export async function maybeArbFailAutoSellAfterFinalize(params: {
  placed: ArbBetPlaced;
  settle: ArbLegSettleSnapshot;
  makeup: ArbMakeUpEnqueueResult;
  setMessage?: (msg: string) => void;
  prefs?: ArbFailAutoSellPrefs | null;
}): Promise<boolean> {
  try {
    const prefs = readArbFailAutoSellPrefs(params.prefs);
    const { placed, settle, makeup, setMessage } = params;
    const providerA = String(placed.accountA?.provider ?? placed.legA.type ?? "");
    const providerB = String(placed.accountB?.provider ?? placed.legB.type ?? "");
    const okA = Boolean(
      placed.resultA?.success && placed.accountA && !settle.rejectA && !settle.pendingConfirmA,
    );
    const okB = Boolean(
      placed.resultB?.success && placed.accountB && !settle.rejectB && !settle.pendingConfirmB,
    );

    const decision = decideArbFailAutoSell({
      enabled: isArbFailAutoSellEnabled(prefs),
      betBothLegs: placed.betBothLegs,
      singleLegByRate: placed.singleLegByRate,
      providerA,
      providerB,
      okA,
      okB,
      pendingConfirmA: settle.pendingConfirmA,
      pendingConfirmB: settle.pendingConfirmB,
      makeupEnqueuedA: makeup.enqueuedForLegA,
      makeupEnqueuedB: makeup.enqueuedForLegB,
    });
    if (!decision)
      return false;

    const account = decision.sellSide === "A" ? placed.accountA : placed.accountB;
    const orders = decision.sellSide === "A" ? settle.ordersA : settle.ordersB;
    const result = decision.sellSide === "A" ? placed.resultA : placed.resultB;
    if (!account)
      return false;

    const buy = pickFilledPredictionBuy(orders, String(result?.orderId ?? ""));
    const orderId = String(buy?.orderId ?? result?.orderId ?? "").trim();
    if (!orderId) {
      notify(setMessage, "套利减仓", "需减仓但找不到预测市场买单");
      return false;
    }

    let out: { ok: boolean; error?: string };
    if (isPolymarketProvider(decision.provider)) {
      if (!buy) {
        notify(setMessage, "套利减仓", "需减仓但找不到 PM 买单");
        return false;
      }
      out = await sellPmBuy(account, buy);
    }
    else if (isPredictFunProvider(decision.provider)) {
      out = await sellPfBuy(account, orderId);
    }
    else {
      return false;
    }

    try {
      await useOrderStore().fetchOrders();
    }
    catch { /* ignore */ }
    try {
      await useAccountStore().refreshBalance(account);
    }
    catch { /* ignore */ }

    if (out.ok) {
      notify(
        setMessage,
        "套利减仓",
        `${decision.provider} 对侧失败且未补单，已自动卖出 ${orderId}`,
      );
      return true;
    }
    notify(
      setMessage,
      "套利减仓失败",
      out.error ?? `${decision.provider} 自动卖出失败`,
    );
    return false;
  }
  catch {
    return false;
  }
}

function collectOpenPredictionBuysByLink(linkId: number): OrderRow[] {
  if (!(Number.isFinite(linkId) && linkId !== 0))
    return [];
  const orderStore = useOrderStore();
  const out: OrderRow[] = [];
  const seen = new Set<string>();
  const tryAdd = (row: OrderRow) => {
    const id = String(row.OrderID ?? "").trim();
    if (!id || seen.has(id))
      return;
    if (!(canManualSellPmBuy(row) || canManualSellPfBuy(row)))
      return;
    seen.add(id);
    out.push(row);
  };
  for (const [key, rows] of orderStore.orders) {
    if (Number(key) === linkId) {
      for (const row of rows)
        tryAdd(row);
      continue;
    }
    for (const row of rows) {
      if (Number(row.Link) === linkId)
        tryAdd(row);
    }
  }
  return out;
}

/**
 * 补单放弃后：按 Link 卖掉仍敞口的 PM/PF 买单。
 * 调用方保证「未补成」；成功补单出队勿调用。
 */
export async function maybeArbFailAutoSellByLink(params: {
  linkId: number;
  setMessage?: (msg: string) => void;
  reason?: string;
  prefs?: ArbFailAutoSellPrefs | null;
}): Promise<boolean> {
  try {
    const prefs = readArbFailAutoSellPrefs(params.prefs);
    if (!isArbFailAutoSellEnabled(prefs))
      return false;
    const linkId = Number(params.linkId);
    if (!(Number.isFinite(linkId) && linkId !== 0))
      return false;

    const buys = collectOpenPredictionBuysByLink(linkId);
    if (!buys.length)
      return false;

    const accountStore = useAccountStore();
    let anyOk = false;
    for (const row of buys) {
      const account = accountStore.findAccount(Number(row.PlayerID));
      if (!account) {
        notify(params.setMessage, "套利减仓失败", "找不到对应预测市场账号");
        continue;
      }
      const orderId = String(row.OrderID ?? "").trim();
      const type = String(row.Type ?? "").trim();
      let out: { ok: boolean; error?: string };
      if (type === "Polymarket")
        out = await sellPmBuy(account, row);
      else if (type === "PredictFun")
        out = await sellPfBuy(account, orderId);
      else
        continue;

      if (out.ok) {
        anyOk = true;
        notify(
          params.setMessage,
          "套利减仓",
          `${params.reason ? `${params.reason}：` : ""}${type} 已自动卖出 ${orderId}`,
        );
      }
      else {
        notify(
          params.setMessage,
          "套利减仓失败",
          out.error ?? `${type} 自动卖出失败`,
        );
      }
    }

    if (anyOk) {
      try {
        await useOrderStore().fetchOrders();
      }
      catch { /* ignore */ }
    }
    return anyOk;
  }
  catch {
    return false;
  }
}
