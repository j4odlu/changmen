/**
 * SXBet best_odds：经 VPS hub（/esport/ws-forward/SXBET-MARKET），浏览器不持有 apiKey。
 */
import { reportVenueWsStatus } from "../shared/venueWsStatus";
import type { SxBestOddsWsUpdate } from "./api";
import { resolveSxBetMarketWsUrl } from "./wsConfig";

export type SxBetWsStatus = "disconnected" | "connecting" | "connected" | "error";
type SxBetWsStatusListener = (status: SxBetWsStatus) => void;

let sxBetWsStatus: SxBetWsStatus = "disconnected";
const sxBetWsStatusListeners = new Set<SxBetWsStatusListener>();

function setSxBetWsStatus(status: SxBetWsStatus) {
  if (sxBetWsStatus === status)
    return;
  sxBetWsStatus = status;
  reportVenueWsStatus("sx-market", status);
  for (const fn of sxBetWsStatusListeners)
    fn(status);
}

export function getSxBetWsStatus(): SxBetWsStatus {
  return sxBetWsStatus;
}

export function onSxBetWsStatus(fn: SxBetWsStatusListener): () => void {
  sxBetWsStatusListeners.add(fn);
  return () => sxBetWsStatusListeners.delete(fn);
}

export interface SxBetBestOddsWsHandle {
  ensureConnected(): Promise<boolean>;
  /** 可选：告知 hub 感兴趣的 marketHash（空=收全量） */
  setMarketHashes(hashes: string[]): void;
  stop(): void;
}

function emitUpdates(raw: unknown, onUpdate: (update: SxBestOddsWsUpdate) => void) {
  const rows = Array.isArray(raw) ? raw : [raw];
  for (const row of rows) {
    if (row && typeof row === "object")
      onUpdate(row as SxBestOddsWsUpdate);
  }
}

/**
 * 连 changmen SXBET-MARKET hub → 收 `{ type:"best_odds", data }`。
 */
export function startSxBetBestOddsWs(opts: {
  onUpdate: (update: SxBestOddsWsUpdate) => void;
}): SxBetBestOddsWsHandle {
  let stopped = false;
  let ws: WebSocket | null = null;
  let connecting: Promise<boolean> | null = null;
  let interestedHashes: string[] = [];
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function detach() {
    clearReconnect();
    try {
      ws?.close();
    }
    catch { /* ignore */ }
    ws = null;
  }

  function sendInterest() {
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return;
    ws.send(JSON.stringify({
      method: "subscribe",
      params: { marketHashes: interestedHashes },
    }));
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer)
      return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, 3_000);
  }

  async function connect(): Promise<boolean> {
    if (stopped)
      return false;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))
      return sxBetWsStatus === "connected" || ws.readyState === WebSocket.CONNECTING;

    setSxBetWsStatus("connecting");
    const url = resolveSxBetMarketWsUrl();
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    }
    catch (err) {
      console.warn("[SXBet WS] open failed", err);
      setSxBetWsStatus("error");
      scheduleReconnect();
      return false;
    }

    ws = sock;
    sock.onopen = () => {
      if (stopped || ws !== sock)
        return;
      setSxBetWsStatus("connected");
      sendInterest();
    };
    sock.onmessage = (ev) => {
      try {
        const text = typeof ev.data === "string" ? ev.data : String(ev.data);
        const msg = JSON.parse(text) as { type?: string; data?: unknown; message?: string };
        if (msg.type === "best_odds")
          emitUpdates(msg.data, opts.onUpdate);
        else if (msg.type === "error")
          console.warn("[SXBet WS] hub error", msg.message);
      }
      catch (err) {
        console.warn("[SXBet WS] message handler error", err);
      }
    };
    sock.onerror = () => {
      if (!stopped)
        setSxBetWsStatus("error");
    };
    sock.onclose = () => {
      if (ws === sock)
        ws = null;
      if (!stopped) {
        setSxBetWsStatus("error");
        scheduleReconnect();
      }
    };
    return true;
  }

  return {
    async ensureConnected() {
      if (stopped)
        return false;
      if (!connecting)
        connecting = connect().finally(() => { connecting = null; });
      return connecting;
    },
    setMarketHashes(hashes) {
      interestedHashes = [...new Set(hashes.map(h => String(h || "").trim()).filter(Boolean))];
      sendInterest();
    },
    stop() {
      stopped = true;
      detach();
      setSxBetWsStatus("disconnected");
    },
  };
}
