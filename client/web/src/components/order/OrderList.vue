<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import type { OrderRow } from "@/types/order";
import { onMounted, onUnmounted, computed, ref } from "vue";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import OrderModeDetails from "@/orderModes/OrderDetails.vue";
import { rebindOrderLink } from "@/api/order";
import { formatDisplayOdds, formatLinkId, formatOrderTime, toFixed } from "@changmen/client-core/shared/format";
import {
  clobPriceFromDecimalOdds,
  clobPriceFromFoOddsEntry,
  formatPolymarketApiDecimal,
  isPmBuyOrderListRow,
  isPmOrderListRow,
  isPmSellOrderListRow,
  isPmManuallySoldBuy,
  pmBuyLifecycleTagText,
  pmOddsTextFromClobPrice,
  pmOrderFillPriceText,
  pmOrderOddsText,
  pmOrderPriceLabel,
  pmOrderProfitDisplayCny,
  pmOrderSharesText,
  pmOrderSideTagText,
  pmOrderStakeDisplayCny,
  pmUnrealizedPnlAtLiveCny,
  formatLiveUnrealizedPnlText,
  resolvePmOrderListStatusClass,
} from "@/shared/pmOrderDisplay";
import {
  isPfBuyOrderListRow,
  isPfManuallySoldBuy,
  isPfOrderListRow,
  isPfSellOrderListRow,
  pfBuyLifecycleTagText,
  pfOddsTextFromClobPrice,
  pfOrderBetText,
  pfOrderFillPriceText,
  pfOrderItemText,
  pfOrderMatchText,
  pfOrderOddsText,
  pfOrderPriceLabel,
  pfOrderProfitDisplayCny,
  pfOrderSharesText,
  pfOrderSideTagText,
  pfOrderStakeDisplayCny,
  pfStakeLabel,
  pfUnrealizedPnlAtLiveCny,
  resolvePfOrderListStatusClass,
} from "@/shared/pfOrderDisplay";
import { resolveOrderItemLabel } from "@/shared/orderItemDisplay";
import { positionEventObserveTag } from "@/shared/positionEventsDisplay";
import { ensurePfOrderLabelIndex } from "@/shared/pfOrderLabelIndex";
import {
  isArbGroup,
  orderLegendModifier,
  orderLegendText,
} from "@/shared/orderDisplay";
import { groupHasUnboundPlaceholder } from "@/shared/linkDisplay";
import {
  canRebindOrderLinkTo,
  isMakeupCancelledOrderRow,
  isMakeupPendingOrderRow,
  isRebindableOrderRow,
  makeupBetIdFromPendingRow,
  makeupPendingProfitLabel,
  orderListDisplayBlocks,
  orderListDisplayRows,
} from "@/shared/orderLink";
import { resolvePmRemainingShares } from "@changmen/venue-adapter/polymarket";
import {
  canManualSellPmBuy,
  confirmAndSellPmBuyOrder,
  isPmManualSellClosing,
  isPmManualSellInFlight,
} from "@/stores/account/pmManualSell";
import {
  canManualSellPfBuy,
  confirmAndSellPfBuyOrder,
  isPfManualSellInFlight,
} from "@/stores/account/pfManualSell";
import { useOddsStore } from "@/stores/oddsStore";
import { useSportOddsStore } from "@/stores/sportOddsStore";
import { PLATFORMS } from "@changmen/venue-adapter/shared";
import { isUnifiedFootballOrderRow } from "@/shared/orderDomain";

export type OrderListEntry = readonly [number, OrderRow[]];

const props = withDefaults(
  defineProps<{
    orderEntries: ReadonlyArray<OrderListEntry>;
    loading?: boolean;
    playerLabel?: (row: OrderRow) => string;
    platformClass?: (row: OrderRow) => string | undefined;
    /** [changmen 扩展] 用户侧栏允许场馆徽章拖放改绑 Link */
    allowLinkRebind?: boolean;
    /** [changmen 扩展] PM 买单行显示「卖出」 */
    allowPmSell?: boolean;
    /** [changmen 扩展] PF 买单行显示「卖出」 */
    allowPfSell?: boolean;
  }>(),
  {
    loading: false,
    playerLabel: () => "",
    platformClass: () => undefined,
    allowLinkRebind: false,
    allowPmSell: false,
    allowPfSell: false,
  },
);

