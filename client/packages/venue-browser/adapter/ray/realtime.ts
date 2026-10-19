import socketClusterClient from "socketcluster-client";
import {
  bumpDirectRealtimeMessage,
  getDirectRealtimeStatus,
  patchDirectRealtimeStatus,
  resetDirectRealtimeStatus,
  upstreamRouteFromUrl,
} from "../shared/directRealtimeStatus";
import { PLATFORMS } from "../shared/platforms";
import {
  getRayChangmenScConfig,
  getRayOfficialScConfig,
  RAY_SC_CHANNEL,
  RAY_WS_CONNECT_TIMEOUT_MS,
  type RayScConnectConfig,
  type RayWsEndpointSource,
} from "./wsConfig";

const PLATFORM = PLATFORMS.RAY;

const RAY_WS_SOURCE_MODE_KEY = "changmen:ray:ws-source-mode";
const FAILOVER_ORDER: RayWsEndpointSource[] = ["official", "changmen"];
const SOURCE_MODE_ORDER = FAILOVER_ORDER;

export type RayWsSourceMode = RayWsEndpointSource;

function readStoredSourceMode(): RayWsSourceMode {
  try {
    const value = globalThis.localStorage?.getItem(RAY_WS_SOURCE_MODE_KEY);
    if (value === "changmen") return value;
    return "official";
  } catch {
    return "official";
  }
}

let rayWsSourceMode: RayWsSourceMode = readStoredSourceMode();

export function getRayWsSourceMode(): RayWsSourceMode {
  return rayWsSourceMode;
}

export function rayWsSourceModeLabel(mode: RayWsSourceMode = rayWsSourceMode): string {
  switch (mode) {
    case "changmen":
      return "CHANGMEN 转发";
    default:
      return "官方源";
  }
}

export function setRayWsSourceMode(mode: RayWsSourceMode): RayWsSourceMode {
  // 历史 localStorage 可能存 a8；一律落到官方
  rayWsSourceMode = mode === "changmen" ? "changmen" : "official";
  mode = rayWsSourceMode;
  try {
    globalThis.localStorage?.setItem(RAY_WS_SOURCE_MODE_KEY, mode);
  } catch {
    /* ignore storage errors */
  }
  patchDirectRealtimeStatus(PLATFORM, {
    upstreamConnected: false,
    upstreamRoute: mode,
    lastError: `RAY WS 切换到${rayWsSourceModeLabel(mode)}，等待重连`,
  });
  return rayWsSourceMode;
}

export function cycleRayWsSourceMode(): RayWsSourceMode {
  const idx = SOURCE_MODE_ORDER.indexOf(rayWsSourceMode);
  const next = SOURCE_MODE_ORDER[(idx + 1) % SOURCE_MODE_ORDER.length]!;
  return setRayWsSourceMode(next);
}

function configForSourceMode(mode: RayWsSourceMode): RayScConnectConfig {
  switch (mode) {
    case "changmen":
      return getRayChangmenScConfig();
    default:
      return getRayOfficialScConfig();
  }
}

export type RayRealtimeMessage = {
  source?: "odds" | "match" | string;
  odds?: Array<Record<string, unknown>>;
  match?: unknown;
};

export type RayRealtimeStatus = {
  platform: string;
  upstreamConnected: boolean;
  messagesReceived?: number;
  lastError?: string | null;
  lastUpstreamAt?: number | null;
};

export type RayRealtimeClient = {
  start(onMessage: (message: RayRealtimeMessage) => void): Promise<void>;
  stop(): Promise<void>;
  status?(): Promise<RayRealtimeStatus>;
};

function scUrlLabel(config: RayScConnectConfig): string {
  const scheme = config.secure ? "wss" : "ws";
  return `${scheme}://${config.hostname}:${config.port}${config.path}`;
}

function nextFailoverConfig(failedSource: RayWsEndpointSource): RayScConnectConfig {
  const idx = FAILOVER_ORDER.indexOf(failedSource);
  const next = FAILOVER_ORDER[(idx + 1) % FAILOVER_ORDER.length]!;
  switch (next) {
    case "official":
      return getRayOfficialScConfig();
    case "changmen":
      return getRayChangmenScConfig();
    default:
      return getRayOfficialScConfig();
  }
}

