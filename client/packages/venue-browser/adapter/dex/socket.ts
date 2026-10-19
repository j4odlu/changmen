import { reportVenueWsStatus } from "../shared/venueWsStatus";
import { directPostJson } from "@changmen/client-core/shared/http";
import { DEX_SPORTSBOOK_BASE, DEX_CID, dexSportSlugs } from "./parse";

const WS_HOST = "wss://prod.dexsport.work/ws";
const PROFILE_URL = `${DEX_SPORTSBOOK_BASE}/public/api/profile`;
const RECONNECT_MS = 5_000;
const TOKEN_REFRESH_MS = 8 * 60 * 1000;

export type DexSocketStatus = "disconnected" | "connecting" | "connected" | "error";
type StatusListener = (status: DexSocketStatus) => void;
type BatchListener = (items: DexBatchItem[]) => void;

export interface DexBatchItem {
  model: string;
  lid: string;
  action: number;
  data: Record<string, unknown>;
}

let ws: WebSocket | null = null;
let status: DexSocketStatus = "disconnected";
let stopped = false;
let jwt = "";
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let tokenTimer: ReturnType<typeof setTimeout> | null = null;

const statusListeners = new Set<StatusListener>();
const batchListeners = new Set<BatchListener>();

const joined = {
  tournament: new Set<string>(),
  event: new Set<string>(),
  market: new Set<string>(),
};

function setStatus(s: DexSocketStatus) {
  status = s;
  reportVenueWsStatus("dex", s);
  for (const fn of statusListeners) fn(s);
}

export function getDexSocketStatus(): DexSocketStatus {
  return status;
}

export function onDexSocketStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function onDexBatch(fn: BatchListener): () => void {
  batchListeners.add(fn);
  return () => batchListeners.delete(fn);
}

async function fetchGuestJwt(): Promise<string> {
  const resp = await directPostJson<{ token?: string }>(
    PROFILE_URL,
    {},
    { guest: true, apiKey: DEX_CID },
  );
  return resp?.token ?? "";
}

function wsSend(msg: unknown) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const winnerMarketIds = new Set<string>();

function joinNew(model: string, ids: string[]) {
  const seen = joined[model as keyof typeof joined];
  if (!seen) return;
  const fresh = ids.filter(id => id && !seen.has(id));
  if (!fresh.length) return;
  fresh.forEach(id => seen.add(id));
  wsSend(["join", model, fresh]);
}

function leaveNonWinner(ids: string[]) {
  if (!ids.length) return;
  ids.forEach(id => joined.market.delete(id));
  wsSend(["leave", "market", ids]);
}

function handleBatchItems(items: unknown[][]) {
  const parsed: DexBatchItem[] = [];
  const toLeave: string[] = [];

  for (const row of items) {
    const model = String(row[0]);
    const lid = String(row[1]);
    const action = Number(row[2]);
    const data = (row[3] ?? {}) as Record<string, unknown>;

    if (model === "discipline" && Array.isArray(data.tournamentIds)) {
      joinNew("tournament", data.tournamentIds as string[]);
    }
    if (model === "tournament" && Array.isArray(data.eventIds)) {
      joinNew("event", data.eventIds as string[]);
    }
    if (model === "event" && Array.isArray(data.marketIds)) {
      const ids = (data.marketIds as (string | null)[]).filter(Boolean) as string[];
      if (ids.length) joinNew("market", ids);
    }
    if (model === "market") {
      const name = String(data.name ?? "");
      const outcomes = Array.isArray(data.outcomes) ? data.outcomes.length : 0;
      if (/winner|赢家|获胜/i.test(name) && !/1x2/i.test(name) && outcomes <= 2) {
        winnerMarketIds.add(lid);
      } else if (!winnerMarketIds.has(lid)) {
        toLeave.push(lid);
      }
    }
    parsed.push({ model, lid, action, data });
  }

  if (toLeave.length) {
    leaveNonWinner(toLeave);
  }

  if (parsed.length) {
    for (const fn of batchListeners) fn(parsed);
  }
}

function clearJoined() {
  joined.tournament.clear();
  joined.event.clear();
  joined.market.clear();
  winnerMarketIds.clear();
}

function connect() {
  if (ws) return;
  if (!jwt) return;

  setStatus("connecting");
  clearJoined();

  const url = `${WS_HOST}?cid=${DEX_CID}&token=${encodeURIComponent(jwt)}`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("[Dex WS] connected");
  };

  ws.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data as string) as unknown[];
      const type = parsed[0] as string;

      console.log("[Dex WS] msg:", type, type === "batch" ? (parsed[1] as unknown[]).length + " items" : "");

      if (type === "config") {
        setStatus("connected");
        wsSend(["join", "discipline", dexSportSlugs()]);
        return;
      }

      if (type === "batch") {
        handleBatchItems(parsed[1] as unknown[][]);
        return;
      }

      if (type === "error") {
        const payload = parsed[1] as Record<string, unknown>;
        console.warn("[Dex WS] error:", payload);
        if (Number(payload?.code) === 401) {
          jwt = "";
          ws?.close();
        }
      }
    } catch (err) {
      console.error("[Dex WS] parse error:", err, "raw data type:", typeof event.data, "data:", String(event.data).substring(0, 200));
    }
  };

  ws.onclose = () => {
    ws = null;
    if (stopped) {
      setStatus("disconnected");
      return;
    }
    setStatus("error");
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (stopped) return;
    if (!jwt) {
      try { jwt = await fetchGuestJwt(); } catch { /* retry next cycle */ }
    }
    connect();
  }, RECONNECT_MS);
}

function scheduleTokenRefresh() {
  if (tokenTimer) clearInterval(tokenTimer);
  tokenTimer = setInterval(async () => {
    if (stopped) return;
    try {
      const newJwt = await fetchGuestJwt();
      if (newJwt) jwt = newJwt;
    } catch { /* keep old jwt */ }
  }, TOKEN_REFRESH_MS);
}

export async function startDexSocket(): Promise<void> {
  stopped = false;
  try {
    jwt = await fetchGuestJwt();
  } catch (err) {
    console.warn("[Dex WS] guest JWT failed:", err);
    setStatus("error");
    scheduleReconnect();
    return;
  }
  connect();
  scheduleTokenRefresh();
}

export function stopDexSocket(): void {
  stopped = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (tokenTimer) { clearInterval(tokenTimer); tokenTimer = null; }
  if (ws) { ws.close(); ws = null; }
  clearJoined();
  setStatus("disconnected");
}
