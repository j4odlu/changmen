import type { LoseOrderCancelledRecord, OrderRow } from "@/types/order";
import type { LoseOrder } from "@/models/loseOrder";
import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";
import { hasOpenPolymarketPosition, resolvePmRemainingShares } from "@changmen/venue-adapter/polymarket";
import { formatLinkId, isSingleLegLink, orderLinkSortKey, toFixed } from "@changmen/client-core/shared/format";
import { Currency, getExchange } from "@changmen/shared/currency";
import { truncateShareUsdtAmount } from "@/shared/pfOrderDisplay";
import { makeupDisplayOdds } from "@/extensions/arbBet/makeupOddsBand";

/** 与 @changmen/db ARB_LINK_MIN 对齐：SaveOrderBind 的 Date.now() 毫秒时间戳 */
const ARB_LINK_MIN = 1_000_000_000_000;

/** [A8 可证实] 展示/筛选用 Link 数值；分组键见 `groupOrdersByLink` 直接用 `S.Link` */
export function linkIdGroupKey(link: number | null | undefined): number {
  const n = Number(link);
  return Number.isFinite(n) ? n : 0;
}

/**
 * [changmen 扩展] 按「时间序」降序：套利/9999 用 |Link|；
 * 正 EV 用 orderLinkSortKey 还原真实时间戳，避免 7e15 编码打乱排序。
 */
export function compareOrderLinkDesc(
  a: { Link?: number },
  b: { Link?: number },
): number {
  const aLink = orderLinkSortKey(a.Link);
  const bLink = orderLinkSortKey(b.Link);
  return aLink > bLink ? -1 : 1;
}

/** [A8 可证实] `T.sort((S,P)=>S.Link>P.Link?-1:1)` */
export function sortOrdersByLinkDesc<T extends { Link?: number }>(list: T[]): T[] {
  return [...list].sort(compareOrderLinkDesc);
}

/** [A8 可证实] `ft.groupBy(T, S=>S.Link)`（先 `T.sort` Link 降序） */
export function groupOrdersByLink<T extends { Link?: number }>(list: T[]): Map<number, T[]> {
  const sorted = sortOrdersByLinkDesc(list);
  const map = new Map<number, T[]>();
  for (const row of sorted) {
    const key = Number(row.Link);
    if (!map.has(key))
      map.set(key, []);
    map.get(key)!.push(row);
  }
  return map;
}

export function orderLinkMapEntries<T>(map: Map<number, T[]>): [number, T[]][] {
  return [...map.entries()];
}

const LOSE_REJECT = new Set(["Reject", "Return"]);

function isPolymarketOrderRow(row: OrderRow): boolean {
  return String(row.Type ?? "").trim() === "Polymarket";
}

function isPredictFunOrderRow(row: OrderRow): boolean {
  return String(row.Type ?? "").trim() === "PredictFun";
}

/** PM 仍有持仓；卖单永远不算持仓 */
export function isPolymarketOpenPosition(row: OrderRow): boolean {
  return hasOpenPolymarketPosition(row);
}

/** 侧栏订单行：展示全部腿（含 PM changmen 卖单） */
export function orderListDisplayRows(rows: OrderRow[]): OrderRow[] {
  return rows.filter(r => !isMakeupCancelledOrderRow(r));
}

function predictionSellParentBuyId(row: OrderRow): string {
  if (isPolymarketOrderRow(row) && row.PmSide === "sell")
    return String(row.PmBuyOrderId ?? "").trim().toLowerCase();
  if (isPredictFunOrderRow(row) && row.PfSide === "sell")
    return String(row.PfBuyOrderId ?? "").trim().toLowerCase();
  return "";
}

/** PM/PF 卖单（依附买单展示，笔数统计不计） */
export function isPredictionSellRow(row: OrderRow): boolean {
  if (isPolymarketOrderRow(row) && row.PmSide === "sell")
    return true;
  if (isPredictFunOrderRow(row) && row.PfSide === "sell")
    return true;
  return false;
}

/** 订单笔数：排除 PM/PF 卖单行（买卖成对只计买单/场馆腿） */
export function countPrimaryOrderRows(rows: Iterable<OrderRow>): number {
  let n = 0;
  for (const row of rows) {
    if (!isPredictionSellRow(row))
      n += 1;
  }
  return n;
}

function isPredictionBuyRow(row: OrderRow): boolean {
  if (isPolymarketOrderRow(row) && row.PmSide !== "sell")
    return true;
  if (isPredictFunOrderRow(row) && row.PfSide !== "sell")
    return true;
  return false;
}

/**
 * [changmen 扩展] 展示用有效 Link：PM/PF 卖单跟父买单（PmBuyOrderId / PfBuyOrderId）。
 * 卖单自带 Link 只是镜像，可能与买单分叉；分组前须对齐，软附属才能跨原 Link 挂上。
 * 不改落库；父买单不在 peers 时保持原 Link。
 */
