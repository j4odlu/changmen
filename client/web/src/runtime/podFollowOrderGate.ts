import type { PodBetSettings } from "./podBetSettings";
import type { PodFollowLogRow } from "./podFollowLog";
import type { PodFollowPayload } from "./podFollowPayload";
import type { PodFollowExecutionTicket, PodFollowCell, PodFollowReader } from "./podFollowExecutionTypes";
import type { PodPmFollowPlaceTicket } from "./podPmFollowPlace";
import type { PodOutcomeGateEntry } from "./podYabo/gate";
import type { OrderRow } from "@/types/order";
import type { useFootballOrderStore } from "@/stores/footballOrderStore";
import type { useOrderStore } from "@/stores/orderStore";
import type { useAccountStore } from "@/stores/accountStore";
import { getExchange } from "@changmen/shared/currency";
import { isUnifiedFootballOrderRow } from "@/shared/orderDomain";
import { podFollowPlaceBlock } from "./podFollowPlace";
import { podPmFollowPlaceBlock } from "./podPmFollowPlace";
import { podRayFollowPlaceBlock, readRayFootballBindTasks, rayGateEntry } from "./podRayFollowPlace";

export interface PodFollowOrderGateContext {
  betSettings: PodFollowReader<PodBetSettings>;
  nowTick: PodFollowReader<number>;
  tickets: PodFollowReader<PodFollowExecutionTicket[]>;
  placed: PodFollowCell<Record<string, true>>;
  autoAttempted: PodFollowCell<Record<string, true>>;
  obExecutionEntries: PodFollowCell<Record<string, PodOutcomeGateEntry>>;
  rayOrderRevision: PodFollowReader<number>;
  logRows: PodFollowCell<PodFollowLogRow[]>;
  orderStore: Pick<ReturnType<typeof useOrderStore>, "orders">;
  accountStore: Pick<ReturnType<typeof useAccountStore>, "findAccount">;
  footballOrders: Pick<ReturnType<typeof useFootballOrderStore>, "rows" | "todayRows" | "todayProfit" | "todayOpenStake">;
  payloads: Pick<PodFollowPayload, "ticketPlacePayload" | "pmTicketPlacePayload" | "rayTicketPlacePayload">;
}

