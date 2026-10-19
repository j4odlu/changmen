import { io, type Socket } from "socket.io-client";
import {
  bumpDirectRealtimeMessage,
  getDirectRealtimeStatus,
  patchDirectRealtimeStatus,
  resetDirectRealtimeStatus,
  upstreamRouteFromUrl,
} from "../shared/directRealtimeStatus";
import { PLATFORMS } from "../shared/platforms";
import { IA_A8_COLLECT } from "./a8Collect";
import {
  getIaChangmenWsConfig,
  getIaOfficialWsConfig,
  IA_DEFAULT_GATEWAY,
  IA_ROOM_JOIN,
  IA_WS_CONNECT_TIMEOUT_MS,
  type IaWsConnectConfig,
  type IaWsEndpointSource,
} from "./wsConfig";

const PLATFORM = PLATFORMS.IA;

/** 任意两次 failover 之间的最小间隔，避免 official↔changmen 疯狂抖动 */
export const IA_FAILOVER_COOLDOWN_MS = 5_000;

export type IaRealtimeMessage = Record<string, unknown>;

export type IaRealtimeStatus = {
  platform: string;
  upstreamConnected: boolean;
  messagesReceived?: number;
  lastError?: string | null;
  lastUpstreamAt?: number | null;
};

export type IaRealtimeClient = {
  start(onMessage: (message: IaRealtimeMessage) => void): Promise<IaRealtimeStatus | void>;
  stop(): Promise<IaRealtimeStatus | void>;
  status?(): Promise<IaRealtimeStatus | unknown>;
};

const FAILOVER_ORDER: IaWsEndpointSource[] = ["official", "changmen"];

/** 浏览器无法伪造 Origin：page origin ≠ 官网 gateway 时 official 必失败 */
export function isIaOfficialOriginHopeless(
  gateway: string,
  pageOrigin: string | undefined = typeof location !== "undefined" ? location.origin : undefined,
): boolean {
  if (!pageOrigin) return false;
  return pageOrigin !== gateway.replace(/\/+$/, "");
}

function configForSource(source: IaWsEndpointSource, gateway: string): IaWsConnectConfig {
  return source === "changmen" ? getIaChangmenWsConfig(gateway) : getIaOfficialWsConfig(gateway);
}

function nextFailoverConfig(
  failedSource: IaWsEndpointSource,
  gateway: string,
): IaWsConnectConfig {
  // localhost / 非 ilustre 页：只走 CHANGMEN，绝不回 official（Origin 拒连 → 无限抖动）
  if (isIaOfficialOriginHopeless(gateway)) {
    return getIaChangmenWsConfig(gateway);
  }

  const idx = FAILOVER_ORDER.indexOf(failedSource);
  const next = idx === -1 ? FAILOVER_ORDER[0]! : FAILOVER_ORDER[(idx + 1) % FAILOVER_ORDER.length]!;
  return configForSource(next, gateway);
}

function initialConfig(gateway: string): IaWsConnectConfig {
  if (isIaOfficialOriginHopeless(gateway)) return getIaChangmenWsConfig(gateway);
  return getIaOfficialWsConfig(gateway);
}

