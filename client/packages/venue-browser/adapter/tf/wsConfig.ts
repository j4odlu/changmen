/** TF 实时赔率 WS 曾经 A8 聚合（api.a8.to / 47.115.75.57）；已禁用，仅保留 HTTP 采集。 */

export const TF_WS_CONNECTION_TIMEOUT_MS = 4_000;
export const TF_WS_RECONNECT_MIN_MS = 1_000;
export const TF_WS_RECONNECT_MAX_MS = 5_000;

/** @deprecated A8 聚合 WS 已移除；无替代 host */
export const TF_WS_HOSTS: readonly string[] = [];

export const TF_WS_PATH = "/esport/ws/TF";

export function resetTfWsHostRotateForTests(): void {
  /* no-op：A8 host 轮换已移除 */
}

/** @deprecated A8 聚合 WS 已移除 */
export function nextTfWsHost(): string {
  throw new Error("TF A8 WebSocket hosts removed; realtime odds WS disabled");
}

/** @deprecated A8 聚合 WS 已移除 */
export function buildTfWsUrl(_authToken: string, _host?: string): string {
  throw new Error("TF A8 WebSocket hosts removed; realtime odds WS disabled");
}

/** @deprecated 使用 buildTfWsUrl */
export function buildTfDirectWsUrl(authToken: string): string {
  return buildTfWsUrl(authToken);
}