export function createPodFollowOrderGate(ctx: PodFollowOrderGateContext) {
  const { betSettings, nowTick, tickets, placed, autoAttempted, obExecutionEntries, rayOrderRevision, logRows, orderStore, accountStore, footballOrders } = ctx;
  const { ticketPlacePayload, pmTicketPlacePayload, rayTicketPlacePayload } = ctx.payloads;

  function venuePlaceKey(venue: "OB" | "Polymarket" | "RAY", id: string): string {
    return `${venue}:${String(id || "").trim()}`;
  }

  function orderCreateMs(row: OrderRow): number {
    const n = Number(row.CreateAt) || 0;
    return n > 0 && n < 10_000_000_000 ? n * 1000 : n;
  }

  function isTodayOrderRow(row: OrderRow): boolean {
    const at = orderCreateMs(row);
    if (!(at > 0))
      return false;
    const d = new Date(at);
    const now = new Date(nowTick.value);
    return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  }

  function rayUnifiedFootballRows(todayOnly = false): OrderRow[] {
    return [...orderStore.orders.values()].flat().filter(r => r.Type === "RAY" && isUnifiedFootballOrderRow(r)
      && (!todayOnly || isTodayOrderRow(r)));
  }

  function rayPendingTasks() { void rayOrderRevision.value; return readRayFootballBindTasks(); }

  function rayPendingPlacedIds(): string[] {
    return [...Object.keys(placed.value), ...Object.keys(autoAttempted.value)]
      .filter(k => k.startsWith("RAY:")).map(k => k.slice(4))
      .concat(rayUnifiedFootballRows().map(r => String(r.PodClientId || "")), rayPendingTasks().map(t => t.ticket.id));
  }

  function rayPendingPlacedEntries(): PodOutcomeGateEntry[] {
    const keys = new Set(rayPendingPlacedIds());
    return [...tickets.value.filter(t => keys.has(t.id)).map(t => rayGateEntry(rayTicketPlacePayload(t))),
      ...rayPendingTasks().map(t => rayGateEntry(t.ticket)),
      ...rayUnifiedFootballRows().map(r => ({ obMid: String(r.PodRayMatchId || ""), marketCode: String(r.PodMarketCode || ""),
        boardSide: r.PodBoardSide as PodOutcomeGateEntry["boardSide"] }))];
  }

  function rayPlaceBlock(ticket: PodFollowExecutionTicket): string | null {
    if (isVenuePlaced(ticket.id, "RAY") || rayPendingTasks().some(t => t.ticket.id === ticket.id)) return "已提交，等待回查";
    return venueDailyOrderBlock("RAY") || podRayFollowPlaceBlock(rayTicketPlacePayload(ticket));
  }

  function pmUnifiedFootballRows(opts: { todayOnly?: boolean } = {}): OrderRow[] {
    const out: OrderRow[] = [];
    for (const group of orderStore.orders.values()) {
      for (const row of group) {
        if (opts.todayOnly && !isTodayOrderRow(row))
          continue;
        if (
          String(row.Type || "").trim() === "Polymarket"
          && row.PmSide !== "sell"
          && isUnifiedFootballOrderRow(row)
          && String(row.Source || "").trim().startsWith("football-pod")
        ) {
          out.push(row);
        }
      }
    }
    return out;
  }

  function pmPodClientId(row: OrderRow): string {
    return String(row.PodClientId || "").trim();
  }

  function isPmUnifiedPodPlaced(id: string): boolean {
    const want = String(id || "").trim();
    return !!want && pmUnifiedFootballRows().some(row => pmPodClientId(row) === want);
  }

  function pmUnifiedOrderKey(row: OrderRow): string {
    return String(row.OrderID || `${row.PlayerID || ""}:${row.CreateAt || ""}`).trim();
  }

  function pmUnifiedPendingCap() {
    let todayProfit = 0;
    let openStake = 0;
    for (const row of pmUnifiedFootballRows({ todayOnly: true })) {
      const status = String(row.Status || "None").trim().toLowerCase();
      if (!status || status === "none" || status === "pending")
        openStake += Number(row.BetMoney) || 0;
      else
        todayProfit += Number(row.Money) || 0;
    }
    return { todayProfit, openStake };
  }

  function hasVenueOrder(id: string, venue: "OB" | "Polymarket" | "RAY"): boolean {
    const want = String(id || "").trim();
    if (!want)
      return false;
    if (venue === "RAY")
      return rayUnifiedFootballRows().some(r => r.PodClientId === want) || rayPendingTasks().some(t => t.ticket.id === want);
    if (venue === "Polymarket")
      return isPmUnifiedPodPlaced(want);
    const rows = [...footballOrders.todayRows, ...footballOrders.rows];
    return rows.some((row) => {
      if (String(row.venue || "OB").trim() !== venue)
        return false;
      const rowId = String(row.id || "").trim();
      return rowId === want || rowId.startsWith(`${want}#`);
    });
  }

  function venueOrderCountToday(venue: "OB" | "Polymarket" | "RAY"): number {
    if (venue === "RAY") return rayUnifiedFootballRows(true).length + rayPendingTasks().filter(t => new Date(t.at).toDateString() === new Date().toDateString()).length;
    if (venue === "Polymarket") {
      const seen = new Set<string>();
      for (const row of pmUnifiedFootballRows({ todayOnly: true })) {
        const key = pmUnifiedOrderKey(row);
        if (key)
          seen.add(key);
      }
      return seen.size;
    }
    const seen = new Set<string>();
    for (const row of footballOrders.todayRows) {
      if (String(row.venue || "OB").trim() !== venue)
        continue;
      const key = String(row.orderId || row.id || `${row.playerId || ""}:${row.at || ""}`).trim();
      if (key)
        seen.add(key);
    }
    return seen.size;
  }

  function venueDailyOrderLimit(venue: "OB" | "Polymarket" | "RAY"): number {
    if (venue === "RAY") return betSettings.value.rayDailyOrderLimit;
    return venue === "OB"
      ? Math.round(Number(betSettings.value.obDailyOrderLimit) || 0)
      : Math.round(Number(betSettings.value.pmDailyOrderLimit) || 0);
  }

  function venueSelectedAccountCount(venue: "OB" | "Polymarket" | "RAY"): number {
    if (venue === "RAY") return betSettings.value.rayFollowAccountIds.length;
    return venue === "OB"
      ? betSettings.value.followAccountIds.length
      : betSettings.value.pmFollowAccountIds.length;
  }

  function venueNextOrderCount(venue: "OB" | "Polymarket" | "RAY"): number {
    const count = venueSelectedAccountCount(venue);
    return venue === "OB" && betSettings.value.obAccountRotation && count > 0 ? 1 : count;
  }

  function venueDailyOrderBlock(venue: "OB" | "Polymarket" | "RAY"): string | null {
    const limit = venueDailyOrderLimit(venue);
    if (!(limit > 0))
      return null;
    const current = venueOrderCountToday(venue);
    const next = venueNextOrderCount(venue);
    if (current >= limit)
      return `${venue === "Polymarket" ? "PM" : venue} 今日单数已满`;
    if (next > 0 && current + next > limit)
      return `${venue === "Polymarket" ? "PM" : venue} 今日剩余 ${Math.max(0, limit - current)} 单`;
    return null;
  }

  function isVenuePlaced(id: string, venue: "OB" | "Polymarket" | "RAY"): boolean {
    const key = venuePlaceKey(venue, id);
    if (placed.value[key] || hasVenueOrder(id, venue))
      return true;
    return venue === "OB" && logRows.value.some(row => row.id === id && row.placed);
  }

  function placeBlock(ticket: PodFollowExecutionTicket): string | null {
    if (isVenuePlaced(ticket.id, "OB"))
      return "已下过";
    if (obExecutionEntries.value[ticket.id])
      return "提交结果待确认，禁止重复下单";
    const dailyBlock = venueDailyOrderBlock("OB");
    if (dailyBlock)
      return dailyBlock;
    return podFollowPlaceBlock(ticketPlacePayload(ticket));
  }

  function pmPlaceBlock(ticket: PodFollowExecutionTicket): string | null {
    if (isVenuePlaced(ticket.id, "Polymarket"))
      return "已下过";
    const dailyBlock = venueDailyOrderBlock("Polymarket");
    if (dailyBlock)
      return dailyBlock;
    return podPmFollowPlaceBlock(pmTicketPlacePayload(ticket));
  }

  function pendingCap() {
    const pm = pmUnifiedPendingCap();
    return {
      todayProfit: footballOrders.todayProfit + pm.todayProfit + rayUnifiedFootballRows(true).filter(r => !["none", "pending"].includes(String(r.Status).toLowerCase())).reduce((n, r) => n + (Number(r.Money) || 0) * rayOrderExchange(r), 0),
      openStake: footballOrders.todayOpenStake + pm.openStake + rayUnifiedFootballRows(true).filter(r => ["none", "pending"].includes(String(r.Status).toLowerCase())).reduce((n, r) => n + (Number(r.BetMoney) || 0) * rayOrderExchange(r), 0) + rayPendingTasks().reduce((n, t) => n + t.venueStake * t.exchange, 0),
      maxDailyLoss: betSettings.value.maxDailyLoss,
    };
  }

  function rayOrderExchange(row: OrderRow): number {
    return getExchange(accountStore.findAccount(Number(row.PlayerID))?.currency || "CNY");
  }

  function pendingPlacedIds(): string[] {
    return [
      ...Object.keys(placed.value).filter(key => key.startsWith("OB:")).map(key => key.slice(3)),
      ...Object.keys(autoAttempted.value).filter(key => key.startsWith("OB:")).map(key => key.slice(3)),
      ...logRows.value.filter(row => row.placed).map(row => row.id),
    ];
  }

  function pendingPmPlacedIds(): string[] {
    return [
      ...Object.keys(placed.value).filter(key => key.startsWith("Polymarket:")).map(key => key.slice("Polymarket:".length)),
      ...Object.keys(autoAttempted.value).filter(key => key.startsWith("Polymarket:")).map(key => key.slice("Polymarket:".length)),
      ...pmUnifiedFootballRows()
        .map(row => pmPodClientId(row))
        .filter(Boolean),
    ];
  }

  function pendingPlacedEntries() {
    return [...Object.values(obExecutionEntries.value), ...logRows.value
      .filter(row => row.placed && row.obMid && row.boardSide)
      .map(row => ({
        obMid: row.obMid,
        marketCode: row.marketCode,
        boardSide: row.boardSide,
      }))];
  }

  function inferPmMarketCode(label: unknown): string {
    const s = String(label || "").toLowerCase();
    if (/大小|total|over|under|o\/u/.test(s))
      return "totals";
    if (/让球|spread|handicap|ah/.test(s))
      return "spreads";
    if (/独赢|胜负|moneyline|winner|1x2/.test(s))
      return "moneyline";
    return "";
  }

  function inferPmBoardSide(label: unknown): PodOutcomeGateEntry["boardSide"] {
    const s = String(label || "").toLowerCase();
    if (/大|over/.test(s))
      return "over";
    if (/小|under/.test(s))
      return "under";
    if (/主|home/.test(s))
      return "home";
    if (/客|away/.test(s))
      return "away";
    if (/平|draw/.test(s))
      return "draw";
    return null;
  }

  function pmGateEntryFromPayload(payload: PodPmFollowPlaceTicket): PodOutcomeGateEntry | null {
    const obMid = String(payload.pmMatchId || "").trim();
    const marketCode = String(payload.market.marketCode || "").trim();
    const boardSide = payload.market.boardSide ?? null;
    if (!obMid || !marketCode || !boardSide)
      return null;
    return { obMid, marketCode, boardSide };
  }

  function pendingPmPlacedEntries(): PodOutcomeGateEntry[] {
    const out: PodOutcomeGateEntry[] = [];
    const push = (row: PodOutcomeGateEntry | null | undefined) => {
      if (!row?.obMid || !row.marketCode || !row.boardSide)
        return;
      out.push(row);
    };
    const pmKeys = new Set([
      ...Object.keys(placed.value).filter(key => key.startsWith("Polymarket:")).map(key => key.slice("Polymarket:".length)),
      ...Object.keys(autoAttempted.value).filter(key => key.startsWith("Polymarket:")).map(key => key.slice("Polymarket:".length)),
    ]);
    for (const row of tickets.value) {
      if (!pmKeys.has(row.id))
        continue;
      push(pmGateEntryFromPayload(pmTicketPlacePayload(row, true)));
    }
    for (const row of footballOrders.todayRows) {
      if (String(row.venue || "").trim() !== "Polymarket")
        continue;
      const obMid = String(row.obMid || "").trim();
      const marketCode = inferPmMarketCode(row.marketLabel);
      const boardSide = inferPmBoardSide(row.sideLabel);
      push({ obMid, marketCode, boardSide });
    }
    for (const row of pmUnifiedFootballRows()) {
      const obMid = String(row.PodPmMatchId || row.PmConditionId || "").trim();
      const marketCode = inferPmMarketCode(row.Bet);
      const boardSide = inferPmBoardSide(row.Item);
      push({ obMid, marketCode, boardSide });
    }
    return out;
  }

  return { venuePlaceKey, orderCreateMs, isTodayOrderRow, rayUnifiedFootballRows, rayPendingTasks, rayPendingPlacedIds, rayPendingPlacedEntries, rayPlaceBlock, pmUnifiedFootballRows, pmPodClientId, isPmUnifiedPodPlaced, pmUnifiedOrderKey, pmUnifiedPendingCap, hasVenueOrder, venueOrderCountToday, venueDailyOrderLimit, venueSelectedAccountCount, venueNextOrderCount, venueDailyOrderBlock, isVenuePlaced, placeBlock, pmPlaceBlock, pendingCap, rayOrderExchange, pendingPlacedIds, pendingPmPlacedIds, pendingPlacedEntries, inferPmMarketCode, inferPmBoardSide, pmGateEntryFromPayload, pendingPmPlacedEntries };
}

export type PodFollowOrderGate = ReturnType<typeof createPodFollowOrderGate>;
