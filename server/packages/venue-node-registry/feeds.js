import {
  MANIFEST,
  normalizePlatformId,
  getManifestEntry,
} from "./paths.js";

export function listPlatforms() {
  return MANIFEST.map((p) => ({
    id: p.id,
    dir: p.dir,
    label: p.label,
    labelZh: p.labelZh,
    collectionMode: p.collectionMode,
    collectionDesc: p.collectionDesc,
    implementation: p.implementation,
    streamMeta: p.streamMeta,
    collect: p.collect,
    bet: p.bet,
  }));
}

export function getPlatform(id) {
  return getManifestEntry(id);
}

/**
 * VPS collector 独占写 platform_*（manifest `collectionMode: vps_http_ws`）。
 * 后端 Save* ignore 与前端门控共用；新馆只改 manifest。
 */
export function isVpsOwnedPlatformCollect(id) {
  const entry = getManifestEntry(id);
  return entry?.collectionMode === "vps_http_ws";
}

/** @deprecated 使用 platform_adapter/registry/manifest.json */
export const PLATFORMS = MANIFEST;

export { MANIFEST, normalizePlatformId };