function createDirectIaRealtimeClient(gateway: string): IaRealtimeClient {
  let socket: Socket | null = null;
  let onMessageHandler: ((message: IaRealtimeMessage) => void) | null = null;
  let activeConfig: IaWsConnectConfig | null = null;
  let stopped = false;
  let failoverBusy = false;
  let intentionalDisconnect = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFailoverAt = 0;

  const clearConnectTimer = () => {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  };

  const clearCooldownTimer = () => {
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
  };

  const sleepCooldown = async (ms: number) => {
    if (ms <= 0) return;
    await new Promise<void>((resolve) => {
      clearCooldownTimer();
      cooldownTimer = setTimeout(() => {
        cooldownTimer = null;
        resolve();
      }, ms);
    });
  };

  const tearDownSocket = () => {
    clearConnectTimer();
    if (!socket) return;
    intentionalDisconnect = true;
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    intentionalDisconnect = false;
  };

  const requestFailover = (reason: string) => {
    if (stopped || failoverBusy || intentionalDisconnect) return;
    const failedSource = activeConfig?.source;
    if (!failedSource) return;
    void failoverFrom(failedSource, reason);
  };

  const failoverFrom = async (failedSource: IaWsEndpointSource, reason: string) => {
    if (stopped || failoverBusy) return;
    failoverBusy = true;
    try {
      tearDownSocket();
      activeConfig = null;
      patchDirectRealtimeStatus(PLATFORM, {
        upstreamConnected: false,
        upstreamRoute: null,
        lastError: reason,
      });

      const nextConfig = nextFailoverConfig(failedSource, gateway);
      const waitMs = Math.max(0, IA_FAILOVER_COOLDOWN_MS - (Date.now() - lastFailoverAt));
      const sameSource = nextConfig.source === failedSource;

      if (sameSource || waitMs > 0) {
        const delay = sameSource ? Math.max(waitMs, IA_FAILOVER_COOLDOWN_MS) : waitMs;
        console.warn(
          `[IA WS] ${failedSource} failed (${reason}); retry ${nextConfig.source} in ${delay}ms`,
        );
        await sleepCooldown(delay);
        if (stopped) return;
      } else {
        console.warn(
          `[IA WS] ${failedSource} failed, switching to ${nextConfig.source}:`,
          reason,
        );
      }

      lastFailoverAt = Date.now();
      await connectWithConfig(nextConfig);
    } finally {
      failoverBusy = false;
    }
  };

  const warnOfficialOriginMismatch = (source: IaWsEndpointSource) => {
    if (source !== "official" || typeof location === "undefined") return;
    const expected = gateway.replace(/\/+$/, "");
    if (location.origin === expected) return;
    console.warn(
      "[IA WS] official socket.ajj123.net expects Origin",
      expected,
      "but page is",
      location.origin,
      "— will failover to CHANGMEN",
    );
  };

  const connectWithConfig = async (config: IaWsConnectConfig) => {
    if (stopped) return;

    tearDownSocket();
    activeConfig = config;
    const { url, path, source, extraHeaders, auth, withCredentials } = config;
    warnOfficialOriginMismatch(source);

    patchDirectRealtimeStatus(PLATFORM, {
      upstreamConnected: false,
      upstreamRoute: null,
      lastError: null,
    });

    socket = io(url, {
      transports: ["websocket"],
      reconnection: false,
      path,
      ...(withCredentials ? { withCredentials: true } : {}),
      ...(extraHeaders ? { extraHeaders } : {}),
      auth,
    });

    socket.on("connect", () => {
      clearConnectTimer();
      console.info("[IA WS] connected", url, path, `(${source})`);
      patchDirectRealtimeStatus(PLATFORM, {
        upstreamConnected: true,
        upstreamRoute: upstreamRouteFromUrl(url, source),
        lastError: null,
      });
      socket?.emit("RoomJoin", IA_ROOM_JOIN);
      socket?.on("roomMessageCallBack", (message: unknown) => {
        bumpDirectRealtimeMessage(PLATFORM);
        onMessageHandler?.((message ?? {}) as IaRealtimeMessage);
      });
    });

    socket.on("disconnect", () => {
      patchDirectRealtimeStatus(PLATFORM, { upstreamConnected: false, upstreamRoute: null });
      if (!intentionalDisconnect) requestFailover("connection closed");
    });

    socket.on("connect_error", (err: Error) => {
      console.warn("[IA WS] connect error", err.message, url, `(${source})`);
      patchDirectRealtimeStatus(PLATFORM, {
        upstreamConnected: false,
        upstreamRoute: null,
        lastError: err.message,
      });
      requestFailover(err.message);
    });

    connectTimer = setTimeout(() => {
      if (stopped || socket?.connected) return;
      console.warn("[IA WS] connect timeout", url, `(${source})`);
      requestFailover("connect timeout");
    }, IA_WS_CONNECT_TIMEOUT_MS);
  };

  return {
    async start(onMessage) {
      onMessageHandler = onMessage;
      stopped = false;
      lastFailoverAt = 0;
      clearCooldownTimer();

      if (socket?.connected) return getDirectRealtimeStatus(PLATFORM);

      const first = initialConfig(gateway);
      if (first.source === "changmen" && isIaOfficialOriginHopeless(gateway)) {
        console.info(
          "[IA WS] page Origin ≠ ilustre; skip official, use CHANGMEN forward",
          typeof location !== "undefined" ? location.origin : "",
        );
      }
      await connectWithConfig(first);
      return getDirectRealtimeStatus(PLATFORM);
    },
    async stop() {
      stopped = true;
      clearCooldownTimer();
      tearDownSocket();
      onMessageHandler = null;
      activeConfig = null;
      resetDirectRealtimeStatus(PLATFORM);
      return getDirectRealtimeStatus(PLATFORM);
    },
    async status() {
      return getDirectRealtimeStatus(PLATFORM);
    },
  };
}

/** 官网 → CHANGMEN 转发 */
export function createIaRealtimeClient(gateway: string = IA_DEFAULT_GATEWAY): IaRealtimeClient {
  return createDirectIaRealtimeClient(gateway);
}

/** A8 `wQe` 默认 gateway（与 HTTP 采集对象 `t` 同源） */
export const IA_A8_REALTIME_GATEWAY = IA_A8_COLLECT.gateway;
