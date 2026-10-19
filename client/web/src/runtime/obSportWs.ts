/**
 * OB 体育推送（足球 Tab 专用）。
 * HTTP / WS 均由足球页直连（yewu11 + yewuws2）。源站不按 Origin 卡 C105。
 * 禁止复用电竞 MQTT 与电竞 OB 通道。
 */
import { reportVenueWsStatus, type VenueWsStatus } from "@changmen/venue-browser/adapter/shared";
import { unzipObSportPushCd } from "@/runtime/obSportCodec";
import { parseObSportOrderStatusPush, type ObSportOrderStatusPatch } from "@/runtime/obSportOrderStatus";
import { yieldToPaint } from "@/runtime/rafTick";
import { olOdds, parseObHandicapLine } from "@/runtime/obSportOdds";
import {
  parseObSportHandicapPlay,
  parseObSportMatchLive,
  type ObSportLivePatch,
} from "@/runtime/obSportLive";

export const OB_SPORT_WS_ID = "ob-sport";
/** 九游/OB 体育 PC worker：API_PREFIX_WBSOCKET + /push */
export const OB_SPORT_WS_PATH = "/yewuws2/push";
const HEARTBEAT_MS = 15_000;

export type ObSportSessionLite = {
  token?: string;
  gateway?: string;
  wsUrl?: string;
  sessionId?: string;
  referer?: string;
};

export function obSportRawLooksLikeClock(raw: unknown): boolean {
  if (typeof raw !== "string")
    return false;
  const m = raw.match(/"cmd"\s*:\s*"([^"]+)"/i);
  const cmd = String(m?.[1] || "").toUpperCase();
  return cmd === "C0" || cmd === "C00" || cmd === "C102";
}

function rawPushMid(raw: unknown): string {
  if (typeof raw !== "string")
    return "";
  return raw.match(/"mid"\s*:\s*"?(\d{4,12})"?/i)?.[1] || "";
}

/** 积压时丢掉过期心跳/时钟，但每场保留最新一条 C102，否则标题永远没有进行时间。 */
export function trimObSportPushBacklog(queue: unknown[]) {
  if (queue.length < 24)
    return;
  const lastClockByMid = new Map<string, unknown>();
  let w = 0;
  for (const item of queue) {
    if (obSportRawLooksLikeClock(item)) {
      if (String(item).includes('"cmd"') && /"cmd"\s*:\s*"C102"/i.test(String(item)))
        lastClockByMid.set(rawPushMid(item) || "_", item);
      continue;
    }
    queue[w++] = item;
  }
  for (const item of lastClockByMid.values())
    queue[w++] = item;
  queue.length = w;
}

/** 足球列表 C8：全场/半场 独赢+让球+大小。 */
export const OB_SPORT_C8_FOOTBALL_HPID = "1,2,4,17,18,19";

/**
 * 官网 C8 mid 是短数字（滚球实测 5652292）。
 * 赛程袋里 19 位 id 订进去不出 C105。
 */
export function isObSportC8Mid(mid: string): boolean {
  return /^\d{4,12}$/.test(String(mid || "").trim());
}

export function buildObSportC8Subscribe(mids: string[], hpids = OB_SPORT_C8_FOOTBALL_HPID): Record<string, unknown> {
  const list = [...new Set(mids.map(m => String(m || "").trim()).filter(isObSportC8Mid))].map(mid => ({
    mid,
    hpid: hpids,
    level: 13,
  }));
  return {
    cmd: "C8",
    cufm: list.length === 1 ? "LM" : "L",
    list,
    marketLevel: "0",
    esMarketLevel: 0,
    earlyMarketLevel: "",
    rollingMarketLevel: "",
  };
}

const RECONNECT_MS = 5_000;

function setStatus(status: VenueWsStatus) {
  reportVenueWsStatus(OB_SPORT_WS_ID, status);
}

export function looksLikeMqttUrl(url: string): boolean {
  return /mqtt/i.test(String(url || ""));
}

/**
 * https://api.xxx → wss://api.xxx/yewuws2/push?requestId=token
 * [九游/OB 体育 PC] worker: url.replace("http","ws") + /yewuws2/push + ?requestId
 */
