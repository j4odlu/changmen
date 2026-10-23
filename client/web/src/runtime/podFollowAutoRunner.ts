import type { PodBetSettings } from "./podBetSettings";
import type { PodFollowExecutionTicket, PodFollowCell, PodFollowReader } from "./podFollowExecutionTypes";
import type { PodFollowPayload } from "./podFollowPayload";
import type { PodFollowOrderGate } from "./podFollowOrderGate";
import type { PodFollowPlacement } from "./podFollowPlacement";
import type { PodFollowLogRow } from "./podFollowLog";
import { podAlertBetFailReason, podAlertWithinFollowAge } from "./podBetSettings";
import { pickPodYaboAutoTicket } from "./podYabo";
import { pickPodRayAutoTicket } from "./podRayFollowPlace";
import { pickPodPmAutoTicket } from "./podPmFollowPlace";
import { podFollowPlaceBlock } from "./podFollowPlace";
import { prefetchObSportOidQuote } from "./podMarketPrefetch";

export interface PodFollowAutoRunnerContext {
  betSettings: PodFollowReader<PodBetSettings>;
  tickets: PodFollowReader<PodFollowExecutionTicket[]>;
  placingId: PodFollowReader<string>;
  placingPmId: PodFollowReader<string>;
  placingRayId: PodFollowReader<string>;
  followObEnabled: PodFollowReader<boolean>;
  followPmEnabled: PodFollowReader<boolean>;
  followRayEnabled: PodFollowReader<boolean>;
  rayOrdersRefreshing: PodFollowReader<boolean>;
  autoAttempted: PodFollowCell<Record<string, true>>;
  autoReady: PodFollowCell<boolean>;
  placed: PodFollowCell<Record<string, true>>;
  logRows: PodFollowReader<PodFollowLogRow[]>;
  sportOdds: { hasFresh: (venue: string, id: string) => boolean };
  accountStore: { loaded: boolean; loadAccounts: (refresh: boolean) => Promise<unknown> };
  footballOrders: { loaded: boolean; load: () => Promise<unknown> };
  orderStore: { fetchOrders: (date?: string, opts?: { sideEffects?: boolean }) => Promise<boolean> };
  refreshLog: () => void;
  payloads: Pick<PodFollowPayload, "ticketPlacePayload" | "pmTicketPlacePayload" | "rayTicketPlacePayload">;
  gates: Pick<PodFollowOrderGate, "pendingPlacedIds" | "pendingPlacedEntries" | "pendingCap" | "venuePlaceKey" | "venueDailyOrderBlock" | "rayPendingPlacedIds" | "rayPendingPlacedEntries" | "pendingPmPlacedIds" | "pendingPmPlacedEntries">;
  placement: Pick<PodFollowPlacement, "placeTicket" | "placeRayTicket" | "placePmTicket">;
}