const emit = defineEmits<{
  cancelMakeup: [betId: number];
  linkRebindDone: [];
}>();

type DragState = {
  orderId: string;
  fromLink: number;
  pointerId: number;
};

const drag = ref<DragState | null>(null);
const dropTargetOrderId = ref<string | null>(null);
/** MarketIndex 异步灌入后强制刷新 PF 队名文案 */
const pfLabelTick = ref(0);
let lineEl: SVGSVGElement | null = null;
let startEl: HTMLElement | null = null;
let stopOddsLiveWatch: (() => void) | undefined;
let stopSportLiveWatch: (() => void) | undefined;

onMounted(() => {
  void ensurePfOrderLabelIndex().then((ok) => {
    if (ok)
      pfLabelTick.value += 1;
  });
});

function pfMatchText(row: OrderRow): string {
  void pfLabelTick.value;
  return pfOrderMatchText(row);
}

function pfBetText(row: OrderRow): string {
  void pfLabelTick.value;
  return pfOrderBetText(row);
}

function pfItemText(row: OrderRow): string {
  void pfLabelTick.value;
  return pfOrderItemText(row);
}

function orderItemText(row: OrderRow): string {
  return resolveOrderItemLabel(row.Item, row.Match);
}

function isPendingRow(row: OrderRow): boolean {
  if (isMakeupPendingOrderRow(row) || isMakeupCancelledOrderRow(row))
    return false;
  // PF：已 1:1 卖出 / 赛果结算 / 卖单行不算「待结算」（对齐 PM）
  if (String(row.Type ?? "") === "PredictFun") {
    if (row.PfSide === "sell" || row.PfSellState === "closed" || row.PfSellState === "settled")
      return false;
  }
  // PM：卖单 / 已全卖买单不算「待结算」（角标已映 Win/Lose）
  if (String(row.Type ?? "") === "Polymarket") {
    if (row.PmSide === "sell")
      return false;
    if (isPmManuallySoldBuy(row)) {
      const state = String(row.PmSellState ?? "").toLowerCase();
      if (!(state === "partial" && resolvePmRemainingShares(row) > 0))
        return false;
    }
  }
  return String(row.Status ?? "") === "None";
}

function statusClass(row: OrderRow): string {
  if (isPmManualSellClosing(row.OrderID))
    return "PmClosing";
  if (isPfOrderListRow(row))
    return resolvePfOrderListStatusClass(row);
  return resolvePmOrderListStatusClass(row);
}

function showPmSellButton(row: OrderRow): boolean {
  return props.allowPmSell && canManualSellPmBuy(row);
}

function showPfSellButton(row: OrderRow): boolean {
  return props.allowPfSell && canManualSellPfBuy(row);
}

function isFootballPodOrder(row: OrderRow): boolean {
  return isUnifiedFootballOrderRow(row);
}

const oddsStore = useOddsStore();
const sportOddsStore = useSportOddsStore();

/**
 * [changmen 扩展] 订单现价局部时钟：仅当 fo/sportOdds 写入**挂单相关** token 时 bump。
 * 不再订阅全局 quoteTick / sportOdds.tick（任意盘口变价会拖整栏重算）。
 */
const orderLiveTick = ref(0);

function liveTokenKey(platform: string, tokenId: string): string {
  return `${platform}:${tokenId}`;
}

/** 当前列表里需要盯现价的 PM/PF token */
const watchedLiveTokens = computed(() => {
  const set = new Set<string>();
  for (const [, rows] of props.orderEntries) {
    for (const row of rows) {
      if (pmShowLivePrice(row)) {
        const t = String(row.PmTokenId ?? "").trim();
        if (t)
          set.add(liveTokenKey(PLATFORMS.Polymarket, t));
      }
      if (pfShowLivePrice(row)) {
        const t = String(row.PfTokenId ?? "").trim();
        if (t)
          set.add(liveTokenKey(PLATFORMS.PredictFun, t));
      }
    }
  }
  return set;
});

function bumpOrderLiveIfWatched(platform: unknown, oddId: unknown) {
  const id = String(oddId ?? "").trim();
  if (!id)
    return;
  if (watchedLiveTokens.value.has(liveTokenKey(String(platform), id)))
    orderLiveTick.value += 1;
}