export function effectiveOrderLink(row: OrderRow, peers: OrderRow[]): number {
  if (isPredictionSellRow(row)) {
    const buyId = predictionSellParentBuyId(row);
    if (buyId) {
      const buy = peers.find(r =>
        isPredictionBuyRow(r)
        && String(r.OrderID ?? "").trim().toLowerCase() === buyId,
      );
      const buyLink = Number(buy?.Link);
      if (Number.isFinite(buyLink))
        return buyLink;
    }
  }
  const n = Number(row.Link);
  return Number.isFinite(n) ? n : 0;
}

/**
 * [changmen 扩展] 分组前把同页卖单 Link 对齐到父买单（浅拷贝，不改原数组元素引用以外的源）。
 */
export function alignPredictionSellLinksToBuys<T extends OrderRow>(rows: T[]): T[] {
  if (!rows.length)
    return rows;
  const buyById = new Map<string, T>();
  for (const r of rows) {
    if (!isPredictionBuyRow(r))
      continue;
    const id = String(r.OrderID ?? "").trim().toLowerCase();
    if (id)
      buyById.set(id, r);
  }
  if (!buyById.size)
    return rows;

  let changed = false;
  const out = rows.map((r) => {
    if (!isPredictionSellRow(r))
      return r;
    const buyId = predictionSellParentBuyId(r);
    if (!buyId)
      return r;
    const buy = buyById.get(buyId);
    if (!buy)
      return r;
    const buyLink = Number(buy.Link);
    if (!Number.isFinite(buyLink))
      return r;
    if (Number(r.Link) === buyLink)
      return r;
    changed = true;
    return { ...r, Link: buyLink };
  });
  return changed ? out : rows;
}

/**
 * [changmen 扩展] 对齐卖单 Link 后再按 Link 分组（侧栏 / 管理端共用）。
 */
export function groupOrdersByEffectiveLink<T extends OrderRow>(list: T[]): Map<number, T[]> {
  return groupOrdersByLink(alignPredictionSellLinksToBuys(list));
}

/**
 * [changmen 扩展] 订单栏方案 A：PM/PF 卖单在 UI 上挂到对应买单下（软附属）。
 * 展示优先买单 positionEvents.sells，缺事件 id 再回退卖单行；同 id 不双显。
 * 不改落库/盈亏；无父买单的孤儿卖单仍顶层展示。
 * 调用方须保证同组内买卖 Link 已对齐（见 alignPredictionSellLinksToBuys）。
 */
export type OrderListDisplayBlock = {
  key: string;
  row: OrderRow;
  /** true = 嵌在买单下的卖出记录 */
  attach: boolean;
  /** attach 时：事件优先 / 卖单行回退 */
  sellSource?: "event" | "row";
};

type PositionSellEvent = NonNullable<NonNullable<OrderRow["PositionEvents"]>["sells"]>[number];

function orderIdKey(id: unknown): string {
  return String(id ?? "").trim().toLowerCase();
}

