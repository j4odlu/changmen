import { io, type Socket } from "socket.io-client";
import { reportVenueWsStatus } from "../shared/venueWsStatus";
import { LIMITLESS_WS } from "./api";
import type { LimitlessOrderbookUpdate } from "./api";

const WS_RECONNECT_MS = 5_000;

export type LimitlessWsStatus = "disconnected" | "connecting" | "connected" | "error";
type LimitlessWsStatusListener = (status: LimitlessWsStatus) => void;

let limitlessWsStatus: LimitlessWsStatus = "disconnected";
const limitlessWsStatusListeners = new Set<LimitlessWsStatusListener>();

function setLimitlessWsStatus(status: LimitlessWsStatus) {
  limitlessWsStatus = status;
  reportVenueWsStatus("lm-market", status);
  for (const fn of limitlessWsStatusListeners)
    fn(status);
}

export function getLimitlessWsStatus(): LimitlessWsStatus {
  return limitlessWsStatus;
}

export function onLimitlessWsStatus(fn: LimitlessWsStatusListener): () => void {
  limitlessWsStatusListeners.add(fn);
  return () => limitlessWsStatusListeners.delete(fn);
}

export interface LimitlessMarketWsHandle {
  subscribeSlugs: (slugs: string[]) => void;
  stop: () => void;
}

/** Limitless CLOB 公开 orderbook 推送（无需鉴权） */
export function startLimitlessMarketWs(opts: {
  onOrderbook: (update: LimitlessOrderbookUpdate) => void;
}): LimitlessMarketWsHandle {
  let stopped = false;
  let socket: Socket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSlugs: string[] = [];

  function emitSubscribe(slugs: string[]) {
    if (!socket?.connected || !slugs.length)
      return;
    socket.emit("subscribe_market_prices", { marketSlugs: slugs });
  }

  function connect() {
    if (stopped || socket)
      return;
    setLimitlessWsStatus("connecting");
    socket = io(LIMITLESS_WS, {
      transports: ["websocket"],
      reconnection: false,
    });

    socket.on("connect", () => {
      setLimitlessWsStatus("connected");
      emitSubscribe(pendingSlugs);
    });

    socket.on("orderbookUpdate", (data: LimitlessOrderbookUpdate) => {
      try {
        opts.onOrderbook(data);
      }
      catch (err) {
        console.warn("[Limitless WS] orderbook handler error", err);
      }
    });

    socket.on("disconnect", () => {
      socket = null;
      setLimitlessWsStatus(stopped ? "disconnected" : "error");
      scheduleReconnect();
    });

    socket.on("connect_error", () => {
      setLimitlessWsStatus("error");
      socket?.disconnect();
      socket = null;
      scheduleReconnect();
    });
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
    subscribeSlugs(slugs: string[]) {
      pendingSlugs = [...new Set(slugs.filter(Boolean))];
      emitSubscribe(pendingSlugs);
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.disconnect();
      socket = null;
      setLimitlessWsStatus("disconnected");
    },
  };
}
