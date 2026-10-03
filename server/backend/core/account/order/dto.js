/**
 * 订单读路径 DTO：RDS 行 → 工作台 / 管理端形状。
 * 不写库。由 order_store.js re-export，对外路径不变。
 */
import { placeholderLinkFromCreateAt } from "@changmen/db";
import { computePfHoldShares } from "../../integrations/predictfun/pf_fee.js";
import { isPredictionSellForCount } from "./kinds.js";
import { readPositionSellEvents } from "./position_events.js";

/** @internal 与 save 路径共用；暂放 dto，后续可再抽 util */
export function parseNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** @internal raw / 入参 → win|lose；其它返回 undefined */
export function normalizePmMatchResult(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "win" || s === "lose")
    return s;
  return undefined;
}

export function resolveStoredLink(link, _orderId, createAt) {
  const n = Number(link);
  if (Number.isFinite(n) && n !== 0)
    return n;
  return placeholderLinkFromCreateAt(createAt);
}

/**
 * PF 买单真实持仓份额（对齐官网）：成交 wei − SHARES 手续费 wei。
 * 卖单不计算。读路径即时推算；优先已落库 pfHoldShares。
 */
export function resolvePfHoldSharesFromRaw(raw) {
  if (!raw || typeof raw !== "object")
    return undefined;
  if (String(raw.pfSide ?? raw.PfSide ?? "").toLowerCase() === "sell")
    return undefined;
  const stored = parseNum(raw.pfHoldShares ?? raw.PfHoldShares, 0);
  if (stored > 0)
    return stored;
  const hold = computePfHoldShares({
    pfSide: "buy",
    pfShares: raw.pfShares ?? raw.PfShares,
    pfSharesWei: raw.pfSharesWei ?? raw.PfSharesWei,
    pfFeeType: raw.pfFeeType ?? raw.PfFeeType,
    pfFeeAmountWei: raw.pfFeeAmountWei ?? raw.PfFeeAmountWei,
  });
  if (hold != null && hold > 0)
    return hold;
  const shares = parseNum(raw.pfShares ?? raw.PfShares, 0);
  return shares > 0 ? shares : undefined;
}

