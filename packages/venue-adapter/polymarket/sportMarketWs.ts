import { notePmTickFrame } from "./pmTickState";
/**
 * Polymarket 体育 MARKET WS（独立于电竞 `ws.ts`）。
 * - 官方可达时直连 PM，否则连 PM-SPORT-MARKET hub；不读写电竞 singleton
 * - 不调用 setPmMarketWsSourceMode / setPmUserWsSourceMode（避免交叉影响电竞）
 */

import type { PmMarketWsSourceMode } from "./pmMarketWsMode";
import { reportVenueWsStatus } from "../shared/venueWsStatus";
import { getPmMarketWsSourceMode } from "./pmMarketWsMode";
import { resolvePolymarketSportMarketWsUrl } from "./sportWsConfig";

const WS_RECONNECT_MS = 5_000;
const WS_PING_MS = 10_000;
const OFFICIAL_RETRY_MS = 60_000;

export interface PolymarketSportMarketWsHandle {
  send: (msg: string) => void;
  stop: () => void;
}

interface SportMarketWsOpts {
  onMessage: (raw: string) => void;
  onOpen: () => void;
}

type SportWsStatus = "disconnected" | "connecting" | "connected" | "error";

let activeSportHandle: PolymarketSportMarketWsHandle | null = null;

function setSportStatus(status: SportWsStatus) {
  reportVenueWsStatus("pm-sport-market", status);
}

function createSportMarketWs(opts: SportMarketWsOpts): PolymarketSportMarketWsHandle {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let officialRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let sourceMode: PmMarketWsSourceMode = getPmMarketWsSourceMode();

  function clearPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function clearOfficialRetry() {
    if (officialRetryTimer) {
      clearTimeout(officialRetryTimer);
      officialRetryTimer = null;
    }
  }

  function scheduleOfficialRetry(socket: WebSocket) {
    clearOfficialRetry();
    if (sourceMode !== "changmen" || getPmMarketWsSourceMode() !== "official")
      return;
    officialRetryTimer = setTimeout(() => {
      officialRetryTimer = null;
      if (stopped || ws !== socket)
        return;
      clearPing();
      sourceMode = "official";
      ws = null;
      socket.close();
      scheduleReconnect(0);
    }, OFFICIAL_RETRY_MS);
  }

  function scheduleReconnect(delay = WS_RECONNECT_MS) {
    if (stopped || reconnectTimer)
      return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (stopped || ws)
      return;
    setSportStatus("connecting");
    const socket = new WebSocket(resolvePolymarketSportMarketWsUrl(sourceMode));
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket)
        return;
      setSportStatus("connected");
      opts.onOpen();
      clearPing();
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN)
          ws.send("PING");
      }, WS_PING_MS);
      scheduleOfficialRetry(socket);
    };

    socket.onmessage = (event) => {
      if (ws !== socket)
        return;
      const raw = String(event.data);
      notePmTickFrame(raw);
      if (raw === "PONG")
        return;
      if (!raw.trim().startsWith("{") && !raw.trim().startsWith("["))
        return;
      try {
        opts.onMessage(raw);
      }
      catch (err) {
        console.warn("[Polymarket Sport WS] parse error", err);
      }
    };

    socket.onclose = () => {
      if (ws !== socket)
        return;
      clearPing();
      clearOfficialRetry();
      ws = null;
      if (stopped) {
        setSportStatus("disconnected");
        return;
      }
      if (sourceMode === "official")
        sourceMode = "changmen";
      setSportStatus("error");
      scheduleReconnect();
    };

    socket.onerror = () => {
      if (ws !== socket)
        return;
      setSportStatus("error");
      socket.close();
    };
  }

  connect();

  const handle: PolymarketSportMarketWsHandle = {
    send(msg: string) {
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(msg);
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearPing();
      clearOfficialRetry();
      const socket = ws;
      ws = null;
      try {
        socket?.close();
      }
      catch {
        /* ignore */
      }
      setSportStatus("disconnected");
      if (activeSportHandle === handle)
        activeSportHandle = null;
    },
  };

  return handle;
}

/** 启动体育 MARKET WS；不触碰电竞 `startPolymarketMarketWs` / activeMarketWsHandle。 */
export function startPolymarketSportMarketWs(opts: SportMarketWsOpts): PolymarketSportMarketWsHandle {
  activeSportHandle?.stop();
  const handle = createSportMarketWs(opts);
  activeSportHandle = handle;
  return handle;
}
