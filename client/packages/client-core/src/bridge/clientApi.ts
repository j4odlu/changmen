import type { CollectPlatformInfo } from "@changmen/api-contract";

export interface ClientApiBridge {
  getCollectPlatform(provider: string): Promise<CollectPlatformInfo | null>;
  /** [A8 可证实] 对齐 `Ut.getPlatform(PB).games`；changmen 经 `Client_GetGames` */
  getGames(provider: string): Promise<string[]>;
  saveLiveTimer(provider: string, timer: unknown[]): Promise<void>;
  updatePlatform(body: Record<string, unknown>): Promise<unknown>;
  getHgFollowOrders(agentId: string): Promise<unknown[]>;
  saveUserLog?(message: string, data?: unknown): Promise<void>;
}

let bridge: ClientApiBridge | null = null;

export function registerClientApi(api: ClientApiBridge): void {
  bridge = api;
}

export function clearClientApi(): void {
  bridge = null;
}

function requireBridge(): ClientApiBridge {
  if (!bridge)
    throw new Error("[client-core] ClientApi bridge not registered");
  return bridge;
}

export async function getCollectPlatform(provider: string) {
  return requireBridge().getCollectPlatform(provider);
}

export async function getGames(provider: string): Promise<string[]> {
  const games = await requireBridge().getGames(provider);
  return Array.isArray(games) ? games.filter(Boolean).map(String) : [];
}

export async function saveLiveTimer(provider: string, timer: unknown[]) {
  return requireBridge().saveLiveTimer(provider, timer);
}

export async function updatePlatform(body: Record<string, unknown>) {
  return requireBridge().updatePlatform(body);
}

export async function getHgFollowOrders(agentId: string) {
  return requireBridge().getHgFollowOrders(agentId);
}

export async function saveUserLog(message: string, data?: unknown): Promise<void> {
  await requireBridge().saveUserLog?.(message, data);
}
