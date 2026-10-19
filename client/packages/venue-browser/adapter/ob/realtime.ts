import mqtt, { type MqttClient } from "mqtt";
import {
  bumpDirectRealtimeMessage,
  getDirectRealtimeStatus,
  patchDirectRealtimeStatus,
  resetDirectRealtimeStatus,
  upstreamRouteFromUrl,
} from "../shared/directRealtimeStatus";
import { PLATFORMS } from "../shared/platforms";
import { OB_MQTT_CONNECT_TIMEOUT_MS } from "./mqttConfig";
import {
  fetchObDemoMqttConfig,
  getObChangmenMqttConfig,
  type ObMqttConnectConfig,
  type ObMqttEndpointSource,
} from "./mqttSession";

const PLATFORM = PLATFORMS.OB;

const OB_MQTT_SOURCE_MODE_KEY = "changmen:ob:mqtt-source-mode";
const FAILOVER_ORDER: ObMqttEndpointSource[] = ["demo", "changmen"];
const SOURCE_MODE_ORDER = FAILOVER_ORDER;

export type ObMqttSourceMode = ObMqttEndpointSource;

export type ObMqttMessage = {
  topic: string;
  payload: string;
};

export type ObRealtimeStatus = {
  platform: string;
  upstreamConnected: boolean;
  messagesReceived?: number;
  messagesPublished?: number;
  lastError?: string | null;
  lastUpstreamAt?: number | null;
  forwardedTopics?: number;
};

export type ObRealtimeClient = {
  start(onMessage: (message: ObMqttMessage) => void): Promise<ObRealtimeStatus | void>;
  stop(): Promise<ObRealtimeStatus | void>;
  status?(): Promise<ObRealtimeStatus | unknown>;
  subscribe(topic: string): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  connected(): boolean;
};

function readStoredSourceMode(): ObMqttSourceMode {
  try {
    const value = globalThis.localStorage?.getItem(OB_MQTT_SOURCE_MODE_KEY);
    if (value === "official" || value === "a8") return "demo";
    if (value === "changmen" || value === "demo") return value;
    return "demo";
  } catch {
    return "demo";
  }
}

let obMqttSourceMode: ObMqttSourceMode = readStoredSourceMode();

export function getObMqttSourceMode(): ObMqttSourceMode {
  return obMqttSourceMode;
}

export function obMqttSourceModeLabel(mode: ObMqttSourceMode = obMqttSourceMode): string {
  switch (mode) {
    case "changmen":
      return "CHANGMEN 转发";
    default:
      return "官方源";
  }
}

function upstreamRouteForMode(mode: ObMqttSourceMode) {
  return mode === "demo" ? "official" : mode;
}

export function setObMqttSourceMode(mode: ObMqttSourceMode): ObMqttSourceMode {
  // 历史 localStorage 可能存 a8；一律落到官方 demo
  obMqttSourceMode = mode === "changmen" ? "changmen" : "demo";
  mode = obMqttSourceMode;
  try {
    globalThis.localStorage?.setItem(OB_MQTT_SOURCE_MODE_KEY, mode);
  } catch {
    /* ignore storage errors */
  }
  patchDirectRealtimeStatus(PLATFORM, {
    upstreamConnected: false,
    upstreamRoute: upstreamRouteForMode(mode),
    lastError: `OB MQTT 切换到${obMqttSourceModeLabel(mode)}，等待重连`,
  });
  return obMqttSourceMode;
}

export function cycleObMqttSourceMode(): ObMqttSourceMode {
  const idx = SOURCE_MODE_ORDER.indexOf(obMqttSourceMode);
  const next = SOURCE_MODE_ORDER[(idx + 1) % SOURCE_MODE_ORDER.length]!;
  return setObMqttSourceMode(next);
}

function syncObStatus(topics: Set<string>): void {
  patchDirectRealtimeStatus(PLATFORM, { forwardedTopics: topics.size });
}

async function resolveConfigForSourceMode(
  mode: ObMqttSourceMode,
  cachedDemo: ObMqttConnectConfig | null = null,
): Promise<ObMqttConnectConfig | null> {
  switch (mode) {
    case "changmen": {
      const demo = cachedDemo ?? await fetchObDemoMqttConfig();
      if (!demo?.url) return null;
      return getObChangmenMqttConfig(demo.url, demo);
    }
    default:
      return fetchObDemoMqttConfig();
  }
}

function nextFailoverSource(failedSource: ObMqttEndpointSource): ObMqttEndpointSource {
  const idx = FAILOVER_ORDER.indexOf(failedSource);
  return FAILOVER_ORDER[(idx + 1) % FAILOVER_ORDER.length]!;
}

