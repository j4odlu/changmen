import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";
import { reportVenueWsStatus } from "../venueWsStatus";
import { getChangmenAuthToken } from "../changmenAuthToken";
import { resolveChangmenWsBase } from "../changmenWsBase";

/** 与 server/realtime-hub/channels.js PM_SPORT_CHANNEL 一致 */
export const PM_SPORT_CHANNEL = "Polymarket:PmSport";

/** 与 server/realtime-hub/channels.js PM_MAINTENANCE_CHANNEL 一致 */
export const PM_MAINTENANCE_CHANNEL = "Polymarket:Maintenance";

type ChannelHandler = (message: unknown) => void;

let socket: Socket | null = null;
let refCount = 0;
let connecting: Promise<boolean> | null = null;
const handlers = new Map<string, Set<ChannelHandler>>();
const serverSubscribed = new Set<string>();

function hubOrigin(): string {
  return resolveChangmenWsBase();
}

function socketToken(): string {
  // [changmen 扩展] Cookie 会话 token 仅保存在 web 内存，统一 getter 覆盖此登录模式。
  return getChangmenAuthToken();
}

function dispatchChannel(channel: string, message: unknown) {
  const set = handlers.get(channel);
  if (!set)
    return;
  for (const fn of set)
    fn(message);
}

function emitWithAck<T>(
  event: string,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error("realtime hub 未连接"));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`${event} 超时`));
      }
    }, timeoutMs);
    socket.emit(event, payload, (ack: T) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

async function subscribeServerChannel(channel: string): Promise<void> {
  if (serverSubscribed.has(channel))
    return;
  const ack = await emitWithAck<{ ok?: boolean; error?: string }>(
    "pubsub:subscribe",
    { channel },
  );
  if (!ack?.ok)
    throw new Error(ack?.error || "订阅失败");
  serverSubscribed.add(channel);
}

function unsubscribeServerChannel(channel: string) {
  if (!serverSubscribed.has(channel))
    return;
  serverSubscribed.delete(channel);
  if (!socket?.connected)
    return;
  socket.emit("pubsub:unsubscribe", { channel });
}

async function resubscribeAllChannels() {
  if (!socket?.connected)
    return;
  serverSubscribed.clear();
  for (const channel of handlers.keys()) {
    try {
      const ack = await emitWithAck<{ ok?: boolean }>("pubsub:subscribe", { channel });
      if (ack?.ok)
        serverSubscribed.add(channel);
    }
    catch {
      /* reconnect will retry */
    }
  }
}

/** 连接 changmen realtime-hub（JWT 鉴权，同源 /esport/realtime） */
export async function ensureChangmenHubConnected(): Promise<boolean> {
  return connectSocket();
}

async function connectSocket(): Promise<boolean> {
  if (socket?.connected) {
    reportVenueWsStatus("cm-hub", "connected");
    return true;
  }
  if (connecting)
    return connecting;

  const token = socketToken();
  if (!token) {
    reportVenueWsStatus("cm-hub", "disconnected");
    return false;
  }

  reportVenueWsStatus("cm-hub", "connecting");
  connecting = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled)
        return;
      settled = true;
      connecting = null;
      resolve(ok);
    };

    socket?.removeAllListeners();
    socket?.disconnect();

    socket = io(hubOrigin(), {
      path: "/esport/realtime/socket.io",
      transports: ["websocket"],
      withCredentials: true,
      auth: { token },
      extraHeaders: {
        Origin: typeof window !== "undefined" ? window.location.origin : "",
        token,
      },
    });

    socket.on("connect", () => {
      reportVenueWsStatus("cm-hub", "connected");
      void resubscribeAllChannels();
      finish(true);
    });

    socket.on("pubsub:message", (packet: { channel?: string; content?: unknown }) => {
      if (packet?.channel)
        dispatchChannel(packet.channel, packet.content);
    });

    socket.on("connect_error", () => {
      reportVenueWsStatus("cm-hub", "error");
      finish(false);
    });
    socket.on("disconnect", () => {
      serverSubscribed.clear();
      if (refCount <= 0)
        reportVenueWsStatus("cm-hub", "disconnected");
    });
    setTimeout(() => {
      if (!socket?.connected)
        reportVenueWsStatus("cm-hub", "error");
      finish(Boolean(socket?.connected));
    }, 10_000);
  });

  return connecting;
}

/** 订阅 changmen 实时频道 */
export async function subscribeChangmenChannel(
  channel: string,
  handler: ChannelHandler,
): Promise<() => void> {
  refCount += 1;

  let set = handlers.get(channel);
  if (!set) {
    set = new Set();
    handlers.set(channel, set);
  }
  set.add(handler);

  const connected = await connectSocket();
  if (connected)
    await subscribeServerChannel(channel);

  return () => {
    set?.delete(handler);
    if (set && set.size === 0) {
      handlers.delete(channel);
      unsubscribeServerChannel(channel);
    }
    refCount -= 1;
    if (refCount <= 0) {
      socket?.removeAllListeners();
      socket?.disconnect();
      socket = null;
      serverSubscribed.clear();
      reportVenueWsStatus("cm-hub", "disconnected");
    }
  };
}

/** 向频道发布字符串消息（BetTarget / USER / Publish 等） */
export async function publishChangmenChannel(
  channel: string,
  message: string,
): Promise<boolean> {
  const connected = await connectSocket();
  if (!connected)
    return false;
  try {
    const ack = await emitWithAck<{ ok?: boolean }>("pubsub:publish", { channel, message });
    return Boolean(ack?.ok);
  }
  catch {
    return false;
  }
}

/** 取消服务端频道订阅（本地 handler 仍由 subscribe 返回的 cleanup 管理） */
export function leaveChangmenChannel(channel: string) {
  unsubscribeServerChannel(channel);
}
