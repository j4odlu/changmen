import type { PlatformId } from "@changmen/api-contract";
import manifest from "@changmen/shared/catalog/venue_manifest.json";

/** 静态资源目录（对应 client/web/public/assets/venue/） */
export const VENUE_ICON_PUBLIC_DIR = "/assets/venue";

type ManifestEntry = (typeof manifest)[number] & { icon?: string };

const iconById = new Map<PlatformId, string>(
  (manifest as ManifestEntry[])
    .filter((entry): entry is ManifestEntry & { icon: string } => Boolean(entry.icon))
    .map((entry) => [entry.id as PlatformId, entry.icon]),
);

/** manifest 中声明的图标文件名（不含路径） */
export function getPlatformIconFile(id: PlatformId): string | undefined {
  return iconById.get(id);
}

/** 浏览器可用的图标 URL，无 icon 时返回 undefined */
export function getPlatformIconUrl(id: PlatformId | string): string | undefined {
  const file = iconById.get(id as PlatformId);
  return file ? `${VENUE_ICON_PUBLIC_DIR}/${file}` : undefined;
}

export function platformIdsWithIcons(): PlatformId[] {
  return [...iconById.keys()];
}