function createDirectObRealtimeClient(): ObRealtimeClient {
  let client: MqttClient | null = null;
  let onMessageHandler: ((message: ObMqttMessage) => void) | null = null;
  const topics = new Set<string>();
  let activeConfig: ObMqttConnectConfig | null = null;
  let lastDemoConfig: ObMqttConnectConfig | null = null;
  let stopped = false;
  let failoverBusy = false;
  let intentionalDisconnect = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  const mqttOptionsForConfig = (config: ObMqttConnectConfig) => {
    const clientId = config.clientId || "";
    if (!clientId) return null;
    return {
      username: config.username,
      password: config.password,
      clientId,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 5000,
      protocolId: "MQTT" as const,
      connectTimeout: OB_MQTT_CONNECT_TIMEOUT_MS,
    };
  };

  const clearConnectTimer = () => {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  };

  const tearDownClient = () => {
    clearConnectTimer();
    if (!client) return;
    intentionalDisconnect = true;
    client.removeAllListeners();
    client.end(true);
    client = null;
    intentionalDisconnect = false;
  };

  const requestFailover = (reason: string) => {
    if (stopped || failoverBusy || intentionalDisconnect) return;
    const selectedMode = getObMqttSourceMode();
    if (selectedMode !== "demo") {
      console.warn(
        `[OB MQTT] ${selectedMode} source failed, staying on selected ${obMqttSourceModeLabel(selectedMode)}:`,
        reason,
      );
      return;
    }
    const failedSource = activeConfig?.source;
    if (!failedSource) return;
    void failoverFrom(failedSource, reason);
  };

  const failoverFrom = async (failedSource: ObMqttEndpointSource, reason: string) => {
    if (stopped || failoverBusy) return;
    failoverBusy = true;
    try {
      tearDownClient();
      activeConfig = null;
      patchDirectRealtimeStatus(PLATFORM, {
        upstreamConnected: false,
        upstreamRoute: null,
        lastError: reason,
      });

      const nextSource = nextFailoverSource(failedSource);
      const nextConfig = await resolveConfigForSourceMode(
        nextSource,
        nextSource === "changmen" ? lastDemoConfig : null,
      );
      if (!nextConfig) {
        console.warn(`[OB MQTT] ${failedSource} failed, no config for ${nextSource}:`, reason);
        return;
      }

      console.warn(`[OB MQTT] ${failedSource} failed, switching to ${nextConfig.source}:`, reason);
      await connectWithConfig(nextConfig);
    } finally {
      failoverBusy = false;
    }
  };

  const connectWithConfig = async (config: ObMqttConnectConfig) => {
    if (stopped) return;

    tearDownClient();
    activeConfig = config;
    if (config.source === "demo") lastDemoConfig = config;

    const { url, source } = config;
    patchDirectRealtimeStatus(PLATFORM, {
      upstreamConnected: false,
      upstreamRoute: null,
      lastError: null,
    });

    const options = mqttOptionsForConfig(config);
    if (!options) {
      patchDirectRealtimeStatus(PLATFORM, {
        upstreamConnected: false,
        upstreamRoute: null,
        lastError: "missing OB MQTT clientId",
      });
      requestFailover("missing OB MQTT clientId");
      return;
    }

    client = mqtt.connect(url, options);

    client.on("message", (topic: string, buf: Buffer) => {
      bumpDirectRealtimeMessage(PLATFORM);
      onMessageHandler?.({ topic, payload: buf.toString() });
    });

    client.on("error", (err: Error) => {
      console.warn("[OB MQTT] error", err.message, url, `(${source})`);
      patchDirectRealtimeStatus(PLATFORM, {
        upstreamConnected: false,
        upstreamRoute: null,
        lastError: err.message,
      });
      requestFailover(err.message);
    });

    client.on("close", () => {
      patchDirectRealtimeStatus(PLATFORM, { upstreamConnected: false, upstreamRoute: null });
      // reconnectPeriod=5000: mqtt.js 会自动重连，close 不触发 failover
    });

    client.on("connect", () => {
      clearConnectTimer();
      console.info("[OB MQTT] connected", url, `(${source})`);
      patchDirectRealtimeStatus(PLATFORM, {
        upstreamConnected: true,
        upstreamRoute: upstreamRouteFromUrl(url, source),
        lastError: null,
      });
      syncObStatus(topics);
      for (const topic of topics) client?.subscribe(topic);
    });

    connectTimer = setTimeout(() => {
      if (stopped || client?.connected) return;
      console.warn("[OB MQTT] connect timeout", url, `(${source})`);
      requestFailover("connect timeout");
    }, OB_MQTT_CONNECT_TIMEOUT_MS);
  };

  return {
    async start(onMessage) {
      onMessageHandler = onMessage;
      stopped = false;

      if (client?.connected) return getDirectRealtimeStatus(PLATFORM);

      const config = await resolveConfigForSourceMode(getObMqttSourceMode());
      if (config) {
        await connectWithConfig(config);
      } else {
        console.warn("[OB MQTT] no endpoint for selected source", getObMqttSourceMode());
        patchDirectRealtimeStatus(PLATFORM, {
          upstreamConnected: false,
          upstreamRoute: upstreamRouteForMode(getObMqttSourceMode()),
          lastError: "no OB MQTT endpoint",
        });
      }

      return getDirectRealtimeStatus(PLATFORM);
    },
    async stop() {
      stopped = true;
      topics.clear();
      tearDownClient();
      onMessageHandler = null;
      activeConfig = null;
      lastDemoConfig = null;
      resetDirectRealtimeStatus(PLATFORM);
      return getDirectRealtimeStatus(PLATFORM);
    },
    async status() {
      return getDirectRealtimeStatus(PLATFORM);
    },
    async subscribe(topic) {
      topics.add(topic);
      syncObStatus(topics);
      if (client?.connected) {
        await new Promise<void>((resolve) => {
          client?.subscribe(topic, () => resolve());
        });
      }
    },
    async unsubscribe(topic) {
      topics.delete(topic);
      syncObStatus(topics);
      if (client?.connected) client.unsubscribe(topic);
    },
    connected() {
      return Boolean(client?.connected);
    },
  };
}

export function createObRealtimeClient(): ObRealtimeClient {
  return createDirectObRealtimeClient();
}