export function deriveObSportPushUrl(gateway: string, token: string): string {
  const gw = String(gateway || "").trim();
  const tok = String(token || "").trim();
  if (!gw || !tok)
    return "";
  try {
    const u = new URL(gw);
    if (u.protocol !== "http:" && u.protocol !== "https:")
      return "";
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    const q = new URLSearchParams();
    q.set("requestId", tok);
    return `${proto}//${u.host}${OB_SPORT_WS_PATH}?${q}`;
  }
  catch {
    return "";
  }
}

function withRequestId(wsUrl: string, token: string): string {
  const tok = String(token || "").trim();
  try {
    const u = new URL(wsUrl);
    if (!u.searchParams.get("requestId") && tok)
      u.searchParams.set("requestId", tok);
    return u.toString();
  }
  catch {
    return wsUrl;
  }
}

export function resolveObSportWsUrl(session: ObSportSessionLite | null | undefined): string {
  const token = String(session?.token || "").trim();
  const explicit = String(session?.wsUrl || "").trim();
  if (/^wss?:\/\//i.test(explicit) && !looksLikeMqttUrl(explicit))
    return withRequestId(explicit, token);
  return deriveObSportPushUrl(String(session?.gateway || ""), token);
}

export type ObSportPushQuote = {
  oid: string;
  odds: number;
  line?: number | null;
  mid?: string;
};

export type ObSportHandicapPlay = { mid: string; hpid: string };

function olStatusLocked(ol: Record<string, unknown>): boolean {
  const os = Number(ol.os);
  const hs = Number(ol.hs);
  return os === 2 || os === 3 || hs === 2;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function quotesFromHl(hl: Record<string, unknown>, mid: string): ObSportPushQuote[] {
  const out: ObSportPushQuote[] = [];
  const lineLocked = Number(hl.hs) === 2;
  const line = parseObHandicapLine(hl.hv);
  const hidMid = String(hl.mid || mid || "").trim();
  const ol = Array.isArray(hl.ol) ? hl.ol : [];
  for (const item of ol) {
    const row = asRecord(item);
    if (!row)
      continue;
    const oid = String(row.oid ?? row.oddId ?? "").trim();
    if (!oid)
      continue;
    const odds = lineLocked || olStatusLocked(row) ? 0 : olOdds(row);
    const q: ObSportPushQuote = { oid, odds };
    if (line != null)
      q.line = line;
    if (hidMid)
      q.mid = hidMid;
    out.push(q);
  }
  return out;
}

function quotesFromC105(cd: Record<string, unknown>): ObSportPushQuote[] {
  const mid = String(cd.mid || "").trim();
  const out: ObSportPushQuote[] = [];
  const hls = Array.isArray(cd.hls) ? cd.hls : [];
  for (const item of hls) {
    const hl = asRecord(item);
    if (hl)
      out.push(...quotesFromHl(hl, mid));
  }
  const hls2 = asRecord(cd.hls2);
  if (hls2) {
    for (const group of Object.values(hls2)) {
      const list = Array.isArray(group) ? group : [group];
      for (const item of list) {
        const hl = asRecord(item);
        if (hl)
          out.push(...quotesFromHl(hl, mid));
      }
    }
  }
  return out;
}

/** 官网 Worker 有时包一层 data/payload，再才是 cmd+cd。 */
export function unwrapObSportPush(msg: unknown): unknown {
  let cur = msg;
  for (let i = 0; i < 4; i++) {
    const row = asRecord(cur);
    if (!row)
      return cur;
    if (row.cmd || row.CMD)
      return row;
    const inner = row.data ?? row.payload ?? row.msg ?? row.body;
    if (inner == null || inner === cur)
      return cur;
    cur = inner;
  }
  return cur;
}

/** C102/心跳等不含盘口，禁止整棵树扫 oid（滚球约 10 次/秒）。 */
const SKIP_ODDS_WALK = new Set([
  "C0", "C00", "C8", "C101", "C102", "C103", "C109", "C302", "C303",
  "C201", "C202", "C118",
]);

/** 源站推送里抽出 oid + 欧赔（港水 ov2 / 欧赔 ov×1e5）。C105 hls/hls2 / 散字段都能走。 */
export function parseObSportPushOdds(msg: unknown): ObSportPushQuote[] {
  const root = asRecord(unwrapObSportPush(msg));
  const cd = asRecord(root?.cd);
  const cmd = String(root?.cmd || root?.CMD || "").toUpperCase();
  if (SKIP_ODDS_WALK.has(cmd))
    return [];
  if (root && (cmd === "C105" || cd?.hls || cd?.hls2)) {
    if (cd) {
      const fromHl = quotesFromC105(cd);
      if (fromHl.length)
        return fromHl;
    }
  }
  const out: ObSportPushQuote[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object")
      return;
    const row = node as Record<string, unknown>;
    const oid = String(row.oid ?? row.oddId ?? "").trim();
    if (oid && (row.ov2 != null || row.ov != null || row.hk != null || row.odds != null || row.os != null)) {
      out.push({ oid, odds: olStatusLocked(row) ? 0 : olOdds(row) });
    }
    for (const v of Object.values(row)) {
      if (Array.isArray(v)) {
        for (const item of v)
          walk(item);
      }
      else if (v && typeof v === "object")
        walk(v);
    }
  };
  walk(root || msg);
  return out;
}

export type ObSportWsHandlers = {
  onQuotes: (rows: ObSportPushQuote[]) => void;
  onLive?: (patch: ObSportLivePatch) => void;
  onHandicapPlay?: (row: ObSportHandicapPlay) => void;
  onOrderStatus?: (rows: ObSportOrderStatusPatch[]) => void;
};

export type ObSportWsHandle = {
  /** oids：本地过滤；mids：官方 C8 订阅（试玩页实测） */
  sync: (oids: string[], mids?: string[]) => void;
  stop: () => void;
};

function decodePayload(raw: unknown): unknown {
  if (raw == null)
    return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    }
    catch {
      return null;
    }
  }
  if (typeof Blob !== "undefined" && raw instanceof Blob)
    return null;
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(raw)) {
    try {
      return JSON.parse(new TextDecoder().decode(raw as Uint8Array));
    }
    catch {
      return null;
    }
  }
  if (typeof raw === "object")
    return raw;
  return null;
}

