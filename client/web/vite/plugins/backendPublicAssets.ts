import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const ASSET_PREFIX = "/esport2/assets/";
const contract = JSON.parse(readFileSync(new URL("../legacyPublicAssets.json", import.meta.url), "utf8")) as {
  schemaVersion: number; prefix: string; assets: Record<string, { sha256: string }>;
};
if (contract.schemaVersion !== 1 || contract.prefix !== ASSET_PREFIX)
  throw new Error("后端静态资源契约无效");

/** The repository boundary gate verifies serving bytes; frontend builds need only this contract. */
export function isLegacyPublicAsset(id: string): boolean {
  if (!id.startsWith(ASSET_PREFIX)) return false;
  let relative: string;
  try { relative = decodeURIComponent(id.slice(ASSET_PREFIX.length).split(/[?#]/)[0]!); }
  catch { throw new Error(`后端静态资源不存在：${id}`); }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(relative) || !Object.hasOwn(contract.assets, ASSET_PREFIX + relative))
    throw new Error(`后端静态资源不存在：${id}`);
  return true;
}

/** These same-origin resources are served by backend/static_files.js in dev and production. */
export function backendPublicAssets(): Plugin {
  return {
    name: "changmen-backend-public-assets",
    config() {
      return {
        build: {
          rollupOptions: {
            external: isLegacyPublicAsset,
          },
        },
      };
    },
  };
}