/** 事件 → 展示用卖单行；回款优先 event.proceeds，影子卖单 BetMoney 仅兜底 */
export function synthesizeSellRowFromPositionEvent(
  buy: OrderRow,
  event: PositionSellEvent,
  sellRow?: OrderRow,
): OrderRow {
  const id = String(event.id ?? "").trim();
  const at = Number(event.at) || Number(sellRow?.CreateAt) || Number(buy.CreateAt) || 0;
  const shares = Number(event.shares);
  const price = Number(event.price);
  const proceeds = Number(event.proceeds);
  const pnl = Number(event.pnl);
  const origin = event.origin === "external" || event.origin === "changmen"
    ? event.origin
    : undefined;
  const hasEventProceeds = Number.isFinite(proceeds) && proceeds >= 0;

  if (isPredictFunOrderRow(buy) || (sellRow != null && isPredictFunOrderRow(sellRow))) {
    const proceedsUsdt = hasEventProceeds ? proceeds : 0;
    // Phase 1：事件回款优先；无事件 proceeds 时才用影子卖单行 BetMoney（deprecated）
    const betMoney = hasEventProceeds
      ? proceedsUsdt
      : (Number(sellRow?.BetMoney) || 0);
    return {
      ...(sellRow ?? {
        Match: buy.Match,
        Bet: buy.Bet,
        Item: buy.Item,
        Link: buy.Link,
        PlayerID: buy.PlayerID,
        Status: "None",
      }),
      OrderID: id || sellRow?.OrderID,
      Type: "PredictFun",
      CreateAt: at,
      PfSide: "sell",
      PfBuyOrderId: String(buy.OrderID ?? ""),
      PfShares: Number.isFinite(shares) ? shares : sellRow?.PfShares,
      PfBookPrice: Number.isFinite(price) && price > 0 ? price : sellRow?.PfBookPrice,
      BetMoney: betMoney,
      Money: 0,
      PfSellState: "closed",
      // 与 PM PmStakeUsdc 对齐：事件回款挂在卖出行，供 pfOrderStakeDisplayCny 优先读取
      ...(hasEventProceeds && proceedsUsdt > 0 ? { PfSellProceeds: proceedsUsdt } : {}),
    };
  }

  // Polymarket（默认）
  const proceedsUsdc = hasEventProceeds ? proceeds : 0;
  const fx = getExchange(Currency.USDT);
  const betFromEvent = proceedsUsdc > 0 && fx > 0
    ? Math.round(proceedsUsdc * fx)
    : 0;
  // Phase 1：事件回款优先；无事件 proceeds 时才用影子卖单行 BetMoney（deprecated）
  const betMoney = hasEventProceeds
    ? betFromEvent
    : (Number(sellRow?.BetMoney) || 0);
  return {
    ...(sellRow ?? {
      Match: buy.Match,
      Bet: buy.Bet,
      Item: buy.Item,
      Link: buy.Link,
      PlayerID: buy.PlayerID,
      Status: "None",
    }),
    OrderID: id || sellRow?.OrderID,
    Type: "Polymarket",
    CreateAt: at,
    PmSide: "sell",
    PmBuyOrderId: String(buy.OrderID ?? ""),
    PmShares: Number.isFinite(shares) ? shares : sellRow?.PmShares,
    PmFillPrice: Number.isFinite(price) && price > 0 && price < 1 ? price : sellRow?.PmFillPrice,
    PmStakeUsdc: hasEventProceeds && proceedsUsdc > 0
      ? proceedsUsdc
      : sellRow?.PmStakeUsdc,
    PmRealizedPnlUsdc: Number.isFinite(pnl) ? pnl : sellRow?.PmRealizedPnlUsdc,
    PmOrigin: origin ?? sellRow?.PmOrigin,
    BetMoney: betMoney,
    Money: 0,
  };
}

function attachedSellsForBuy(
  buy: OrderRow,
  sellRows: OrderRow[],
): Array<{ row: OrderRow; sellSource: "event" | "row" }> {
  const events = Array.isArray(buy.PositionEvents?.sells) ? buy.PositionEvents!.sells! : [];
  const eventById = new Map<string, PositionSellEvent>();
  for (const ev of events) {
    const id = orderIdKey(ev?.id);
    if (id)
      eventById.set(id, ev);
  }
  const sellById = new Map<string, OrderRow>();
  for (const s of sellRows) {
    const id = orderIdKey(s.OrderID);
    if (id)
      sellById.set(id, s);
  }

  const ids = new Set<string>([...eventById.keys(), ...sellById.keys()]);
  const merged: Array<{ id: string; at: number; event?: PositionSellEvent; sellRow?: OrderRow }> = [];
  for (const id of ids) {
    const event = eventById.get(id);
    const sellRow = sellById.get(id);
    const at = Number(event?.at) || Number(sellRow?.CreateAt) || 0;
    merged.push({ id, at, event, sellRow });
  }
  merged.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  return merged.map(({ event, sellRow }) => {
    if (event) {
      return {
        row: synthesizeSellRowFromPositionEvent(buy, event, sellRow),
        sellSource: "event" as const,
      };
    }
    return { row: sellRow!, sellSource: "row" as const };
  });
}

