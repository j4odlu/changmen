/** 角标颜色：官方源站绿、CHANGMEN 转发紫、A8 聚合蓝 */
export type DirectRealtimeUpstreamRoute = "official" | "changmen" | "a8";

/** 浏览器直连上游推送（WS / MQTT）的运行时状态，供网页角标等读取 */
export type DirectRealtimeStatus = {
  platform: string;
  upstreamConnected: boolean;
  upstreamRoute?: DirectRealtimeUpstreamRoute | null;
  messagesReceived?: number;
  lastError?: string | null;
  lastUpstreamAt?: number | null;
  forwardedTopics?: number;
  mode: "direct";
};

/** A8 聚合机：47.115.75.57/esport/ws/*、api.a8.to 等 */
const A8_UPSTREAM_HOSTS = new Set(["47.115.75.57", "api.a8.to"]);

const LOCAL_WS_FORWARD_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function upstreamRouteFromUrl(
  url: string,
  source?: "official" | "changmen" | "a8" | "demo",
): DirectRealtimeUpstreamRoute {
  if (source === "changmen") return "changmen";
  if (source === "a8") return "a8";
  if (source === "official") return "official";
  if (source === "demo") return "official";
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (A8_UPSTREAM_HOSTS.has(host)) return "a8";
    if (LOCAL_WS_FORWARD_HOSTS.has(host)) return "changmen";
    return "official";
  } catch {
    return "official";
  }
}

const EMPTY = (platform: string): DirectRealtimeStatus => ({
  platform,
  upstreamConnected: false,
  upstreamRoute: null,
  messagesReceived: 0,
  lastError: null,
  lastUpstreamAt: null,
  forwardedTopics: 0,
  mode: "direct",
});

/** IA / OB / RAY 使用本模块（浏览器直连） */
export const DIRECT_REALTIME_PLATFORMS = ["IA", "OB", "RAY"] as const;

export type DirectRealtimePlatformId = (typeof DIRECT_REALTIME_PLATFORMS)[number];

const statusByPlatform = new Map<string, DirectRealtimeStatus>();
const listeners = new Set<() => void>();

function notifyDirectRealtimeListeners(): void {
  for (const listener of listeners) listener();
}

/** 订阅状态变更（connect / 消息 / 错误）；返回取消函数 */
export function subscribeDirectRealtimeStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listDirectRealtimeStatuses(): DirectRealtimeStatus[] {
  return DIRECT_REALTIME_PLATFORMS.map((platform) => getDirectRealtimeStatus(platform));
}

export function patchDirectRealtimeStatus(
  platform: string,
  patch: Partial<Omit<DirectRealtimeStatus, "platform" | "mode">>,
): void {
  const prev = statusByPlatform.get(platform) ?? EMPTY(platform);
  statusByPlatform.set(platform, { ...prev, ...patch, platform, mode: "direct" });
  notifyDirectRealtimeListeners();
}

export function bumpDirectRealtimeMessage(platform: string): void {
  const prev = statusByPlatform.get(platform) ?? EMPTY(platform);
  patchDirectRealtimeStatus(platform, {
    messagesReceived: (prev.messagesReceived ?? 0) + 1,
    lastUpstreamAt: Date.now(),
  });
}

export function getDirectRealtimeStatus(platform: string): DirectRealtimeStatus {
  return statusByPlatform.get(platform) ?? EMPTY(platform);
}

export function resetDirectRealtimeStatus(platform: string): void {
  statusByPlatform.set(platform, EMPTY(platform));
  notifyDirectRealtimeListeners();
}
