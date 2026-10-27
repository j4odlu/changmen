export type PlatformConfig = Record<string, unknown>;

/**
 * platforms.json / tag_platforms.json — 与 server/backend store 共享的本地 JSON 存储。
 */
import { readJsonFile, writeJsonFile } from "@changmen/storage/json_file_store";
import { ensureDefaultJsonFiles, ensureStorageSeed } from "@changmen/storage/ensure_storage_seed";

export { ensureDefaultJsonFiles, ensureStorageSeed };

export function getPlatform(provider: string): PlatformConfig | null {
  return readJsonFile<Record<string, PlatformConfig>>("platforms", {})[provider] || null;
}

export function setPlatform(provider: string, data: PlatformConfig): PlatformConfig & { provider: string; updatedAt: number } {
  const platforms = readJsonFile<Record<string, PlatformConfig>>("platforms", {});
  platforms[provider] = {
    ...platforms[provider],
    ...data,
    provider,
    updatedAt: Date.now(),
  };
  writeJsonFile("platforms", platforms);
  return platforms[provider] as PlatformConfig & { provider: string; updatedAt: number };
}