export function orderListDisplayBlocks(rows: OrderRow[]): OrderListDisplayBlock[] {
  const display = orderListDisplayRows(rows);
  const buyIds = new Set(
    display
      .filter(isPredictionBuyRow)
      .map(r => orderIdKey(r.OrderID))
      .filter(Boolean),
  );

  /** buyId → sells（原始卖单行） */
  const sellsByBuy = new Map<string, OrderRow[]>();
  for (const r of display) {
    if (!isPredictionSellRow(r))
      continue;
    const buyId = predictionSellParentBuyId(r);
    if (!buyId || !buyIds.has(buyId))
      continue;
    const list = sellsByBuy.get(buyId) ?? [];
    list.push(r);
    sellsByBuy.set(buyId, list);
  }

  const nestedSellIdKeys = new Set<string>();
  const attachedByBuy = new Map<string, Array<{ row: OrderRow; sellSource: "event" | "row" }>>();
  for (const r of display) {
    if (!isPredictionBuyRow(r))
      continue;
    const buyKey = orderIdKey(r.OrderID);
    if (!buyKey)
      continue;
    const attached = attachedSellsForBuy(r, sellsByBuy.get(buyKey) ?? []);
    attachedByBuy.set(buyKey, attached);
    for (const a of attached)
      nestedSellIdKeys.add(orderIdKey(a.row.OrderID));
    // 事件覆盖后仍隐藏同买下原始卖单行（含已被事件合成的 id）
    for (const s of sellsByBuy.get(buyKey) ?? [])
      nestedSellIdKeys.add(orderIdKey(s.OrderID));
  }

  const out: OrderListDisplayBlock[] = [];
  for (const r of display) {
    const oid = String(r.OrderID ?? "");
    const oidKey = orderIdKey(oid);
    if (isPredictionSellRow(r) && nestedSellIdKeys.has(oidKey))
      continue;
    out.push({ key: oid || `row-${out.length}`, row: r, attach: false });
    if (!isPredictionBuyRow(r))
      continue;
    const attached = attachedByBuy.get(oidKey) ?? [];
    for (const a of attached) {
      const sid = String(a.row.OrderID ?? "");
      out.push({
        key: sid || `sell-${out.length}`,
        row: a.row,
        attach: true,
        sellSource: a.sellSource,
      });
    }
  }
  return out;
}