async function decodeIncoming(raw: unknown): Promise<unknown> {
  if (typeof Blob !== "undefined" && raw instanceof Blob) {
    try {
      return decodePayload(await raw.text());
    }
    catch {
      return null;
    }
  }
  return decodePayload(raw);
}

/**
 * @param handlers 只应写入 sportOddsStore / obSportLiveStore，禁止写电竞 fo
 */
export function startObSportWs(
  getSession: () => ObSportSessionLite | null | undefined,
  handlers: ObSportWsHandlers,
): ObSportWsHandle {
  let ws: WebSocket | null = null;
  let wantedMids: string[] = [];
  let lastC8Key = "";
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let activeUrl = "";
  let activeToken = "";
  const incoming: unknown[] = [];
  let pumping = false;

  const emitQuotes = (parsed: unknown) => {
    const quotes = parseObSportPushOdds(parsed);
    if (!quotes.length)
      return;
    handlers.onQuotes(quotes);
  };

  const ingest = async (parsed: unknown) => {
    if (stopped)
      return;
    if (Array.isArray(parsed)) {
      for (const item of parsed)
        await ingest(item);
      return;
    }
    const peeled = unwrapObSportPush(parsed);
    if (peeled !== parsed) {
      await ingest(peeled);
      return;
    }
    const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    if (root && typeof root.cd === "string") {
      const unzipped = await unzipObSportPushCd(root.cd);
      if (stopped)
        return;
      if (unzipped && typeof unzipped === "object")
        root.cd = unzipped;
    }
    emitQuotes(parsed);
    const live = parseObSportMatchLive(parsed);
    if (live)
      handlers.onLive?.(live);
    const play = parseObSportHandicapPlay(parsed);
    if (play)
      handlers.onHandicapPlay?.(play);
    const cmd = String(root?.cmd || root?.CMD || "").toUpperCase();
    const orderStatus = parseObSportOrderStatusPush(parsed);
    if (orderStatus.length || cmd === "C201" || cmd === "C118")
      handlers.onOrderStatus?.(orderStatus);
  };

  const clearReconnect = () => {
    if (!reconnectTimer)
      return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const stopHeartbeat = () => {
    if (!heartbeatTimer)
      return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const canSend = () => ws?.readyState === 1;

  const sendJson = (payload: Record<string, unknown>) => {
    if (!ws || ws.readyState !== 1)
      return;
    try {
      ws.send(JSON.stringify(payload));
    }
    catch { /* ignore */ }
  };

  const sendC8 = (token: string) => {
    if (!canSend())
      return;
    const payload = buildObSportC8Subscribe(wantedMids);
    const list = Array.isArray(payload.list) ? payload.list : [];
    if (!list.length)
      return;
    const key = JSON.stringify(list);
    if (key === lastC8Key)
      return;
    lastC8Key = key;
    sendJson({ ...payload, requestId: token });
  };

  const startHeartbeat = (token: string) => {
    stopHeartbeat();
    if (!token)
      return;
    sendJson({ cmd: "C0", requestId: token });
    sendC8(token);
    heartbeatTimer = setInterval(() => {
      if (!canSend())
        return;
      sendJson({ cmd: "C0", requestId: token });
    }, HEARTBEAT_MS);
  };

  const pumpIncoming = async () => {
    if (pumping)
      return;
    pumping = true;
    try {
      while (incoming.length && !stopped) {
        trimObSportPushBacklog(incoming);
        const raw = incoming.shift();
        if (raw == null)
          continue;
        const parsed = await decodeIncoming(raw);
        if (parsed)
          await ingest(parsed);
        if (incoming.length)
          await yieldToPaint();
      }
    }
    finally {
      pumping = false;
      if (incoming.length && !stopped)
        void pumpIncoming();
    }
  };

  const onTransportOpen = (token: string) => {
    if (stopped)
      return;
    setStatus("connected");
    lastC8Key = "";
    startHeartbeat(token);
  };

  const onTransportMessage = (raw: unknown) => {
    if (stopped)
      return;
    incoming.push(raw);
    trimObSportPushBacklog(incoming);
    void pumpIncoming();
  };

  const disconnect = () => {
    clearReconnect();
    stopHeartbeat();
    incoming.length = 0;
    lastC8Key = "";
    if (activeToken && canSend())
      sendJson({ cmd: "C00", requestId: activeToken });
    try {
      ws?.close();
    }
    catch { /* ignore */ }
    ws = null;
    activeUrl = "";
    activeToken = "";
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer)
      return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
  };

  const connectJsonWs = (url: string, token: string) => {
    setStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    }
    catch {
      setStatus("error");
      scheduleReconnect();
      return;
    }
    ws = socket;
    activeUrl = url;
    activeToken = token;
    socket.addEventListener("open", () => {
      if (stopped || ws !== socket)
        return;
      onTransportOpen(token);
    });
    socket.addEventListener("message", (ev) => {
      if (stopped || ws !== socket)
        return;
      onTransportMessage(ev.data);
    });
    socket.addEventListener("error", () => {
      if (ws !== socket)
        return;
      setStatus("error");
    });
    socket.addEventListener("close", () => {
      if (ws !== socket)
        return;
      stopHeartbeat();
      ws = null;
      activeUrl = "";
      activeToken = "";
      if (stopped) {
        setStatus("disconnected");
        return;
      }
      setStatus("error");
      scheduleReconnect();
    });
  };

  const connect = () => {
    if (stopped)
      return;
    const session = getSession();
    const url = resolveObSportWsUrl(session);
    if (!url) {
      disconnect();
      setStatus("disconnected");
      return;
    }
    if (looksLikeMqttUrl(url)) {
      disconnect();
      setStatus("error");
      return;
    }
    const token = String(session?.token || "").trim();
    if (activeUrl === url && (ws?.readyState === 0 || ws?.readyState === 1))
      return;
    disconnect();
    activeUrl = url;
    activeToken = token;
    setStatus("connecting");
    connectJsonWs(url, token);
  };

  return {
    sync(oids: string[], mids: string[] = []) {
      if (stopped)
        return;
      void oids;
      wantedMids = [...new Set(mids.map(m => String(m || "").trim()).filter(isObSportC8Mid))];
      connect();
      if (activeToken && canSend())
        sendC8(activeToken);
    },
    stop() {
      stopped = true;
      disconnect();
      setStatus("disconnected");
    },
  };
}
