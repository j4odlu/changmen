import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { accountPassesMainBetFilter } from "@/domain/betting/betFilters";
import { isSingleLegRateAtOdds } from "@/domain/betting/singleLegRate";
import { isMapMuteActive } from "@/extensions/mapBetMute";
import { isPrematchFullMarketAllowed } from "@/extensions/prematchFullOnly";
import {
  computeValueBetEdge,
  isValueBetPositiveEdge,
  type ValueBetEdgeSnapshot,
} from "@/extensions/valueBet/computeValueBetEdge";
import { calcEdge } from "@/extensions/valueBet/evCalc";
import { getValueBetMapCount, recordValueBetMapFill } from "@/extensions/valueBet/valueBetMapCount";
import {
  evaluateValueBetPlaceSafety,
  type ValueBetPlaceBlock,
} from "@/extensions/valueBet/valueBetPlaceSafety";
import type { ValueBetCalcOpts } from "@/extensions/valueBet/evConfig";
import { BetOption } from "@changmen/client-core/models/betOption";
import { createValueBetLinkId } from "@changmen/client-core/shared/format";
import { wait } from "@changmen/client-core/shared/wait";
import { manualBetToastSeconds } from "@/shared/betTiming";
import { useAccountStore } from "@/stores/accountStore";
import {
  bindArbLegOrder,
  refreshOrderListAfterBind,
} from "@/stores/betting/arbOrderBind";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";
import { useMatchStore } from "@/stores/matchStore";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { buildPolymarketMatchedBuyVenueOrderFromBet } from "@changmen/venue-adapter/polymarket";

export type PlaceValueBetFailCode =
  | "gone"
  | "no_account"
  | "rate_9999"
  | "filter"
  | "balance"
  | "check_fail"
  | "place_fail"
  | "busy"
  | "muted"
  | "map_limit";

export type PlaceValueBetResult =
  | {
    ok: true;
    pending: boolean;
    bound: boolean;
    edge: number;
    odds: number;
    type: string;
  }
  | {
    ok: false;
    code: PlaceValueBetFailCode;
    message?: string;
    snap?: ValueBetEdgeSnapshot;
    amount?: number;
  };

let placeInFlight = false;

export function isValueBetPlaceInFlight(): boolean {
  return placeInFlight;
}

export interface ValueBetAutoPlaceGate {
  minEdge: number;
  maxEdge: number;
  minOdds: number;
  maxOdds: number;
  maxPerMap: number;
}

export interface PlaceValueBetParams {
  match: ViewMatch;
  bet: ViewBet;
  item: ViewBetItem;
  side: BetSide;
  amount: number;
  calcOpts: Pick<ValueBetCalcOpts, "sharp" | "softPlatforms">;
  minEdge: number;
  /** 自动下单无 toast；确认下单沿用手动 toast 秒数 */
  silent?: boolean;
  /** 自动：预检前后再核 EV 区间、基准赔率区间、同图次数 */
  autoGate?: ValueBetAutoPlaceGate;
  /** 确认：自动已开时传入同图上限，避免弹窗期间自动先下、确认再下一笔 */
  mapLimit?: number;
}

/**
 * [changmen 扩展] 正 EV 单边落单（确认 / 自动共用）。
 * 不弹窗；调用方按 code 提示。成功后记同图次数并绑 💎。
 */
const PLACE_LOCK_NAME = "changmen-valueBetPlace";

export async function placeValueBetOrder(params: PlaceValueBetParams): Promise<PlaceValueBetResult> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    try {
      return await locks.request(PLACE_LOCK_NAME, () => placeValueBetOrderLocked(params));
    }
    catch {
      return placeValueBetOrderLocked(params);
    }
  }
  return placeValueBetOrderLocked(params);
}

async function placeValueBetOrderLocked(params: PlaceValueBetParams): Promise<PlaceValueBetResult> {
  if (placeInFlight)
    return { ok: false, code: "busy", message: "正 EV 下单进行中" };
  placeInFlight = true;
  try {
    return await placeValueBetOrderUnlocked(params);
  }
  finally {
    placeInFlight = false;
  }
}

function failCodeForPlaceBlock(block: ValueBetPlaceBlock): PlaceValueBetFailCode {
  if (block === "muted")
    return "muted";
  if (block === "map_limit")
    return "map_limit";
  if (block === "amount")
    return "place_fail";
  return "gone";
}

function evaluateLivePlaceSafety(
  params: PlaceValueBetParams,
  snap: ValueBetEdgeSnapshot,
): ValueBetPlaceBlock | null {
  const { match, bet, side, amount, minEdge, autoGate, mapLimit } = params;
  const maxPerMap = autoGate?.maxPerMap ?? mapLimit;
  return evaluateValueBetPlaceSafety({
    amount,
    edge: snap.edge,
    minEdge: autoGate?.minEdge ?? minEdge,
    maxEdge: autoGate?.maxEdge,
    muted: isMapMuteActive(match.id, bet.round, match.liveRound)
      || !isPrematchFullMarketAllowed(match, bet),
    checkMute: true,
    mapCount: getValueBetMapCount(match.id, bet.round),
    maxPerMap,
    checkMapLimit: Number.isFinite(maxPerMap),
    sharpOdds: side === "Home" ? snap.sharpHome : snap.sharpAway,
    minOdds: autoGate?.minOdds,
    maxOdds: autoGate?.maxOdds,
    checkOddsRange: autoGate != null,
  });
}