/** 本地日历日 YYYY-MM-DD（与侧栏 orderDate 一致） */
export function toOrderDateKeyLocal(ts: number): string {
  const d = new Date(Number(ts) || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Link 组归属时间：优先用 Link 还原的开弓时间戳。
 * 不是毫秒时间戳的占位 Link 才回退到主腿最早 CreateAt。
 */
export function orderGroupHomeTs(rows: OrderRow[]): number {
  const linkTs = orderLinkSortKey(rows[0]?.Link);
  if (linkTs >= ARB_LINK_MIN)
    return linkTs;
  const primary = rows.filter(r => !isPredictionSellRow(r));
  const pool = primary.length ? primary : rows;
  const times = pool.map(r => Number(r.CreateAt) || 0).filter(n => n > 0);
  return times.length ? Math.min(...times) : 0;
}

/**
 * [changmen 扩展] 订单归账时间戳：同 Link 整组跟开弓日（Link 时间戳）。
 * 单行即可判定，跨日补单不必先并对腿。
 */
export function orderProfitDateTs(row: OrderRow, peers: OrderRow[]): number {
  const aligned = peers.length ? alignPredictionSellLinksToBuys(peers) : [row];
  const link = effectiveOrderLink(row, aligned);
  const linkTs = orderLinkSortKey(link);
  if (linkTs >= ARB_LINK_MIN)
    return linkTs;
  const group = link !== 0
    ? aligned.filter(p => effectiveOrderLink(p, aligned) === link)
    : [row];
  const home = orderGroupHomeTs(group);
  if (home > 0)
    return home;
  return Number(row.CreateAt) || 0;
}

export function orderBelongsToDateKey(
  row: OrderRow,
  dateKey: string,
  peers: OrderRow[],
): boolean {
  const at = orderProfitDateTs(row, peers);
  if (!at)
    return true;
  return toOrderDateKeyLocal(at) === dateKey;
}

/**
 * 按日展示过滤：一组只住 Link 开弓日（不拆腿，也不在两天各出现一次）。
 */
export function filterOrdersBelongingToDate(
  list: OrderRow[],
  dateKey: string,
): OrderRow[] {
  const groups = groupOrdersByEffectiveLink(list);
  const out: OrderRow[] = [];
  for (const [link, rows] of groups) {
    if (link === 0) {
      for (const r of rows) {
        const at = Number(r.CreateAt) || 0;
        if (!at || toOrderDateKeyLocal(at) === dateKey)
          out.push(r);
      }
      continue;
    }
    const home = orderGroupHomeTs(rows);
    if (home > 0 && toOrderDateKeyLocal(home) !== dateKey)
      continue;
    out.push(...rows);
  }
  return out;
}

/**
 * [changmen 扩展] 去掉「仅有 PM 卖单、无买单/他场馆腿」的 Link 组。
 * 卖单必须跟买单同组展示；孤儿卖单不单独占一组。
 */
export function dropOrphanPolymarketSellGroups(
  groups: Map<number, OrderRow[]>,
): Map<number, OrderRow[]> {
  const out = new Map<number, OrderRow[]>();
  for (const [link, rows] of groups) {
    const hasPmSell = rows.some(r => isPolymarketOrderRow(r) && r.PmSide === "sell");
    if (!hasPmSell) {
      out.set(link, rows);
      continue;
    }
    const hasPmBuy = rows.some(r => isPolymarketOrderRow(r) && r.PmSide !== "sell");
    const hasOtherVenue = rows.some(r => !isPolymarketOrderRow(r) && !isMakeupSyntheticOrderRow(r));
    if (hasPmBuy || hasOtherVenue)
      out.set(link, rows);
  }
  return out;
}

export function isMakeupPendingOrderRow(row: OrderRow): boolean {
  const id = String(row.OrderID ?? "");
  if (id.startsWith("makeup-cancelled-"))
    return false;
  const status = String(row.Status ?? "");
  return status === "Makeup"
    || status === "MakeupPlacing"
    || status === "MakeupSettling"
    || id.startsWith("makeup-");
}

export function isMakeupCancelledOrderRow(row: OrderRow): boolean {
  return String(row.Status ?? "") === "MakeupCancelled"
    || String(row.OrderID ?? "").startsWith("makeup-cancelled-");
}

export function isMakeupSyntheticOrderRow(row: OrderRow): boolean {
  return isMakeupPendingOrderRow(row) || isMakeupCancelledOrderRow(row);
}

/** [changmen 扩展] 手动改绑：源 Link 须严格新于目标 Link */
export function canRebindOrderLinkTo(
  fromLink: number | null | undefined,
  toLink: number | null | undefined,
): boolean {
  const from = Number(fromLink);
  const to = Number(toLink);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0 || to === 0)
    return false;
  if (from === to)
    return false;
  return orderLinkSortKey(from) > orderLinkSortKey(to);
}

/** 从 bet 抽出地图槽（全场 / 地图N）；无法识别则 "—" */
export function parseOrderBetMapLabel(bet: string | null | undefined): string {
  const s = String(bet || "").trim();
  if (!s)
    return "—";
  const bracketMap = /^\[地图\s*(\d+)\]/.exec(s);
  if (bracketMap)
    return `地图${bracketMap[1]}`;
  const bracketFull = /^\[全场\]/.exec(s);
  if (bracketFull)
    return "全场";
  const plainMap = /^地图\s*(\d+)/.exec(s);
  if (plainMap)
    return `地图${plainMap[1]}`;
  const enMap = /^Map\s*(\d+)\b/i.exec(s);
  if (enMap)
    return `地图${enMap[1]}`;
  if (/全场/.test(s))
    return "全场";
  return "—";
}

/** 归一化对阵：去 HTML、运动前缀、Game/Map 后缀；主客对调视为同场 */
export function normalizeOrderMatchKey(match: string | null | undefined): string {
  let raw = String(match || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!raw)
    return "";
  // PM 等：`LoL: Team A vs Team B - Game 2 Winner`
  raw = raw.replace(
    /^(lol|league of legends|dota\s*2?|cs:?go|cs2|counter[- ]?strike|valorant|val|kog|王者荣耀|英雄联盟)\s*[:：\-–—]\s*/i,
    "",
  );
  const parts = raw.split(/\s+vs\.?\s+|\s+v\.?\s+/i);
  if (parts.length === 2) {
    const clean = (s: string) => s
      .replace(/\s*[-–—]\s*(game|map|地图)\s*\d+\b.*$/i, "")
      .replace(/\s*[-–—]\s*.*\b(winner|获胜|胜负)\b.*$/i, "")
      .trim();
    const a = clean(parts[0]);
    const b = clean(parts[1]);
    if (a && b)
      return [a, b].sort().join(" vs ");
  }
  return raw;
}

export type OrderMatchMapFields = {
  Match?: string | null;
  Bet?: string | null;
  match?: string | null;
  bet?: string | null;
};

/** [changmen 扩展] 同场且同地图槽才允许手动关联 */
export function isSameOrderMatchMap(a: OrderMatchMapFields, b: OrderMatchMapFields): boolean {
  const matchA = normalizeOrderMatchKey(a.Match ?? a.match);
  const matchB = normalizeOrderMatchKey(b.Match ?? b.match);
  if (!matchA || !matchB || matchA !== matchB)
    return false;
  const mapA = parseOrderBetMapLabel(a.Bet ?? a.bet);
  const mapB = parseOrderBetMapLabel(b.Bet ?? b.bet);
  if (mapA === "—" || mapB === "—")
    return false;
  return mapA === mapB;
}

/** 真实 RDS 订单行（可拖场馆徽章改绑）；PM/PF 卖单跟买单走，不可单独改绑 */
export function isRebindableOrderRow(row: OrderRow): boolean {
  if (row.DisplayOnly)
    return false;
  if (isMakeupSyntheticOrderRow(row))
    return false;
  if (isPredictionSellRow(row))
    return false;
  const id = String(row.OrderID ?? "").trim();
  if (!id || id.startsWith("makeup-"))
    return false;
  const link = Number(row.Link);
  return Number.isFinite(link) && link !== 0;
}

/** 拖放改绑：仅校验新→老 Link（同场同图由用户在确认框核对） */
export function canRebindOrderOnto(
  from: { Link?: number },
  to: { Link?: number },
): boolean {
  return canRebindOrderLinkTo(from.Link, to.Link);
}

export function makeupBetIdFromPendingRow(row: OrderRow): number | null {
  if (!isMakeupPendingOrderRow(row))
    return null;
  const id = String(row.OrderID ?? "");
  const n = Number(id.slice("makeup-".length));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** [changmen 扩展] 补单占位行盈亏文案 */
export function makeupPendingProfitLabel(row: OrderRow): string {
  switch (String(row.Status ?? "")) {
    case "MakeupPlacing":
      return "下单中";
    case "MakeupSettling":
      return "检测拒单中";
    default:
      if (
        String(row.Player?.UserName ?? "").includes("待确认")
        || String(row.Player?.UserName ?? "").includes("PM待确认")
      ) {
        return "待确认";
      }
      if (String(row.Player?.UserName ?? "").includes("再次被拒"))
        return "再次被拒，补单中";
      return "补单中";
  }
}

function resolveMakeupPendingPresentation(order: LoseOrder): {
  status: string;
  playerUserName: string;
} {
  const pendingVenue = String(order.pendingVenueOrderId ?? "").trim();
  const phase = pendingVenue
    ? "venue_pending"
    : (order.runtimePhase === "pm_pending" ? "venue_pending" : order.runtimePhase);
  if (phase === "placing") {
    return { status: "MakeupPlacing", playerUserName: "下单中" };
  }
  if (phase === "settling") {
    return { status: "MakeupSettling", playerUserName: "检测拒单中" };
  }
  if (phase === "venue_pending" || pendingVenue) {
    return { status: "Makeup", playerUserName: "补单中 · 待确认" };
  }
  if (phase === "rejected_retry") {
    return { status: "Makeup", playerUserName: "补单中 · 再次被拒" };
  }
  return { status: "Makeup", playerUserName: "补单中" };
}

/** [changmen 扩展] 补单队列项 → 订单组内「补单中」占位行（同 Link 合并展示） */
export function loseOrderToPendingRow(
  order: LoseOrder,
  makeProfit: number,
  bandPrefs?: MakeupOddsBandPrefs | null,
): OrderRow {
  const odds = makeupDisplayOdds(order, makeProfit, bandPrefs);
  const betMoney = order.getBetMoney(odds);
  const presentation = resolveMakeupPendingPresentation(order);
  return {
    OrderID: `makeup-${order.betId}`,
    Link: order.linkId,
    Type: "—",
    Match: order.match,
    Bet: order.bet,
    Item: order.target,
    Odds: odds,
    BetMoney: betMoney,
    Money: 0,
    Status: presentation.status,
    CreateAt: order.createAt,
    Player: {
      UserName: presentation.playerUserName,
    },
  };
}

/** [changmen 扩展] 手动取消的补单 → Link 组内展示行 */
export function loseOrderToCancelledRow(record: LoseOrderCancelledRecord): OrderRow {
  return {
    OrderID: `makeup-cancelled-${record.betId}`,
    Link: record.linkId,
    Type: "—",
    Match: record.match,
    Bet: record.bet,
    Item: record.target,
    Odds: 0,
    BetMoney: 0,
    Money: 0,
    Status: "MakeupCancelled",
    CreateAt: record.cancelledAt,
    Player: {
      UserName: "补单已手动取消",
    },
  };
}

/** 将 session 补单队列并入已有 Link 分组（不单独展示补单列表） */
export function mergePendingMakeupIntoOrderGroups(
  groups: Map<number, OrderRow[]>,
  loseOrders: Map<number, LoseOrder>,
  makeProfit: number,
  _cancelledMakeup: Map<number, LoseOrderCancelledRecord> = new Map(),
  bandPrefs?: MakeupOddsBandPrefs | null,
): Map<number, OrderRow[]> {
  const allRows: OrderRow[] = [];
  for (const rows of groups.values())
    allRows.push(...rows);
  for (const order of loseOrders.values()) {
    if (!order.linkId)
      continue;
    const syntheticId = `makeup-${order.betId}`;
    if (allRows.some(r => String(r.OrderID) === syntheticId))
      continue;
    allRows.push(loseOrderToPendingRow(order, makeProfit, bandPrefs));
  }
  // 手动取消的补单不再并入侧栏（取消即消失，不留 MakeupCancelled 占位）
  // 防御卖单 Link，避免补单合并时把已对齐的卖单按脏 Link 拆组
  return groupOrdersByEffectiveLink(allRows);
}

/** 组内盈亏：PM/PF 只认买单 Money；卖单恒 0（防双计） */
export function polymarketMoneyForAggregate(row: OrderRow, _peers: OrderRow[]): number {
  if (isMakeupSyntheticOrderRow(row))
    return 0;

  if (isPredictFunOrderRow(row)) {
    if (row.PfSide === "sell")
      return 0;
    // 库内 Money 为 USDT → 图例 CNY
    return (Number(row.Money) || 0) * getExchange(Currency.USDT);
  }

  if (!isPolymarketOrderRow(row))
    return Number(row.Money) || 0;

  if (row.PmSide === "sell")
    return 0;

  return Number(row.Money) || 0;
}

/** 组内盈亏合计 */
export function computeOrderGroupProfit(rows: OrderRow[]): number {
  return rows.reduce((sum, r) => sum + polymarketMoneyForAggregate(r, rows), 0);
}

/** PM 买单已无剩余持仓（含 FOK 尘量卖光但仍标 partial） */
function isPmExitedBuy(row: OrderRow): boolean {
  if (!isPolymarketOrderRow(row) || row.PmSide === "sell")
    return false;
  const state = String(row.PmSellState ?? "").toLowerCase();
  if (state === "closed" || state === "settled")
    return true;
  const attr = Number(row.PmAttributedSellShares) || 0;
  if (state === "partial" || attr > 0)
    return resolvePmRemainingShares(row) <= 0;
  return false;
}

/** PF 买单已退出持仓（手动全卖或赛果结算） */
function isPfExitedBuy(row: OrderRow): boolean {
  if (!isPredictFunOrderRow(row) || row.PfSide === "sell")
    return false;
  const state = String(row.PfSellState ?? "").toLowerCase();
  return state === "closed" || state === "settled";
}

function isExitedPredictionBuy(row: OrderRow): boolean {
  return isPmExitedBuy(row) || isPfExitedBuy(row);
}

function orderLegendPfStakeUsdt(row: OrderRow): number {
  const notional = Number(row.PfNotionalUsdt);
  if (Number.isFinite(notional) && notional > 0)
    return notional;
  return Number(row.BetMoney) || 0;
}

/** PF 赢单回款 USDT：截断两位后的持仓 × $1；无持仓时用 名义/买入价（不用赔率） */
function orderLegendPfWinPayoutUsdt(row: OrderRow): number {
  const hold = Number(row.PfHoldShares);
  if (Number.isFinite(hold) && hold > 0)
    return truncateShareUsdtAmount(hold);
  const fill = Number(row.PfShares);
  if (Number.isFinite(fill) && fill > 0)
    return truncateShareUsdtAmount(fill);
  const stake = orderLegendPfStakeUsdt(row);
  const book = Number(row.PfBookPrice);
  if (stake > 0 && Number.isFinite(book) && book > 0 && book < 1)
    return truncateShareUsdtAmount(stake / book);
  return 0;
}

/** PM 赢单回款 CNY：剩余持仓份额 × $1 × 汇率（不用赔率） */
function orderLegendPmWinPayoutCny(row: OrderRow): number {
  const rem = resolvePmRemainingShares(row);
  if (rem > 0.0001)
    return rem * getExchange(Currency.USDT);
  const fill = Number(row.PmShares) || 0;
  if (fill > 0.0001)
    return fill * getExchange(Currency.USDT);
  const usdc = Number(row.PmStakeUsdc) || 0;
  const price = Number(row.PmFillPrice);
  if (usdc > 0 && Number.isFinite(price) && price > 0 && price < 1)
    return (usdc / price) * getExchange(Currency.USDT);
  return 0;
}

function orderLegendExposureBet(row: OrderRow): number {
  if (isPolymarketOrderRow(row)) {
    const usdc = Number(row.PmStakeUsdc) || 0;
    if (usdc > 0)
      return usdc * getExchange(Currency.USDT);
    // 旧单无 pmStakeUsdc：BetMoney 已是 CNY 本金
    return Number(row.BetMoney) || 0;
  }
  if (isPredictFunOrderRow(row))
    return orderLegendPfStakeUsdt(row) * getExchange(Currency.USDT);
  return Number(row.BetMoney) || 0;
}

/**
 * 若该腿赢：回款 CNY。
 * - PM/PF：份额 × $1（价格市场）；不用赔率
 * - 其它场馆：bet × odds（套利腿仍可走赔率）
 */
function orderLegendWinPayoutCny(row: OrderRow): number {
  if (isPredictFunOrderRow(row))
    return orderLegendPfWinPayoutUsdt(row) * getExchange(Currency.USDT);
  if (isPolymarketOrderRow(row))
    return orderLegendPmWinPayoutCny(row);
  return orderLegendExposureBet(row) * (Number(row.Odds) || 0);
}

function pmTokenKey(row: OrderRow): string {
  if (!isPolymarketOrderRow(row) || row.PmSide === "sell")
    return "";
  return String(row.PmTokenId ?? "").trim().toLowerCase();
}

/**
 * [changmen 扩展] 未结预览分组：
 * - PM：同一 `PmTokenId` = 同一腿（同向多笔）
 * - 其它场馆 / 无 token：每笔订单单独一腿（不按队名/Item 互并）
 */
export function groupRowsByOutcomeSide(rows: OrderRow[]): OrderRow[][] {
  const tokenBuckets = new Map<string, OrderRow[]>();
  const perOrder: OrderRow[][] = [];

  for (const row of rows) {
    const token = pmTokenKey(row);
    if (token) {
      const list = tokenBuckets.get(token) ?? [];
      list.push(row);
      tokenBuckets.set(token, list);
      continue;
    }
    perOrder.push([row]);
  }

  return [...tokenBuckets.values(), ...perOrder];
}

/**
 * [A8 可证实] OrderView legend：未结预览「若赢回款 − 组本金」；已结为组盈亏。
 * [changmen 扩展]
 * - PF：回款 = 份额×$1（或 名义/买入价），不用赔率相乘
 * - 分隔符用 ` / `（A8 为 ` - `），避免负数拼成 `-281 - -114`
 * - PM 同 token 合并为一腿；其它场馆按订单各算一条
 */
export function orderLinkLegend(rows: OrderRow[]): string {
  const link = linkIdGroupKey(rows[0]?.Link);
  const prefix = isSingleLegLink(link) ? `${formatLinkId(link)} ` : "";
  const stake = rows
    .filter(r =>
      !LOSE_REJECT.has(String(r.Status))
      && !isPredictionSellRow(r)
      && !isMakeupSyntheticOrderRow(r)
      && !isExitedPredictionBuy(r),
    )
    .reduce((sum, r) => sum + orderLegendExposureBet(r), 0);
  const hasMakeup = rows.some(isMakeupPendingOrderRow);
  const makeupPrefix = hasMakeup ? "补单中 · " : "";
  const unsettled = rows.filter(r =>
    String(r.Status ?? "") === "None"
    && !isPredictionSellRow(r)
    && !isExitedPredictionBuy(r),
  );
  const sideGroups = groupRowsByOutcomeSide(unsettled);
  const unsettledPreview = sideGroups.map((sideRows) => {
    const payout = sideRows.reduce(
      (sum, r) => sum + orderLegendWinPayoutCny(r),
      0,
    );
    return toFixed(payout - stake, 0);
  });
  if (unsettledPreview.length)
    return makeupPrefix + prefix + unsettledPreview.join(" / ");
  const total = computeOrderGroupProfit(rows);
  const sign = total > 0 ? "+" : "";
  return makeupPrefix + prefix + sign + toFixed(total, 0);
}

/**
 * [changmen 扩展] 未结双边套利锁定利润预估（CNY）。
 * 与图例同口径：min(各侧若赢回款 − 组本金)；不足两侧或无法估算时返回 null。
 */
export function estimateArbLockedProfitCny(rows: OrderRow[]): number | null {
  const stake = rows
    .filter(r =>
      !LOSE_REJECT.has(String(r.Status))
      && !isPredictionSellRow(r)
      && !isMakeupSyntheticOrderRow(r)
      && !isExitedPredictionBuy(r),
    )
    .reduce((sum, r) => sum + orderLegendExposureBet(r), 0);
  if (!(stake > 0))
    return null;
  const unsettled = rows.filter(r =>
    String(r.Status ?? "") === "None"
    && !isPredictionSellRow(r)
    && !isExitedPredictionBuy(r),
  );
  const sideGroups = groupRowsByOutcomeSide(unsettled);
  if (sideGroups.length < 2)
    return null;
  const sideProfits = sideGroups.map((sideRows) => {
    const payout = sideRows.reduce(
      (sum, r) => sum + orderLegendWinPayoutCny(r),
      0,
    );
    return payout - stake;
  });
  if (!sideProfits.every(n => Number.isFinite(n)))
    return null;
  return Math.min(...sideProfits);
}

/** [changmen 扩展] 套利双腿 fieldset 高亮：跨平台且同 Link；纯 PM 买卖同组不算套利 */
export function isLinkedArbOrderGroup(rows: OrderRow[]): boolean {
  const link = linkIdGroupKey(rows[0]?.Link);
  if (link === 0 || isSingleLegLink(link) || rows.length < 2)
    return false;
  const providers = new Set(
    rows.map(r => String(r.Type ?? "").trim()).filter(Boolean),
  );
  const hasMakeup = rows.some(isMakeupSyntheticOrderRow);
  if (hasMakeup && rows.length >= 2 && link !== 0 && !isSingleLegLink(link))
    return true;
  return providers.size >= 2;
}
