import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const ASSET_PREFIX = "/esport2/assets/";
const ASSET_ROOT = fileURLToPath(new URL("../../../../server/backend/public/assets/", import.meta.url));

/** These same-origin resources are served by backend/static_files.js in dev and production. */
export function backendPublicAssets(): Plugin {
  return {
    name: "changmen-backend-public-assets",
    config() {
      return {
        build: {
          rollupOptions: {
            external(id) {
              if (!id.startsWith(ASSET_PREFIX))
                return false;
              const relative = decodeURIComponent(id.slice(ASSET_PREFIX.length).split(/[?#]/)[0]!);
              const filename = path.resolve(ASSET_ROOT, relative);
              if (!filename.startsWith(`${path.resolve(ASSET_ROOT)}${path.sep}`) || !existsSync(filename))
                throw new Error(`后端静态资源不存在：${id}`);
              return true;
            },
          },
        },
      };
    },
  };
}
