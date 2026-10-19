/** 右上角角标：原生 WebSocket / 同类长连接 */
export type VenueWsStatus = "disconnected" | "detected" | "connecting" | "connected" | "error";

export type VenueWsStatusEntry = {
  id: string;
  label: string;
  status: VenueWsStatus;
  meta?: VenueWsStatusMeta;
};

export type VenueWsStatusMeta = {
  sourceMode?: string;
  reason?: string;
  assetCount?: number;
  lastMessageAt?: number;
  lastError?: string;
  failStreak?: number;
  routingPreference?: string;
  connectMs?: number | null;
  firstFrameMs?: number | null;
  firstQuoteMs?: number | null;
  quoteFreshMs?: number | null;
  connectionAttemptCount?: number;
  reconnectCount?: number;
  emptyBookCount?: number;
  fallbackReason?: string;
};

const REGISTRY: ReadonlyArray<{ id: string; label: string }> = [
  { id: "pm-market", label: "PM-M" },
  { id: "pm-sport-market", label: "PM-S" },
  { id: "pm-user", label: "PM-U" },
  { id: "lm-market", label: "LM" },
  { id: "predictfun-market", label: "PF" },
  { id: "dex", label: "DEX" },
  { id: "cm-hub", label: "HUB" },
  /** [changmen 扩展] 平博 sports-websocket 观测（扩展旁路，非 HTTP 主路径） */
  { id: "pb", label: "PB" },
  /** 足球 OB 体育推送（独立于电竞 MQTT / /esport/ws-forward/OB） */
  { id: "ob-sport", label: "OB-S" },
];

const statusById = new Map<string, VenueWsStatus>(
  REGISTRY.map(row => [row.id, "disconnected" as VenueWsStatus]),
);
const metaById = new Map<string, VenueWsStatusMeta>();
const listeners = new Set<() => void>();

function notifyVenueWsListeners(): void {
  for (const listener of listeners)
    listener();
}

/** 各 venue 模块在连接状态变化时上报 */
export function reportVenueWsStatus(id: string, status: VenueWsStatus): void {
  const prev = statusById.get(id);
  if (prev === status)
    return;
  statusById.set(id, status);
  notifyVenueWsListeners();
}

export function reportVenueWsMeta(id: string, patch: VenueWsStatusMeta): void {
  const prev = metaById.get(id) ?? {};
  const next = { ...prev, ...patch };
  let changed = false;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (prev[key as keyof VenueWsStatusMeta] !== next[key as keyof VenueWsStatusMeta]) {
      changed = true;
      break;
    }
  }
  if (!changed)
    return;
  metaById.set(id, next);
  notifyVenueWsListeners();
}

export function getVenueWsStatus(id: string): VenueWsStatus {
  return statusById.get(id) ?? "disconnected";
}

export function listVenueWsStatuses(): VenueWsStatusEntry[] {
  return REGISTRY.map(({ id, label }) => ({
    id,
    label,
    status: getVenueWsStatus(id),
    meta: metaById.get(id),
  }));
}

export function subscribeVenueWsStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 单测重置 */
export function resetVenueWsStatusesForTests(): void {
  for (const { id } of REGISTRY) {
    statusById.set(id, "disconnected");
    metaById.delete(id);
  }
  notifyVenueWsListeners();
}
