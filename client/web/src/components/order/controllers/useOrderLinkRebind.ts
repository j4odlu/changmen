import { onUnmounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { OrderRow } from "@/types/order";
import type { OrderListSource } from "../orderListTypes";
import { rebindOrderLink } from "@/api/order";
import { formatDisplayOdds, formatLinkId, toFixed } from "@changmen/client-core/shared/format";
import { canRebindOrderLinkTo, isRebindableOrderRow, orderListDisplayRows } from "@/shared/orderLink";
import { orderItemText } from "../orderListPresentation";

/** Pointer state and confirmation belong to the controller; the API remains the write boundary. */
export function useOrderLinkRebind(props: OrderListSource & Readonly<{
  allowLinkRebind: boolean; playerLabel: (row: OrderRow) => string;
}>, linkRebindDone: () => void) {
  type DragState = {
    orderId: string;
    fromLink: number;
    pointerId: number;
  };

  const drag = ref<DragState | null>(null);
  const dropTargetOrderId = ref<string | null>(null);
  let lineEl: SVGSVGElement | null = null;
  let startEl: HTMLElement | null = null;
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
      linkRebindDone();
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

  return { drag, badgeClass, badgeTitle, onBadgePointerDown, onBadgePointerMove, onBadgePointerUp, onBadgePointerCancel };
}