// 在 setup 同步订阅（勿等 onMounted）：避免首屏到 mount 之间漏掉 fo/sport 写入
stopOddsLiveWatch = oddsStore.$onAction(({ name, args, after }) => {
  after(() => {
    if (name === "save") {
      const entry = args[1] as { id?: unknown } | undefined;
      bumpOrderLiveIfWatched(args[0], entry?.id);
      return;
    }
    if (name === "updateOddsLock") {
      bumpOrderLiveIfWatched(args[0], args[1]);
      return;
    }
    if (name === "clean" && watchedLiveTokens.value.size > 0)
      orderLiveTick.value += 1;
  });
});

stopSportLiveWatch = sportOddsStore.$onAction(({ name, args, after }) => {
  after(() => {
    if (name === "save") {
      bumpOrderLiveIfWatched(args[0], args[1]);
      return;
    }
    if (name === "clear" && watchedLiveTokens.value.size > 0)
      orderLiveTick.value += 1;
  });
});

/**
 * 未结算买单实时价：只读、不写 fo。
 * 与盘口同源：fo.clobPrice → fo.odds→价；体育盘口价在 sportOddsStore（不进 fo）。
 */
function pmLiveClobPrice(row: OrderRow): number | null {
  void orderLiveTick.value;
  const tokenId = String(row.PmTokenId ?? "").trim();
  if (!tokenId)
    return null;
  const fromFo = clobPriceFromFoOddsEntry(
    oddsStore.getEntry(PLATFORMS.Polymarket, tokenId),
  );
  if (fromFo != null)
    return fromFo;
  return clobPriceFromDecimalOdds(sportOddsStore.get(PLATFORMS.Polymarket, tokenId));
}

/**
 * 可卖持仓显示「当前价」行。
 * 不要求 fo 已有报价（否则首屏/未订阅 token 时连「当前价」字样都没有）；
 * 无 live 时文案为 —，挂单相关 token 入 fo/sportOdds 后填数。
 */
function pmShowLivePrice(row: OrderRow): boolean {
  if (!isPmBuyOrderListRow(row))
    return false;
  // 仅「部分卖出」仍显示当前价；全卖 / 已结算不显示
  if (pmBuyLifecycleTagText(row) === "已结算")
    return false;
  if (isPmManuallySoldBuy(row)) {
    const state = String(row.PmSellState ?? "").toLowerCase();
    if (!(state === "partial" && resolvePmRemainingShares(row) > 0))
      return false;
  }
  const status = String(row.Status ?? "").trim().toLowerCase();
  if (status === "reject" || status === "return" || status === "pending")
    return false;
  if (row.PmSellState === "closed" || row.PmSellState === "settled")
    return false;
  return true;
}

function pmLivePriceText(row: OrderRow): string {
  const live = pmLiveClobPrice(row);
  return live != null ? formatPolymarketApiDecimal(live) : "—";
}

function pmLiveUnrealizedPnlCny(row: OrderRow): number | null {
  return pmUnrealizedPnlAtLiveCny(row, pmLiveClobPrice(row));
}

function pmLiveUnrealizedPnlText(row: OrderRow): string | null {
  return formatLiveUnrealizedPnlText(pmLiveUnrealizedPnlCny(row));
}

/** 有 live 才显示「当前赔率」；无 live 时不跟买入赔率冒充 */
function pmShowLiveOdds(row: OrderRow): boolean {
  return pmShowLivePrice(row) && pmLiveClobPrice(row) != null;
}

/** 最后一行赔率：有当前价则跟当前价，否则跟买入价 */
function pmLastLineOddsText(row: OrderRow): string {
  const live = pmLiveClobPrice(row);
  if (live != null)
    return pmOddsTextFromClobPrice(live);
  return pmOrderOddsText(row);
}

function pfLiveClobPrice(row: OrderRow): number | null {
  void orderLiveTick.value;
  const tokenId = String(row.PfTokenId ?? "").trim();
  if (!tokenId)
    return null;
  const fromFo = clobPriceFromFoOddsEntry(
    oddsStore.getEntry(PLATFORMS.PredictFun, tokenId),
  );
  if (fromFo != null)
    return fromFo;
  return clobPriceFromDecimalOdds(sportOddsStore.get(PLATFORMS.PredictFun, tokenId));
}