function createDirectRayRealtimeClient(): RayRealtimeClient {
  let socket: ReturnType<typeof socketClusterClient.create> | null = null;
  let activeConfig: RayScConnectConfig | null = null;
  let stopped = false;
  let failoverBusy = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let onMessageHandler: ((message: RayRealtimeMessage) => void) | null = null;

  const clearConnectTimer = () => {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  };

  const tearDownSocket = () => {
    clearConnectTimer();
    socket?.disconnect();
    socket = null;
  };

  const requestFailover = (reason: string) => {
    if (stopped || failoverBusy) return;
    const selectedMode = getRayWsSourceMode();
    if (selectedMode !== "official") {
      console.warn(
        `[RAY WS] ${selectedMode} source failed, staying on selected ${rayWsSourceModeLabel(selectedMode)}:`,
        reason,
      );
      return;
    }
    const failedSource = activeConfig?.source;
    if (!failedSource) return;
    void failoverFrom(failedSource, reason);
  };

  const failoverFrom = async (failedSource: RayWsEndpointSource, reason: string) => {
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
      const nextConfig = nextFailoverConfig(failedSource);
      console.warn(`[RAY WS] ${failedSource} failed, switching to ${nextConfig.source}:`, reason);
      await connectWithConfig(nextConfig);
    } finally {
      failoverBusy = false;
    }
  };

  const connectWithConfig = async (config: RayScConnectConfig) => {
    if (stopped) return;

    tearDownSocket();
    activeConfig = config;
    const label = scUrlLabel(config);

    patchDirectRealtimeStatus(PLATFORM, {
      upstreamConnected: false,
      upstreamRoute: null,
      lastError: null,
    });

    socket = socketClusterClient.create({
      hostname: config.hostname,
      secure: config.secure,
      port: config.port,
      path: config.path,
      protocolVersion: 1,
      autoConnect: true,
      connectTimeout: RAY_WS_CONNECT_TIMEOUT_MS,
      ackTimeout: 10_000,
      wsOptions: config.wsOptions,
    });

    void (async () => {
      for await (const _ of socket!.listener("connect")) {
        if (stopped) break;
        clearConnectTimer();
        console.info("[RAY WS] connected", label, `(${config.source})`);
        patchDirectRealtimeStatus(PLATFORM, {
          upstreamConnected: true,
          upstreamRoute: upstreamRouteFromUrl(label, config.source),
          lastError: null,
        });
      }
    })();

    void (async () => {
      for await (const _ of socket!.listener("disconnect")) {
        if (stopped) break;
        patchDirectRealtimeStatus(PLATFORM, { upstreamConnected: false, upstreamRoute: null });
        requestFailover("connection closed");
      }
    })();

    void (async () => {
      for await (const event of socket!.listener("error")) {
        if (stopped) break;
        const message =
          event && typeof event === "object" && "error" in event
            ? String((event as { error?: unknown }).error ?? event)
            : String(event ?? "ws error");
        patchDirectRealtimeStatus(PLATFORM, {
          upstreamConnected: false,
          upstreamRoute: null,
          lastError: message,
        });
        console.warn("[RAY WS] error", message, label, `(${config.source})`);
        requestFailover(message);
      }
    })();

    connectTimer = setTimeout(() => {
      if (stopped || socket?.state === socket!.OPEN) return;
      console.warn("[RAY WS] connect timeout", label, `(${config.source})`);
      requestFailover("connect timeout");
    }, RAY_WS_CONNECT_TIMEOUT_MS);

    try {
      const channel = socket.subscribe(RAY_SC_CHANNEL);
      await channel.listener("subscribe").once();
      void (async () => {
        try {
          for await (const msg of channel) {
            if (stopped) break;
            bumpDirectRealtimeMessage(PLATFORM);
            onMessageHandler?.(msg as RayRealtimeMessage);
          }
        } catch (err) {
          if (!stopped) requestFailover(err instanceof Error ? err.message : String(err));
        }
      })();
    } catch (err) {
      requestFailover(err instanceof Error ? err.message : String(err));
    }
  };

  return {
    async start(onMessage) {
      onMessageHandler = onMessage;
      stopped = false;
      await connectWithConfig(configForSourceMode(getRayWsSourceMode()));
    },
    async stop() {
      stopped = true;
      tearDownSocket();
      onMessageHandler = null;
      activeConfig = null;
      resetDirectRealtimeStatus(PLATFORM);
    },
    async status() {
      return getDirectRealtimeStatus(PLATFORM);
    },
  };
}

export function createRayRealtimeClient(): RayRealtimeClient {
  return createDirectRayRealtimeClient();
}
