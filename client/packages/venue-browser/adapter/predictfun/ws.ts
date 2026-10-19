import { reportVenueWsStatus } from "../shared/venueWsStatus";

import type { PredictOrderbookData } from "./parse";
import { resolvePredictFunMarketWsUrl } from "./wsConfig";

const WS_RECONNECT_MS = 5_000;
const HEARTBEAT_TOPIC = "heartbeat";

export type PredictWsStatus = "disconnected" | "connecting" | "connected" | "error";
type PredictWsStatusListener = (status: PredictWsStatus) => void;

let predictWsStatus: PredictWsStatus = "disconnected";
const predictWsStatusListeners = new Set<PredictWsStatusListener>();

function setPredictWsStatus(status: PredictWsStatus) {
  predictWsStatus = status;
  reportVenueWsStatus("predictfun-market", status);
  for (const fn of predictWsStatusListeners)
    fn(status);
}

export function getPredictWsStatus(): PredictWsStatus {
  return predictWsStatus;
}

export function onPredictWsStatus(fn: PredictWsStatusListener): () => void {
  predictWsStatusListeners.add(fn);
  return () => predictWsStatusListeners.delete(fn);
}

export interface PredictOrderbookUpdate {
  marketId?: string;
  orderbook?: PredictOrderbookData;
}

export interface PredictMarketWsHandle {
  subscribeMarketIds: (ids: string[]) => void;
  stop: () => void;
}

interface PredictWsMessage {
  type?: string;
  topic?: string;
  data?: PredictOrderbookData | number;
  requestId?: number;
  success?: boolean;
}

/** [Predict 官方] heartbeat 回包：{ method: "heartbeat", data: timestamp }，无 requestId/params */
export function formatPredictFunHeartbeatReply(data: unknown): string {
  return JSON.stringify({ method: "heartbeat", data });
}

function buildDirectWsUrl(): string {
  return resolvePredictFunMarketWsUrl();
}

/** [Predict 官方] wss://ws.predict.fun/ws，topic: predictOrderbook/{marketId} */
export function startPredictMarketWs(opts: {
  onOrderbook: (update: PredictOrderbookUpdate) => void;
}): PredictMarketWsHandle {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingIds: string[] = [];
  let requestId = 1;

  function sendSubscribe(ids: string[]) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !ids.length)
      return;
    for (const id of ids) {
      socket.send(JSON.stringify({
        method: "subscribe",
        requestId: requestId++,
        params: [`predictOrderbook/${id}`],
      }));
    }
  }

  function handleMessage(raw: string) {
    let payload: PredictWsMessage;
    try {
      payload = JSON.parse(raw) as PredictWsMessage;
    }
    catch {
      return;
    }
    if (payload.type === "M" && payload.topic === HEARTBEAT_TOPIC) {
      socket?.send(formatPredictFunHeartbeatReply(payload.data));
      return;
    }
    if (payload.type !== "M" || !payload.topic?.startsWith("predictOrderbook/"))
      return;
    const marketId = payload.topic.slice("predictOrderbook/".length);
    const orderbook = payload.data;
    if (!marketId || !orderbook || typeof orderbook !== "object")
      return;
    opts.onOrderbook({ marketId, orderbook });
  }

  function connect() {
    if (stopped)
      return;
    setPredictWsStatus("connecting");
    socket = new WebSocket(buildDirectWsUrl());

    socket.onopen = () => {
      setPredictWsStatus("connected");
      sendSubscribe(pendingIds);
    };

    socket.onmessage = (event) => {
      try {
        handleMessage(String(event.data));
      }
      catch (err) {
        console.warn("[PredictFun WS] message handler error", err);
      }
    };

    socket.onerror = () => {
      setPredictWsStatus("error");
    };

    socket.onclose = () => {
      socket = null;
      setPredictWsStatus(stopped ? "disconnected" : "error");
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer)
      return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, WS_RECONNECT_MS);
  }

  connect();

  return {
    subscribeMarketIds(ids: string[]) {
      const next = [...new Set(ids.filter(Boolean))];
      const nextSet = new Set(next);
      const removed = pendingIds.filter(id => !nextSet.has(id));
      pendingIds = next;
      if (socket?.readyState === WebSocket.OPEN && removed.length) {
        for (const id of removed) {
          socket.send(JSON.stringify({
            method: "unsubscribe",
            requestId: requestId++,
            params: [`predictOrderbook/${id}`],
          }));
        }
      }
      sendSubscribe(pendingIds);
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
      socket = null;
      setPredictWsStatus("disconnected");
    },
  };
}