function pfShowLivePrice(row: OrderRow): boolean {
  if (!isPfBuyOrderListRow(row))
    return false;
  // 对齐 PM：全卖 / 已结算不显示当前价
  if (pfBuyLifecycleTagText(row) === "已结算")
    return false;
  if (isPfManuallySoldBuy(row))
    return false;
  const status = String(row.Status ?? "").trim().toLowerCase();
  if (status === "reject" || status === "return" || status === "pending")
    return false;
  if (row.PfSellState === "closed" || row.PfSellState === "settled")
    return false;
  return true;
}

function pfLivePriceText(row: OrderRow): string {
  const live = pfLiveClobPrice(row);
  return live != null ? formatPolymarketApiDecimal(live) : "—";
}

function pfLiveUnrealizedPnlCny(row: OrderRow): number | null {
  return pfUnrealizedPnlAtLiveCny(row, pfLiveClobPrice(row));
}

function pfLiveUnrealizedPnlText(row: OrderRow): string | null {
  return formatLiveUnrealizedPnlText(pfLiveUnrealizedPnlCny(row));
}

function pfShowLiveOdds(row: OrderRow): boolean {
  return pfShowLivePrice(row) && pfLiveClobPrice(row) != null;
}

function pfLastLineOddsText(row: OrderRow): string {
  const live = pfLiveClobPrice(row);
  if (live != null)
    return pfOddsTextFromClobPrice(live);
  return pfOrderOddsText(row);
}

async function onPmSell(row: OrderRow) {
  await confirmAndSellPmBuyOrder(row);
}

async function onPfSell(row: OrderRow) {
  await confirmAndSellPfBuyOrder(row);
}

function pmStakeLabel(row: OrderRow): string {
  return isPmSellOrderListRow(row) ? "回款" : "买入金额";
}

function onCancelMakeup(row: OrderRow) {
  const betId = makeupBetIdFromPendingRow(row);
  if (!betId)
    return;
  ElMessageBox.confirm("确认要取消补单吗？", "补单取消", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  })
    .then(() => {
      emit("cancelMakeup", betId);
    })
    .catch(() => {});
}

function shortOrderId(id: string): string {
  const s = String(id || "");
  if (s.length <= 10)
    return s;
  return `…${s.slice(-8)}`;
}

function stripOrderText(raw: string | null | undefined): string {
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || "—";
}

function findOrderRowById(orderId: string): OrderRow | null {
  const id = String(orderId || "");
  for (const [, rows] of props.orderEntries) {
    for (const row of orderListDisplayRows(rows)) {
      if (String(row.OrderID) === id)
        return row;
    }
  }
  return null;
}

/** 双写观察：peers 缓存，避免每行 O(n) 重建 */
const pePeerRows = computed(() => {
  const peers: OrderRow[] = [];
  for (const [, rows] of props.orderEntries)
    peers.push(...rows);
  return peers;
});

function peObserveTag(row: OrderRow) {
  return positionEventObserveTag(row, pePeerRows.value);
}

function formatRebindOrderBlock(label: string, row: OrderRow): string {
  const platform = String(row.Type || "—");
  const player = props.playerLabel(row) || String(row.Player?.UserName || "").trim() || "—";
  const lines = [
    `【${label}】${platform} / ${player}`,
    `订单：${shortOrderId(String(row.OrderID ?? ""))}`,
    `对阵：${stripOrderText(row.Match)}`,
    `盘口：${stripOrderText(row.Bet)}`,
    `选项：${stripOrderText(orderItemText(row))}`,
    `金额：${toFixed(Number(row.BetMoney) || 0, 0)}  赔率：${formatDisplayOdds(Number(row.Odds) || 0)}`,
    `Link：${formatLinkId(row.Link)}`,
  ];
  return lines.join("\n");
}

function clearDragUi() {
  drag.value = null;
  dropTargetOrderId.value = null;
  startEl = null;
  if (lineEl) {
    lineEl.remove();
    lineEl = null;
  }
  document.body.classList.remove("order-link-rebind-dragging");
}

function ensureLine() {
  if (lineEl)
    return lineEl;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("order-link-rebind-line");
  svg.setAttribute("aria-hidden", "true");
  Object.assign(svg.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "9998",
  });
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("stroke", "#7ec8ff");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-dasharray", "4 3");
  svg.appendChild(path);
  document.body.appendChild(svg);
  lineEl = svg;
  return svg;
}

