/**
 * [changmen 扩展] 把 Chrome 扩展 PB sports-websocket 观测状态报到右上角角标，
 * 并把 latestOdds 灌入影子价表（**不写** fo / 不改主价）。
 *
 * 影子价灌入由本机偏好 pbWsShadowUi 控制（默认关）；关则清空旁显，主价仍只走 HTTP fo。
 */
import { a8PluginSend, hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import { reportVenueWsStatus, type VenueWsStatus } from "../shared/venueWsStatus";
import { getPbAccountPageHosts, hasPbAccountPageHostsBeenSet } from "./accountHosts";
import {
  clearPbWsShadow,
  countPbWsShadowBySource,
  debugPbWsShadowLayers,
  getPbWsShadow,
  listPbWsShadowIds,
  listPbWsShadowIdsBySource,
  replacePbWsShadowFromBoard,
  type PbWsBoardCard,
} from "./wsShadowOdds";

/** 旁显跟手：50ms 拉扩展板；hook 侧 WS/euro 立即 flush */
const POLL_MS = 50;
const PB_WS_ID = "pb";

/**
 * 运行时门控挂 globalThis，避免 Vite 分包 / HMR 让 poll 与 userStore 各持一份 `let`：
 * poll 那份一直 false → 每 50ms `clearPbWsShadow()`，BetRow 永远看不到 M。
 */
const SHADOW_UI_GATE_KEY = "__CM_PB_WS_SHADOW_UI_ALLOWED__";

/** 与 `client/web/src/shared/pbExtensionsLocal.ts` / `pbWsShadowUiLocal.ts` 同键 */
const PB_EXTENSIONS_LOCAL_KEY = "changmen:pbExtensions";
const PB_WS_SHADOW_UI_LOCAL_KEY = "changmen:pbWsShadowUi";

type ShadowUiGateHost = typeof globalThis & { [SHADOW_UI_GATE_KEY]?: boolean };

function shadowUiGateHost(): ShadowUiGateHost {
  return globalThis as ShadowUiGateHost;
}

function readShadowPrefsFromLocal(): boolean {
  try {
    const ls = globalThis.localStorage;
    if (!ls)
      return false;
    if (ls.getItem(PB_EXTENSIONS_LOCAL_KEY) !== "1")
      return false;
    const shadow = ls.getItem(PB_WS_SHADOW_UI_LOCAL_KEY);
    if (shadow === "0")
      return false;
    return true;
  }
  catch {
    return false;
  }
}

/** 由 web userStore 在加载/保存扩展偏好时同步；未调用时回退本机 localStorage */
export function setPbWsShadowUiAllowed(on: boolean): void {
  const next = on === true;
  const g = shadowUiGateHost();
  const prev = g[SHADOW_UI_GATE_KEY];
  g[SHADOW_UI_GATE_KEY] = next;
  if (prev === next) {
    // 关着也清一次：避免 false→false 早退时残留旁显表
    if (!next)
      clearPbWsShadow();
    return;
  }
  if (!next)
    clearPbWsShadow();
}

export function isPbWsShadowUiAllowed(): boolean {
  const gated = shadowUiGateHost()[SHADOW_UI_GATE_KEY];
  if (typeof gated === "boolean")
    return gated;
  return readShadowPrefsFromLocal();
}

/** 单测：回到「未调用 setPbWsShadowUiAllowed」以便测 localStorage 回退 */
export function resetPbWsShadowUiAllowedForTests(): void {
  delete shadowUiGateHost()[SHADOW_UI_GATE_KEY];
}

type PbWsObserveBag = {
  enabled?: boolean;
  /** 扩展按投注账号 referer/gateway 主机 tabs.query */
  pageDetected?: boolean;
  pageCount?: number;
  observe?: {
    connected?: boolean;
    running?: boolean;
    phase?: string;
    lastError?: string;
    lastType?: string;
    frameCount?: number;
    readyState?: number;
    latestOdds?: PbWsBoardCard[];
  } | null;
};

export type PbWsPageDetect = {
  detected: boolean;
  count: number;
};

const PAGE_DETECT_KEY = "__CM_PB_WS_PAGE_DETECT__";

type PageDetectHost = typeof globalThis & { [PAGE_DETECT_KEY]?: PbWsPageDetect };

function pageDetectHost(): PageDetectHost {
  return globalThis as PageDetectHost;
}

export function getPbWsPageDetect(): PbWsPageDetect {
  return pageDetectHost()[PAGE_DETECT_KEY] ?? { detected: false, count: 0 };
}

export function setPbWsPageDetect(detected: boolean, count = 0): void {
  pageDetectHost()[PAGE_DETECT_KEY] = {
    detected: detected === true,
    count: Number.isFinite(count) ? Math.max(0, Number(count)) : 0,
  };
}

export function resetPbWsPageDetectForTests(): void {
  delete pageDetectHost()[PAGE_DETECT_KEY];
}

/** 导出供单测。无网页灰；有网页实心黄；仅握手中才闪；WS 通绿。 */
export function mapObserveToStatus(bag: PbWsObserveBag | null | undefined): VenueWsStatus {
  if (!bag) return "disconnected";
  const o = bag.observe || {};
  if (o.phase === "ws_closed" || o.phase === "off" || o.phase === "hook_stop") {
    if (o.lastError)
      return "error";
    return "disconnected";
  }
  if (o.readyState === 3)
    return "error";
  // socket OPEN、已收 CONNECTED/PING、或 phase=connected：都算已连
  if (o.connected === true || o.readyState === 1 || o.phase === "connected")
    return "connected";
  const lastType = String(o.lastType || "");
  if (Number(o.frameCount) > 0 && /^(CONNECTED|PING|PONG|UPDATE_|FULL_)/.test(lastType))
    return "connected";
  if (o.lastError)
    return "error";
  if (bag.pageDetected !== true)
    return "disconnected";
  if (
    o.phase === "hook_start"
    || o.phase === "wait_connected"
    || o.phase === "ws_connecting"
  ) {
    return "connecting";
  }
  return "detected";
}

function periodsOf(ids: string[], eventId: string): number[] {
  const set = new Set<number>();
  for (const id of ids) {
    const parts = id.split("|");
    if (parts[0] !== eventId)
      continue;
    const n = Number(parts[1]);
    if (Number.isFinite(n))
      set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 一键找旁显 M。用法：`__CM_PB_FIND_M__()`
 * - 有可见 M：滚过去并绿描边
 * - 仅有「同 event 但已是 H」：黄描边（fo 已漂移，等新 WS）
 * - 都不在 DOM：返回 map 里的 eventId，方便切滚球/搜场
 */
function installFindMHelper(): void {
  try {
    const g = globalThis as {
      __CM_PB_FIND_M__?: () => Record<string, unknown>;
    };
    // 每次覆盖，避免 HMR / 旧闭包残留
    g.__CM_PB_FIND_M__ = () => {
      const bySource = countPbWsShadowBySource();
      const mapMIds = listPbWsShadowIdsBySource("M");
      const layers = debugPbWsShadowLayers();
      const mapMEventIds = [
        ...new Set(mapMIds.map((id) => id.split("|")[0]!).filter(Boolean)),
      ];

      const listedIds = [
        ...document.querySelectorAll<HTMLElement>("[data-pb-home-id]"),
      ]
        .map((el) => String(el.dataset.pbHomeId || "").trim())
        .filter(Boolean);
      const listedEventIds = [
        ...new Set(listedIds.map((id) => id.split("|")[0]!).filter(Boolean)),
      ];
      const overlapEventIds = mapMEventIds.filter((eid) => listedEventIds.includes(eid));
      const overlapListedOddIds = listedIds.filter((id) =>
        overlapEventIds.includes(id.split("|")[0]!),
      );
      const overlapMapMOddIds = mapMIds.filter((id) =>
        overlapEventIds.includes(id.split("|")[0]!),
      );
      const overlapBoardOddIds = layers.board.filter((id) =>
        overlapEventIds.includes(id.split("|")[0]!),
      );
      const overlapCollectOddIds = layers.collect.filter((id) =>
        overlapEventIds.includes(id.split("|")[0]!),
      );
      const periodCompare = overlapEventIds.slice(0, 8).map((eid) => ({
        eventId: eid,
        listed: periodsOf(listedIds, eid),
        mapM: periodsOf(mapMIds, eid),
        board: periodsOf(layers.board, eid),
        collect: periodsOf(layers.collect, eid),
      }));
      const allShadows = [
        ...document.querySelectorAll<HTMLElement>(".pb-ws-shadow"),
      ];
      const mNodes = allShadows.filter((el) =>
        /^M/i.test((el.textContent || "").trim())
          || el.dataset.shadowSrc === "M",
      );
      const hNodesOnMapM = allShadows.filter((el) => {
        if (!(/^H/i.test((el.textContent || "").trim()) || el.dataset.shadowSrc === "H"))
          return false;
        const eid = (el.dataset.oddId || "").split("|")[0] || "";
        return eid !== "" && mapMEventIds.includes(eid);
      });

      const listedCells = [
        ...document.querySelectorAll<HTMLElement>("[data-pb-home-id]"),
      ].filter((el) => overlapEventIds.includes((el.dataset.pbHomeId || "").split("|")[0]!));

      const outline = (nodes: HTMLElement[], color: string) => {
        for (const el of nodes) {
          const cell = el.classList.contains("item-odds")
            ? el
            : el.closest(".item-odds") as HTMLElement | null;
          if (!cell) continue;
          cell.style.outline = `2px solid ${color}`;
          cell.style.outlineOffset = "1px";
          window.setTimeout(() => {
            cell.style.outline = "";
            cell.style.outlineOffset = "";
          }, 4000);
        }
      };

      let scrolled = false;
      let focus: "visible_M" | "same_event_H" | "not_in_list" | "no_M" = "no_M";

      if (mNodes.length > 0) {
        focus = "visible_M";
        outline(mNodes, "#3dd68c");
        mNodes[0]!.scrollIntoView({ behavior: "smooth", block: "center" });
        scrolled = true;
      } else if (hNodesOnMapM.length > 0) {
        focus = "same_event_H";
        outline(hNodesOnMapM, "#e3b341");
        hNodesOnMapM[0]!.scrollIntoView({ behavior: "smooth", block: "center" });
        scrolled = true;
      } else if (bySource.M > 0) {
        focus = "not_in_list";
        if (listedCells.length > 0) {
          outline(listedCells, "#6aa6ff");
          listedCells[0]!.scrollIntoView({ behavior: "smooth", block: "center" });
          scrolled = true;
        }
      }

      const tip =
        focus === "visible_M"
          ? undefined
          : focus === "same_event_H"
            ? "列表里有同 event，但旁显已是 H（fo 比旧 WS 新）；等 part888 再推价应变回 M"
            : focus === "not_in_list"
              ? overlapEventIds.length
                ? `板上有 M 且列表有同 event（${overlapEventIds.slice(0, 4).join(", ")}）。listed vs map 的 period 见 periodCompare；无 .pb-ws-shadow 时已蓝描 [data-pb-home-id]`
                : `表有 M×${bySource.M}，当前列表 event 对不上板。板：${mapMEventIds.slice(0, 6).join(", ")}；列表：${listedEventIds.slice(0, 6).join(", ") || "无 data-pb-home-id（硬刷主站）"}`
              : "影子表尚无 M：确认 part888 观测开着且有 UPDATE_ODDS";

      return {
        visibleM: mNodes.length,
        visibleHOnMapMEvents: hNodesOnMapM.length,
        mapM: bySource.M,
        mapH: bySource.H,
        boardN: layers.board.length,
        collectN: layers.collect.length,
        sampleM: mapMIds.slice(0, 8),
        mapMEventIds: mapMEventIds.slice(0, 12),
        listedEventIds: listedEventIds.slice(0, 12),
        listedOddIds: listedIds.slice(0, 16),
        overlapEventIds: overlapEventIds.slice(0, 12),
        overlapListedOddIds: overlapListedOddIds.slice(0, 16),
        overlapMapMOddIds: overlapMapMOddIds.slice(0, 16),
        overlapBoardOddIds: overlapBoardOddIds.slice(0, 16),
        overlapCollectOddIds: overlapCollectOddIds.slice(0, 16),
        periodCompare,
        sample: mNodes.slice(0, 12).map((el) => (el.textContent || "").trim()),
        scrolled,
        focus,
        tip,
      };
    };
  } catch {
    /* ignore */
  }
}

function writeDebug(patch: Record<string, unknown>): void {
  try {
    installFindMHelper();
    const g = globalThis as { __CM_PB_SHADOW_DEBUG__?: Record<string, unknown> };
    g.__CM_PB_SHADOW_DEBUG__ = {
      ...(g.__CM_PB_SHADOW_DEBUG__ || {}),
      ...patch,
      findM: "控制台执行 __CM_PB_FIND_M__()：滚动到可见 M 并描边 4s",
      at: Date.now(),
    };
  } catch {
    /* ignore */
  }
}

/** 仅当用户开了影子价且扩展观测开才灌旁显；绝不写 fo */
export function ingestShadow(bag: PbWsObserveBag | null | undefined): void {
  const shadowUiAllowed = isPbWsShadowUiAllowed();
  if (!shadowUiAllowed) {
    clearPbWsShadow();
    writeDebug({
      shadowUiAllowed: false,
      enabled: bag?.enabled === true,
      reason: "prefs_shadow_off",
      shadowIds: 0,
      pageDetected: bag?.pageDetected === true,
      pageCount: Number(bag?.pageCount) || 0,
    });
    return;
  }
  // 扩展默认开观测；仅显式 false 才清。`enabled` 缺失不得当成关（否则 CONNECTED 仍无 M）
  const observeEnabled = bag?.enabled !== false;
  if (bag?.enabled === false) {
    clearPbWsShadow();
    writeDebug({ shadowUiAllowed: true, enabled: false, reason: "observe_off", shadowIds: 0 });
    return;
  }
  const o = bag?.observe || {};
  if (o.phase === "off") {
    clearPbWsShadow();
    writeDebug({ shadowUiAllowed: true, enabled: observeEnabled, reason: "phase_off", shadowIds: 0 });
    return;
  }
  const cards = o.latestOdds;
  if (!Array.isArray(cards) || !cards.length) {
    writeDebug({
      shadowUiAllowed: true,
      enabled: observeEnabled,
      reason: "empty_board_keep",
      phase: o.phase,
      connected: o.connected,
      // 追加观测侧关键信息：帮助区分是“没收到 UPDATE_ODDS”还是“收到了但解析写不进 board”
      frameCount: (o as { frameCount?: unknown }).frameCount,
      readyState: (o as { readyState?: unknown }).readyState,
      lastType: (o as { lastType?: unknown }).lastType,
      lastDestination: (o as { lastDestination?: unknown }).lastDestination,
      lastError: (o as { lastError?: unknown }).lastError,
      inboundTypeCount: (o as { inboundTypeCount?: unknown }).inboundTypeCount,
      inboundDest: (o as { inboundDest?: unknown }).inboundDest,
      subscribedOut: (o as { subscribedOut?: unknown }).subscribedOut,
      checklist: (o as { checklist?: unknown }).checklist,
      shadowIds: listPbWsShadowIds().length,
    });
    return;
  }
  if (!isPbWsShadowUiAllowed()) {
    clearPbWsShadow();
    return;
  }
  replacePbWsShadowFromBoard(cards);
  if (!isPbWsShadowUiAllowed()) {
    clearPbWsShadow();
    return;
  }
  const bySource = countPbWsShadowBySource();
  const shadowIds = listPbWsShadowIds();
  const boardEventIds = [
    ...new Set(cards.map((c) => String(c.eventId ?? "")).filter(Boolean)),
  ];
  writeDebug({
    shadowUiAllowed: true,
    enabled: true,
    reason: "ok",
    cardCount: cards.length,
    boardEventIds: boardEventIds.slice(0, 12),
    sampleEventIds: cards.slice(0, 5).map((c) => c.eventId),
    sampleRot: cards.slice(0, 5).map((c) => c.rotNum || ""),
    shadowIds: shadowIds.length,
    bySource,
    sampleShadowIds: shadowIds.slice(0, 8),
    sampleM: shadowIds.filter((id) => getPbWsShadow(id)?.source === "M").slice(0, 8),
    hint:
      bySource.M === 0
        ? "board_ok_but_no_M_patches"
        : "M_exists_in_map__UI_shows_H_when_row_HomeID_event_not_in_board",
    pricedCards: cards.filter((c) => (c.home && String(c.home).trim()) || (c.away && String(c.away).trim())).length,
    listedEventIds: (() => {
      try {
        return [
          ...new Set(
            [...document.querySelectorAll<HTMLElement>("[data-pb-home-id]")]
              .map((el) => String(el.dataset.pbHomeId || "").split("|")[0] || "")
              .filter(Boolean),
          ),
        ].slice(0, 12);
      } catch {
        return [];
      }
    })(),
  });
}

async function pollOnce(): Promise<void> {
  if (!hasA8PluginRuntime()) {
    setPbWsPageDetect(false, 0);
    reportVenueWsStatus(PB_WS_ID, "disconnected");
    clearPbWsShadow();
    writeDebug({ reason: "no_plugin", pageDetected: false, pageCount: 0 });
    return;
  }
  try {
    const bag = (await a8PluginSend({
      type: "pbWsObserveGet",
      data: hasPbAccountPageHostsBeenSet()
        ? { hosts: getPbAccountPageHosts() }
        : {},
    })) as PbWsObserveBag;
    const pageCount = Number(bag?.pageCount);
    setPbWsPageDetect(bag?.pageDetected === true, Number.isFinite(pageCount) ? pageCount : 0);
    reportVenueWsStatus(PB_WS_ID, mapObserveToStatus(bag));
    ingestShadow(bag);
  } catch (err) {
    reportVenueWsStatus(PB_WS_ID, "disconnected");
    setPbWsPageDetect(false, 0);
    writeDebug({
      reason: "poll_error_keep",
      error: err instanceof Error ? err.message : String(err),
      shadowIds: listPbWsShadowIds().length,
      pageDetected: false,
      pageCount: 0,
    });
  }
}

/** 与 PB collector 同生命周期；返回 stop */
export function startPbWsStatusPoll(): () => void {
  let stopped = false;
  const tick = async () => {
    while (!stopped) {
      await pollOnce();
      await new Promise<void>((r) => setTimeout(r, POLL_MS));
    }
  };
  void tick();
  return () => {
    stopped = true;
    setPbWsPageDetect(false, 0);
    reportVenueWsStatus(PB_WS_ID, "disconnected");
    clearPbWsShadow();
  };
}