/** 工作台 Client_GetOrder / 管理端 mapAdminOrderRow 共用，勿分叉 */
export function rowToOrder(r) {
  const raw = r.raw && typeof r.raw === "object" && !Array.isArray(r.raw) ? r.raw : {};
  let betMoney = r.bet_money || 0;
  let money = r.money || 0;
  const pfHoldShares = resolvePfHoldSharesFromRaw(raw);
  // 按 provider 判卖单（对齐 kinds / order_store），避免 PF 买单误带 pmSide=sell 时清零盈亏
  if (isPredictionSellForCount({ provider: r.provider, raw }))
    money = 0;
  return {
    OrderID: r.order_id,
    Link: resolveStoredLink(r.link, r.order_id, r.create_at),
    Type: r.provider || "",
    Match: r.match || "",
    Bet: r.bet || "",
    Item: r.item || "",
    Odds: r.odds || 0,
    BetMoney: betMoney,
    Money: money,
    Status: r.status || "None",
    CreateAt: r.create_at || 0,
    PlayerID: Number(r.player_id) || 0,
    Player: {
      Platform: r.provider || "",
      UserName: "",
      Status: r.status || "None",
    },
    Domain: raw.domain ? String(raw.domain) : undefined,
    Sport: raw.sport ? String(raw.sport) : undefined,
    Source: raw.source ? String(raw.source) : undefined,
    PodClientId: raw.podClientId ? String(raw.podClientId) : undefined,
    PodRayMatchId: raw.podRayMatchId ? String(raw.podRayMatchId) : undefined,
    PodMarketCode: raw.podMarketCode ? String(raw.podMarketCode) : undefined,
    PodBoardSide: raw.podBoardSide ? String(raw.podBoardSide) : undefined,
    PodPmMatchId: raw.podPmMatchId ? String(raw.podPmMatchId) : undefined,
    Game: raw.game ? String(raw.game) : undefined,
    PmTokenId: raw.pmTokenId ? String(raw.pmTokenId) : undefined,
    PmShares: parseNum(raw.pmShares, 0) || undefined,
    PmFillPrice: (() => {
      const price = parseNum(raw.pmFillPrice, 0);
      return price > 0 && price < 1 ? price : undefined;
    })(),
    PmStakeUsdc: parseNum(raw.pmStakeUsdc, 0) || undefined,
    PmFeeUsdc: (() => {
      const n = parseNum(raw.pmFeeUsdc ?? raw.PmFeeUsdc, NaN);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    })(),
    PmConditionId: raw.pmConditionId ? String(raw.pmConditionId) : undefined,
    PmOrigin: raw.pmOrigin === "changmen" || raw.pmOrigin === "external"
      ? raw.pmOrigin
      : undefined,
    PmAttributedSellShares: parseNum(raw.pmAttributedSellShares, 0) || undefined,
    PmRealizedPnlUsdc: parseNum(raw.pmRealizedPnlUsdc, 0) || undefined,
    PmSellProceeds: (() => {
      const n = parseNum(raw.pmSellProceeds, NaN);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    })(),
    PmLastSellOrderId: raw.pmLastSellOrderId ? String(raw.pmLastSellOrderId) : undefined,
    PmSellState: raw.pmSellState === "open"
      || raw.pmSellState === "partial"
      || raw.pmSellState === "closed"
      || raw.pmSellState === "settled"
      ? raw.pmSellState
      : undefined,
    PmSide: raw.pmSide === "buy" || raw.pmSide === "sell" ? raw.pmSide : undefined,
    PmBuyOrderId: raw.pmBuyOrderId ? String(raw.pmBuyOrderId) : undefined,
    PmMatchResult: (() => {
      const m = normalizePmMatchResult(raw.pmMatchResult);
      return m === "win" ? "Win" : m === "lose" ? "Lose" : undefined;
    })(),
    /** [changmen 扩展] PredictFun 1:1 买卖 */
    PfSide: raw.pfSide === "buy" || raw.pfSide === "sell" ? raw.pfSide : undefined,
    PfBuyOrderId: raw.pfBuyOrderId ? String(raw.pfBuyOrderId) : undefined,
    PfSellState: raw.pfSellState === "open"
      || raw.pfSellState === "closing"
      || raw.pfSellState === "closed"
      || raw.pfSellState === "settled"
      ? raw.pfSellState
      : undefined,
    PfShares: parseNum(raw.pfShares, 0) || undefined,
    /** 官网持仓口径（扣 SHARES 手续费）；侧栏份额优先读此字段 */
    PfHoldShares: pfHoldShares,
    /**
     * 名义买入 USDT（限价×成交份额 / makerAmount，如 14.12）
     * 用户扣款与侧栏「买入金额」优先读此字段；实付成交额在 PfFillCostUsdt（如 13.68）
     */
    PfNotionalUsdt: (() => {
      const n = parseNum(raw.pfNotionalUsdt, 0);
      return n > 0 ? n : undefined;
    })(),
    /** 链上/官方实付成交额（可低于名义；差额归 house） */
    PfFillCostUsdt: (() => {
      const n = parseNum(raw.pfFillCostUsdt, 0);
      return n > 0 ? n : undefined;
    })(),
    /** 买入限价/盘口价 (0,1) */
    PfBookPrice: (() => {
      const n = parseNum(raw.pfBookPrice, 0);
      return n > 0 && n < 1 ? n : undefined;
    })(),
    PfTokenId: raw.pfTokenId ? String(raw.pfTokenId) : undefined,
    PfMarketId: raw.pfMarketId ? String(raw.pfMarketId) : undefined,
    PfSellOrderId: raw.pfSellOrderId ? String(raw.pfSellOrderId) : undefined,
    PfSellProceeds: (() => {
      const n = parseNum(raw.pfSellProceeds, NaN);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    })(),
    PfFeeAmountWei: raw.pfFeeAmountWei ? String(raw.pfFeeAmountWei) : undefined,
    PfFeeType: raw.pfFeeType === "SHARES" || raw.pfFeeType === "COLLATERAL"
      ? raw.pfFeeType
      : undefined,
    PfFeeUsdt: parseNum(raw.pfFeeUsdt, 0) || undefined,
    PfFeeRateBps: (() => {
      const n = parseNum(raw.pfFeeRateBps, NaN);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    })(),
    /** Changmencodefee：买入扣份额 / 卖出扣 USDT */
    PfChangmenCodeFeeRateBps: (() => {
      const n = parseNum(raw.pfChangmenCodeFeeRateBps, NaN);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    })(),
    PfChangmenCodeFeeShares: (() => {
      const n = parseNum(raw.pfChangmenCodeFeeShares, 0);
      return n > 0 ? n : undefined;
    })(),
    PfChangmenCodeFeeUsdt: (() => {
      const n = parseNum(raw.pfChangmenCodeFeeUsdt, 0);
      return n > 0 ? n : undefined;
    })(),
    /** [changmen 扩展] Phase 1 仓位卖出事件（买单上；便于 UI 观察双写） */
    PositionEvents: (() => {
      const sells = readPositionSellEvents(raw);
      return sells.length ? { sells } : undefined;
    })(),
  };
}

/**
 * 工作台下发订单：去掉 house 成交额 / 手续费明细（价差可由此反推）。
 * PredictFun：closing 对外折叠为 open（见 pf_lifecycle.js）。
 * 管理端 mapAdminOrderRow / listByPlayer 仍用完整 rowToOrder。
 */
export function scrubClientOrder(order) {
  if (!order || typeof order !== "object")
    return order;
  const {
    PfFillCostUsdt: _fill,
    PfFeeAmountWei: _wei,
    PfFeeType: _feeType,
    PfFeeUsdt: _feeUsdt,
    PfFeeRateBps: _bps,
    PfChangmenCodeFeeRateBps: _cmRate,
    PfChangmenCodeFeeShares: _cmShares,
    PfChangmenCodeFeeUsdt: _cmUsdt,
    ...rest
  } = order;
  if (String(rest.Type ?? "").trim() === "PredictFun") {
    const rawState = String(rest.PfSellState ?? "").toLowerCase();
    if (rawState === "closing")
      rest.PfSellState = "open";
  }
  return rest;
}

export function toClientOrder(r) {
  return scrubClientOrder(rowToOrder(r));
}