function updateLine(x1: number, y1: number, x2: number, y2: number) {
  const svg = ensureLine();
  const path = svg.querySelector("path");
  if (!path)
    return;
  path.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2}`);
}

function findDropRow(el: EventTarget | null): OrderRow | null {
  const node = el instanceof Element ? el : null;
  const badge = node?.closest?.("[data-rebind-order-id]") as HTMLElement | null;
  if (!badge)
    return null;
  const orderId = badge.dataset.rebindOrderId || "";
  if (!orderId || !drag.value || orderId === drag.value.orderId)
    return null;
  for (const [, rows] of props.orderEntries) {
    for (const row of orderListDisplayRows(rows)) {
      if (String(row.OrderID) === orderId && isRebindableOrderRow(row)) {
        if (!canRebindOrderLinkTo(drag.value.fromLink, row.Link))
          return null;
        return row;
      }
    }
  }
  return null;
}

function onBadgePointerDown(e: PointerEvent, row: OrderRow) {
  if (!props.allowLinkRebind || !isRebindableOrderRow(row))
    return;
  if (e.button !== 0)
    return;
  e.preventDefault();
  e.stopPropagation();
  const orderId = String(row.OrderID);
  const fromLink = Number(row.Link);
  const target = e.currentTarget as HTMLElement;
  startEl = target;
  target.setPointerCapture(e.pointerId);
  drag.value = {
    orderId,
    fromLink,
    pointerId: e.pointerId,
  };
  document.body.classList.add("order-link-rebind-dragging");
  const rect = target.getBoundingClientRect();
  updateLine(rect.left + rect.width / 2, rect.top + rect.height / 2, e.clientX, e.clientY);
}

function onBadgePointerMove(e: PointerEvent) {
  if (!drag.value || e.pointerId !== drag.value.pointerId)
    return;
  if (startEl) {
    const rect = startEl.getBoundingClientRect();
    updateLine(rect.left + rect.width / 2, rect.top + rect.height / 2, e.clientX, e.clientY);
  }
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const row = findDropRow(over);
  dropTargetOrderId.value = row ? String(row.OrderID) : null;
}

async function finishRebind(source: DragState, target: OrderRow) {
  const sourceRow = findOrderRowById(source.orderId);
  if (!sourceRow)
    return;
  const fromLabel = formatLinkId(source.fromLink);
  const toLabel = formatLinkId(target.Link);
  const message = [
    "确认将下列订单改绑到同一 Link？（新→老）",
    "",
    formatRebindOrderBlock("源订单（改绑）", sourceRow),
    "",
    formatRebindOrderBlock("目标订单（承接 Link）", target),
    "",
    `Link：${fromLabel} → ${toLabel}`,
    "请核对对阵与盘口是否为同一场同一地图。此操作写入服务器。",
  ].join("\n");
  try {
    await ElMessageBox.confirm(
      message,
      "改绑订单 Link",
      {
        confirmButtonText: "确定改绑",
        cancelButtonText: "取消",
        type: "warning",
        customClass: "order-link-rebind-confirm",
      },
    );
  }
  catch {
    return;
  }
  try {
    await rebindOrderLink({
      orderId: source.orderId,
      toLinkId: Number(target.Link),
    });
    ElMessage.success("Link 已改绑");
    emit("linkRebindDone");
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "改绑失败");
  }
}

function onBadgePointerUp(e: PointerEvent) {
  if (!drag.value || e.pointerId !== drag.value.pointerId)
    return;
  const source = drag.value;
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const target = findDropRow(over);
  clearDragUi();
  if (target)
    void finishRebind(source, target);
}

function onBadgePointerCancel(e: PointerEvent) {
  if (!drag.value || e.pointerId !== drag.value.pointerId)
    return;
  clearDragUi();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && drag.value)
    clearDragUi();
}

if (typeof window !== "undefined")
  window.addEventListener("keydown", onKeydown);

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  clearDragUi();
  stopOddsLiveWatch?.();
  stopOddsLiveWatch = undefined;
  stopSportLiveWatch?.();
  stopSportLiveWatch = undefined;
});

function badgeClass(row: OrderRow): Record<string, boolean> {
  const id = String(row.OrderID);
  const rebindable = props.allowLinkRebind && isRebindableOrderRow(row);
  const dragging = drag.value?.orderId === id;
  const dropOk = dropTargetOrderId.value === id;
  const dropBlocked = !!(
    drag.value
    && rebindable
    && id !== drag.value.orderId
    && !canRebindOrderLinkTo(drag.value.fromLink, row.Link)
  );
  return {
    "order__platform-badge": true,
    "order__platform-badge--rebindable": rebindable,
    "order__platform-badge--dragging": dragging,
    "order__platform-badge--drop-ok": dropOk,
    "order__platform-badge--drop-blocked": dropBlocked,
  };
}

function badgeTitle(row: OrderRow): string {
  if (!props.allowLinkRebind || !isRebindableOrderRow(row))
    return String(row.Type || "");
  return "拖到更老 Link 的场馆徽章以改绑（确认框会展示两单详情）";
}
</script>

<template>
  <div class="orders" :class="{ loading, 'orders--rebind-active': !!drag }">
    <template v-for="[link, rows] in orderEntries" :key="link">
      <fieldset
        v-if="orderListDisplayRows(rows).length"
        class="orderlink"
        :class="{
          'orderlink--paired': isArbGroup(rows),
          'orderlink--unbound': groupHasUnboundPlaceholder(rows),
        }"
        :data-link-id="link"
      >
        <legend :class="orderLegendModifier(rows)">
          <span
            v-if="groupHasUnboundPlaceholder(rows)"
            class="orderlink__tag orderlink__tag--hash"
            title="本组仍有占位 Link，绑单确认前短暂态"
          >未绑单</span>
          {{ orderLegendText(rows) }}
        </legend>
        <div
          v-for="block in orderListDisplayBlocks(rows)"
          :key="block.key"
          class="order"
          :class="{ 'order--sell-attach': block.attach }"
        >
          <div
            v-if="block.attach"
            class="order__attach-label"
          >
            卖出记录
          </div>
          <div
            v-if="isMakeupPendingOrderRow(block.row)"
            class="order__status-anchor"
          >
            <i
              class="order__makeup-close"
              title="取消补单"
              role="button"
              @click="onCancelMakeup(block.row)"
            />
            <label class="status" :class="block.row.Status" />
          </div>
          <label v-else class="status" :class="statusClass(block.row)" />
          <div class="platform flex" :class="platformClass(block.row)">
            <span
              :class="badgeClass(block.row)"
              :data-rebind-order-id="isRebindableOrderRow(block.row) ? String(block.row.OrderID) : undefined"
              :title="badgeTitle(block.row)"
              @pointerdown="onBadgePointerDown($event, block.row)"
              @pointermove="onBadgePointerMove"
              @pointerup="onBadgePointerUp"
              @pointercancel="onBadgePointerCancel"
            >
              <PlatformIcon :platform="block.row.Type ?? ''" />
            </span>
            <div class="player">
              {{ playerLabel(block.row) }}
            </div>
            <span
              v-if="isFootballPodOrder(block.row)"
              class="order__pm-tag order__pm-tag--football"
              title="POD 足球跟单"
            >足球</span>
            <span
              v-if="pmOrderSideTagText(block.row) || pfOrderSideTagText(block.row)"
              class="order__pm-tag order__pm-tag--side"
              :class="(isPmSellOrderListRow(block.row) || isPfSellOrderListRow(block.row)) ? 'order__pm-tag--sell' : 'order__pm-tag--buy'"
            >{{ pmOrderSideTagText(block.row) || pfOrderSideTagText(block.row) }}</span>
            <span
              v-if="block.attach && block.sellSource"
              class="order__pm-tag order__pm-tag--pe"
              :class="block.sellSource === 'event' ? 'order__pm-tag--pe-event' : 'order__pm-tag--pe-row'"
              :title="block.sellSource === 'event' ? '展示来自买单 positionEvents' : '展示来自独立卖单行（事件缺失或未回填）'"
            >{{ block.sellSource === "event" ? "事件" : "卖单" }}</span>
            <template v-for="pe in [block.attach ? null : peObserveTag(block.row)]" :key="`pe-wrap-${block.key}`">
              <span
                v-if="pe"
                class="order__pm-tag order__pm-tag--pe"
                :class="pe.className"
                :title="pe.title"
              >{{ pe.text }}</span>
            </template>
          </div>
          <div v-if="isPfOrderListRow(block.row)" class="match">{{ pfMatchText(block.row) }}</div>
          <div v-else class="match" v-html="block.row.Match" />
          <div class="bet">
            <div class="betname">
              <span v-if="isPfOrderListRow(block.row)">{{ pfBetText(block.row) }}</span>
              <span v-else v-html="block.row.Bet" />
            </div>
            <div class="item">
              <label v-if="isPfOrderListRow(block.row)">{{ pfItemText(block.row) }}</label>
              <label v-else>{{ orderItemText(block.row) }}</label>
            </div>
          </div>
          <div class="profit">
            <template v-if="isPmOrderListRow(block.row)">
              <template v-if="isPmSellOrderListRow(block.row)">
                <div class="order__profit-line">
                  <span v-if="pmOrderSharesText(block.row)">份额：{{ pmOrderSharesText(block.row) }} </span>
                  <span>{{ pmStakeLabel(block.row) }}：{{ toFixed(pmOrderStakeDisplayCny(block.row), 0) }}</span>
                </div>
                <div class="order__profit-line">
                  <span v-if="pmOrderFillPriceText(block.row)">{{ pmOrderPriceLabel(block.row) }}：{{ pmOrderFillPriceText(block.row) }} </span>
                  <span v-if="pmOrderFillPriceText(block.row)">赔率：<span class="order__odds">{{ pmOrderOddsText(block.row) }}</span></span>
                </div>
              </template>
              <template v-else>
                <div class="order__profit-line">
                  <span v-if="pmOrderSharesText(block.row)">份额：{{ pmOrderSharesText(block.row) }} </span>
                  <span v-if="pmOrderFillPriceText(block.row)">{{ pmOrderPriceLabel(block.row) }}：{{ pmOrderFillPriceText(block.row) }} </span>
                  <span v-if="pmOrderFillPriceText(block.row)">赔率：<span class="order__odds">{{ pmOrderOddsText(block.row) }}</span></span>
                </div>
                <div class="order__profit-line">
                  {{ pmStakeLabel(block.row) }}：<slot name="buy-amount" :row="block.row">{{ toFixed(pmOrderStakeDisplayCny(block.row), 0) }}</slot>
                  <template v-if="isPendingRow(block.row) && !pmBuyLifecycleTagText(block.row)">
                    盈亏：待结算
                  </template>
                  <template v-else>
                    盈亏：{{ toFixed(pmOrderProfitDisplayCny(block.row, rows) ?? 0, 0) }}
                  </template>
                </div>
                <div class="order__profit-line order__profit-line--sell-row">
                  <span class="order__sell-row-meta">
                    <span v-if="pmShowLivePrice(block.row)">当前价：{{ pmLivePriceText(block.row) }} </span>
                    <span v-if="pmShowLiveOdds(block.row)">当前赔率：<span class="order__odds">{{ pmLastLineOddsText(block.row) }}</span> </span>
                    <span
                      v-if="pmLiveUnrealizedPnlText(block.row)"
                      class="order__live-pnl"
                      :class="{
                        pos: (pmLiveUnrealizedPnlCny(block.row) ?? 0) > 0,
                        neg: (pmLiveUnrealizedPnlCny(block.row) ?? 0) < 0,
                      }"
                    >{{ pmLiveUnrealizedPnlText(block.row) }}</span>
                  </span>
                  <button
                    v-if="showPmSellButton(block.row)"
                    type="button"
                    class="order__sell-btn"
                    :disabled="isPmManualSellInFlight(block.row.OrderID)"
                    @click="onPmSell(block.row)"
                  >
                    {{ isPmManualSellInFlight(block.row.OrderID) ? "卖出中…" : "卖出" }}
                  </button>
                </div>
              </template>
            </template>
            <template v-else-if="isPfOrderListRow(block.row)">
              <template v-if="isPfSellOrderListRow(block.row)">
                <div class="order__profit-line">
                  <span v-if="pfOrderSharesText(block.row)">份额：{{ pfOrderSharesText(block.row) }} </span>
                  <span>{{ pfStakeLabel(block.row) }}：{{ toFixed(pfOrderStakeDisplayCny(block.row), 0) }}</span>
                </div>
                <div class="order__profit-line">
                  <span v-if="pfOrderFillPriceText(block.row)">{{ pfOrderPriceLabel(block.row) }}：{{ pfOrderFillPriceText(block.row) }} </span>
                  <span v-if="pfOrderFillPriceText(block.row)">赔率：<span class="order__odds">{{ pfOrderOddsText(block.row) }}</span></span>
                </div>
              </template>
              <template v-else>
                <div class="order__profit-line">
                  <span v-if="pfOrderSharesText(block.row)">份额：{{ pfOrderSharesText(block.row) }} </span>
                  <span v-if="pfOrderFillPriceText(block.row)">{{ pfOrderPriceLabel(block.row) }}：{{ pfOrderFillPriceText(block.row) }} </span>
                  <span v-if="pfOrderFillPriceText(block.row)">赔率：<span class="order__odds">{{ pfOrderOddsText(block.row) }}</span></span>
                </div>
                <div class="order__profit-line">
                  {{ pfStakeLabel(block.row) }}：{{ toFixed(pfOrderStakeDisplayCny(block.row), 0) }}
                  <template v-if="isPendingRow(block.row) && !pfBuyLifecycleTagText(block.row)">
                    盈亏：待结算
                  </template>
                  <template v-else>
                    盈亏：{{ toFixed(pfOrderProfitDisplayCny(block.row) ?? 0, 0) }}
                  </template>
                </div>
                <div class="order__profit-line order__profit-line--sell-row">
                  <span class="order__sell-row-meta">
                    <span v-if="pfShowLivePrice(block.row)">当前价：{{ pfLivePriceText(block.row) }} </span>
                    <span v-if="pfShowLiveOdds(block.row)">当前赔率：<span class="order__odds">{{ pfLastLineOddsText(block.row) }}</span> </span>
                    <span
                      v-if="pfLiveUnrealizedPnlText(block.row)"
                      class="order__live-pnl"
                      :class="{
                        pos: (pfLiveUnrealizedPnlCny(block.row) ?? 0) > 0,
                        neg: (pfLiveUnrealizedPnlCny(block.row) ?? 0) < 0,
                      }"
                    >{{ pfLiveUnrealizedPnlText(block.row) }}</span>
                  </span>
                  <button
                    v-if="showPfSellButton(block.row)"
                    type="button"
                    class="order__sell-btn"
                    :disabled="isPfManualSellInFlight(block.row.OrderID)"
                    @click="onPfSell(block.row)"
                  >
                    {{ isPfManualSellInFlight(block.row.OrderID) ? "卖出中…" : "卖出" }}
                  </button>
                </div>
              </template>
            </template>
            <template v-else>
              买入金额：{{ toFixed(Number(block.row.BetMoney) || 0, 0) }} 赔率：<span class="order__odds">{{
                formatDisplayOdds(Number(block.row.Odds) || 0)
              }}</span>
              <template v-if="isMakeupPendingOrderRow(block.row)">
                盈亏：{{ makeupPendingProfitLabel(block.row) }}
              </template>
              <template v-else-if="isMakeupCancelledOrderRow(block.row)">
                盈亏：补单已手动取消
              </template>
              <template v-else-if="isPendingRow(block.row)">
                盈亏：待结算
              </template>
              <template v-else>
                盈亏：{{ toFixed(Number(block.row.Money) || 0, 0) }}
              </template>
            </template>
          </div>
          <div class="time">
            买入时间：{{ formatOrderTime(block.row.CreateAt || 0) }}
          </div>
          <div v-if="$slots['row-actions']" class="order-list__row-actions">
            <slot name="row-actions" :row="block.row" :link="link" :rows="rows" />
          </div>
          <OrderModeDetails v-if="block.row.PmGtcExecutionId && !$slots['row-actions']" :row="block.row" :readonly="!allowPmSell && !allowPfSell" />
        </div>
        <div v-if="$slots['group-monitor']" class="order-list__group-monitor">
          <slot name="group-monitor" :link="link" :rows="rows" />
        </div>
        <div v-if="$slots['group-actions']" class="order-list__group-actions">
          <slot name="group-actions" :link="link" :rows="rows" />
        </div>
      </fieldset>
    </template>
  </div>
</template>
