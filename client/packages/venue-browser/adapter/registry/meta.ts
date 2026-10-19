import type { PlatformId } from "@changmen/api-contract";
import manifest from "@changmen/shared/catalog/venue_manifest.json";

/** 单平台能力 — manifest.json 的类型化视图 */
export interface PlatformMeta {
  id: PlatformId;
  dir: string;
  sort: number;
  collect: boolean;
  bet: boolean;
  pluginOnly?: boolean;
  a8Channel?: boolean;
  collectionMode: string;
  saveMatchIntervalMs?: number;
  /** 角标文件名，位于 client/web/public/assets/venue/ */
  icon?: string;
}

const entries = manifest as PlatformMeta[];

export const PLATFORM_REGISTRY: PlatformMeta[] = entries.slice().sort((a, b) => a.sort - b.sort);

/** 所有平台 ID（UI、账号、采集默认开关） */
export const ALL_PLATFORMS: PlatformId[] = PLATFORM_REGISTRY.map((p) => p.id);

const metaById = new Map(PLATFORM_REGISTRY.map((p) => [p.id, p]));
const metaByIdUpper = new Map(PLATFORM_REGISTRY.map((p) => [p.id.toUpperCase(), p]));

export function getPlatformMeta(id: PlatformId | string): PlatformMeta | undefined {
  const key = String(id || "").trim();
  if (!key)
    return undefined;
  return metaById.get(key as PlatformId) ?? metaByIdUpper.get(key.toUpperCase());
}

export function platformSupportsCollect(id: PlatformId): boolean {
  return getPlatformMeta(id)?.collect ?? false;
}

export function platformSupportsBet(id: PlatformId): boolean {
  return getPlatformMeta(id)?.bet ?? false;
}

export function collectPlatformIds(): PlatformId[] {
  return PLATFORM_REGISTRY.filter((p) => p.collect).map((p) => p.id);
}

/** 赛事采集 UI：仍走浏览器 SaveMatch/SaveBets 的平台（排除 VPS 写库场馆） */
export function browserSaveMatchPlatformIds(): PlatformId[] {
  return PLATFORM_REGISTRY
    .filter((p) => p.collect && p.collectionMode !== "vps_http_ws")
    .map((p) => p.id);
}

/**
 * VPS collector 独占写 platform_*（manifest `collectionMode: vps_http_ws`）。
 * 浏览器不得 SaveMatch/SaveBet/SaveLiveTimer；新馆只改 manifest，勿再硬编码平台名。
 */
export function isVpsOwnedPlatformCollect(id: PlatformId | string): boolean {
  return getPlatformMeta(id)?.collectionMode === "vps_http_ws";
}

export function betPlatformIds(): PlatformId[] {
  return PLATFORM_REGISTRY.filter((p) => p.bet).map((p) => p.id);
}

export function platformDir(id: PlatformId): string | undefined {
  return metaById.get(id)?.dir;
}