async function placeValueBetOrderUnlocked(params: PlaceValueBetParams): Promise<PlaceValueBetResult> {
  const { match, bet, item, side, amount, calcOpts, minEdge, silent } = params;
  if (!(Number.isFinite(amount) && amount > 0))
    return { ok: false, code: "place_fail", message: "金额无效", amount };

  let snap = computeValueBetEdge(bet, item, side, calcOpts);
  if (!snap || !isValueBetPositiveEdge(snap.edge, minEdge))
    return { ok: false, code: "gone", snap: snap ?? undefined, amount };

  const blocked = evaluateLivePlaceSafety(params, snap);
  if (blocked)
    return { ok: false, code: failCodeForPlaceBlock(blocked), snap, amount };

  const accountStore = useAccountStore();
  const matchStore = useMatchStore();
  const account = accountStore.getAccount(item.type, amount)
    ?? accountStore.getAccount(item.type, 0);
  if (!account)
    return { ok: false, code: "no_account" };
  const bal = account.getBalance();
  if (bal === undefined || bal < amount)
    return { ok: false, code: "balance", message: String(bal) };

  if (isSingleLegRateAtOdds(account, snap.softOdds))
    return { ok: false, code: "rate_9999" };

  let option = new BetOption(match, bet, item, side, amount);
  option.odds = snap.softOdds;
  if (!accountPassesMainBetFilter(account, bet, match, option, matchStore))
    return { ok: false, code: "filter" };

  const toastSec = silent ? 0 : manualBetToastSeconds();
  option = await accountStore.checkBetting(account, option);
  if (!option.data) {
    return {
      ok: false,
      code: "check_fail",
      message: option.checkError ? String(option.checkError) : undefined,
      snap,
      amount,
    };
  }

  const liveSnap = computeValueBetEdge(bet, item, side, calcOpts);
  if (!liveSnap)
    return { ok: false, code: "gone", snap, amount };
  const placeOdds = Number(option.odds);
  const softNow = item.getOdds(side);
  if (!softNow || !Number.isFinite(placeOdds) || placeOdds <= 1)
    return { ok: false, code: "gone", snap: liveSnap, amount };
  const edgeNow = calcEdge(placeOdds, liveSnap.fairOdds);
  snap = { ...liveSnap, softOdds: placeOdds, edge: edgeNow };
  const blockedAfterCheck = evaluateLivePlaceSafety(params, snap);
  if (blockedAfterCheck)
    return { ok: false, code: failCodeForPlaceBlock(blockedAfterCheck), snap, amount };
  if (isSingleLegRateAtOdds(account, placeOdds))
    return { ok: false, code: "rate_9999" };
  option.odds = placeOdds;
  if (!accountPassesMainBetFilter(account, bet, match, option, matchStore))
    return { ok: false, code: "filter" };

  const linkId = createValueBetLinkId();
  const result = await accountStore.betting(account, option, toastSec);
  if (!result?.success) {
    return {
      ok: false,
      code: "place_fail",
      message: result?.message || "下单失败",
      snap,
      amount,
    };
  }

  recordValueBetMapFill(match.id, bet.round);

  const skipMark = isPendingConfirmVenueProvider(account.provider) && result.pending;
  if (!skipMark)
    markSuccessfulBet(account, bet.id, side, option.odds);

  let bound = false;
  try {
    let orders: Awaited<ReturnType<typeof accountStore.updateVenueOrders>> = [];
    const provider = String(account.provider ?? "");
    const optimisticOk = Boolean(
      (result.tip as { pmOptimisticSaved?: boolean } | null | undefined)?.pmOptimisticSaved,
    );
    if (result.pending || provider !== "Polymarket") {
      await wait(result.orderId ? 400 : 1500);
      orders = (await accountStore.updateVenueOrders(account)) ?? [];
    }
    else if (!optimisticOk) {
      await wait(400);
      orders = (await accountStore.updateVenueOrders(account, {
        waitForOrderId: String(result.orderId ?? "").trim() || undefined,
      })) ?? [];
    }
    else {
      orders = (await accountStore.updateVenueOrders(account)) ?? [];
      const oid = String(result.orderId ?? "").trim();
      if (oid && !orders.some(o => String(o.orderId ?? "").trim() === oid)) {
        const synthetic = await buildPolymarketMatchedBuyVenueOrderFromBet(option, result);
        if (synthetic)
          orders = [synthetic, ...orders];
      }
    }
    bound = await bindArbLegOrder(linkId, account, result, orders, false);
    refreshOrderListAfterBind();
  }
  catch {
    bound = false;
  }

  if (!result.pending)
    void accountStore.refreshBalance(account);

  return {
    ok: true,
    pending: Boolean(result.pending),
    bound,
    edge: snap.edge,
    odds: option.odds,
    type: String(item.type),
  };
}