export function createPodFollowAutoRunner(ctx: PodFollowAutoRunnerContext) {
  const { betSettings, tickets, placingId, placingPmId, placingRayId, followObEnabled, followPmEnabled, followRayEnabled, rayOrdersRefreshing, autoAttempted, autoReady, placed, logRows, sportOdds, accountStore, footballOrders, orderStore, refreshLog } = ctx;
  const { ticketPlacePayload, pmTicketPlacePayload, rayTicketPlacePayload } = ctx.payloads;
  const { pendingPlacedIds, pendingPlacedEntries, pendingCap, venuePlaceKey, venueDailyOrderBlock, rayPendingPlacedIds, rayPendingPlacedEntries, pendingPmPlacedIds, pendingPmPlacedEntries } = ctx.gates;
  const { placeTicket, placeRayTicket, placePmTicket } = ctx.placement;
  let autoRunnerActive = false;
  let autoRunRequested = false;
  let autoRunnerStopped = false;
  let generation = 0;
  const isCurrent = (epoch: number) => !autoRunnerStopped && generation === epoch;

  async function maybeAutoPlace(): Promise<boolean> {
    const epoch = generation;
    if (!isCurrent(epoch) || !betSettings.value.enabled || !betSettings.value.autoPlace || placingId.value || placingPmId.value || placingRayId.value)
      return false;
    let attempted = false;
    const eligibleTickets = () => tickets.value.filter(ticket =>
      podAlertBetFailReason(ticket.alert, betSettings.value, Date.now()) == null
      && podAlertWithinFollowAge(ticket.alert, betSettings.value.maxAgeSec, Date.now()),
    );
    const ageOk = eligibleTickets();
    const skipped = pendingPlacedIds();
    const placedEntries = pendingPlacedEntries();
    const cap = pendingCap();
    // 暖一下预检价，给 EV/锁盘判断；真下单仍走 queryBetAmountPB
    if (followObEnabled.value) {
      for (const ticket of ageOk.slice(0, 6)) {
        if (skipped.includes(ticket.id))
          continue;
        const payload = ticketPlacePayload(ticket);
        if (payload.fixtureBasis !== "confirmed")
          continue;
        if (podFollowPlaceBlock(payload))
          continue;
        const oid = String(payload.market.oid || "").trim();
        const mid = String(payload.obMid || "").trim();
        if (oid && mid && !sportOdds.hasFresh("OB", oid))
          void prefetchObSportOidQuote(oid, mid, {
            marketCode: payload.market.marketCode,
            boardSide: payload.market.boardSide || undefined,
            odds: Number(payload.quote.quote) || Number(payload.market.quote) || 0,
            submitBefore: ticketPlacePayload(ticket, true).submitBefore,
          });
      }
    }
    if (followObEnabled.value) {
      const next = pickPodYaboAutoTicket(
        ageOk.map(row => ticketPlacePayload(row)),
        skipped,
        placedEntries,
        cap,
      );
      if (next) {
        const ui = tickets.value.find(row => row.id === next.id);
        if (ui) {
          // 先占坑再下：对齐 seenAlertKeys，避免管道慢时重复打同一票
          autoAttempted.value = { ...autoAttempted.value, [venuePlaceKey("OB", next.id)]: true };
          await placeTicket(ui, true);
          attempted = true;
        }
      }
    }
    // [changmen 扩展] 已发送的订单继续收尾；卸载或重启后，不再由旧轮次发送下一馆。
    if (!isCurrent(epoch)) return attempted;
    if (betSettings.value.enabled && betSettings.value.autoPlace && followRayEnabled.value && !rayOrdersRefreshing.value) {
      const next = pickPodRayAutoTicket(eligibleTickets().filter(() => !venueDailyOrderBlock("RAY")).map(t => rayTicketPlacePayload(t, true)),
        rayPendingPlacedIds(), rayPendingPlacedEntries(), pendingCap());
      const ui = next && tickets.value.find(t => t.id === next.id);
      if (ui) { autoAttempted.value = { ...autoAttempted.value, [venuePlaceKey("RAY", ui.id)]: true }; await placeRayTicket(ui, true); attempted = true; }
    }
    if (!isCurrent(epoch) || !betSettings.value.enabled || !betSettings.value.autoPlace || !followPmEnabled.value)
      return attempted;
    const pmNext = pickPodPmAutoTicket(
      eligibleTickets().map(row => pmTicketPlacePayload(row, true)),
      pendingPmPlacedIds(),
      pendingPmPlacedEntries(),
      pendingCap(),
    );
    if (!pmNext)
      return attempted;
    const pmUi = tickets.value.find(row => row.id === pmNext.id);
    if (!pmUi)
      return attempted;
    autoAttempted.value = { ...autoAttempted.value, [venuePlaceKey("Polymarket", pmNext.id)]: true };
    await placePmTicket(pmUi, true);
    return true;
  }

  function requestAutoPlace() {
    if (autoRunnerStopped || !autoReady.value || !betSettings.value.autoPlace)
      return;
    autoRunRequested = true;
    if (!autoRunnerActive)
      void drainAutoPlaceQueue();
  }

  async function drainAutoPlaceQueue() {
    if (autoRunnerActive || autoRunnerStopped || !autoReady.value)
      return;
    autoRunnerActive = true;
    const epoch = generation;
    try {
      while (autoRunRequested && isCurrent(epoch) && betSettings.value.autoPlace) {
        autoRunRequested = false;
        const attempted = await maybeAutoPlace();
        // 一次只挑每馆一个；成功占位后继续 drain 其余已就绪票。
        if (attempted && isCurrent(epoch))
          autoRunRequested = true;
      }
    }
    finally {
      autoRunnerActive = false;
      if (autoRunRequested && !autoRunnerStopped && betSettings.value.autoPlace)
        void drainAutoPlaceQueue();
    }
  }

  async function restoreAutoPlaceState() {
    const epoch = generation;
    autoReady.value = false;
    try {
      if (!accountStore.loaded)
        await accountStore.loadAccounts(false);
      if (!isCurrent(epoch)) return;
      const [, unifiedLoaded] = await Promise.all([
        footballOrders.loaded ? Promise.resolve() : footballOrders.load(),
        orderStore.fetchOrders(undefined, { sideEffects: false }),
      ]);
      if (!isCurrent(epoch)) return;
      if (!accountStore.loaded || !footballOrders.loaded || unifiedLoaded !== true)
        throw new Error("自动下注状态恢复未完成");
      refreshLog();
      placed.value = Object.fromEntries(logRows.value
        .filter(row => row.placed)
        .map(row => [venuePlaceKey("OB", row.id), true as const]));
      autoReady.value = true;
      requestAutoPlace();
    }
    catch {
      // 资金安全优先：恢复失败时保持禁用，等待页面重载或用户修复连接。
      if (isCurrent(epoch)) autoReady.value = false;
    }
  }

  return { requestAutoPlace, restoreAutoPlaceState,
    start: () => { generation++; autoRunnerStopped = false; },
    stop: () => { generation++; autoRunnerStopped = true; autoRunRequested = false; },
    cancelPending: () => { autoRunRequested = false; },
  };
}
