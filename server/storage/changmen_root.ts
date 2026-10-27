import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 从任意 changmen 子目录向上查找 monorepo 根（含 server/backend）。 */
export function findChangmenRoot(fromDir: string): string {
  let cur = fromDir;
  for (let i = 0; i < 12; i++) {
    const backendPkg = path.join(cur, "server/backend/package.json");
    if (fs.existsSync(backendPkg)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(backendPkg, "utf8"));
        if (pkg.name === "@changmen/backend") return cur;
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(fromDir, "..", "..");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @changmen/storage 包目录向上即 changmen 根。 */
export const CHANGMEN_ROOT_FROM_PKG = findChangmenRoot(__dirname);
