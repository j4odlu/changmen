#!/usr/bin/env node
/**
 * 从 assets/icon128.png 同步 toolbar 用小图标；若无则写 1×1 占位。
 * 正式图：changmen 原创「漩涡 + 门」品牌标志。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
const src128 = path.join(assets, "icon128.png");
const dst48 = path.join(assets, "icon.png");

if (fs.existsSync(src128) && fs.statSync(src128).size > 200) {
  fs.copyFileSync(src128, dst48);
  console.log("synced icon.png from icon128.png");
} else {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(dst48, png);
  console.warn("icon128.png missing — wrote 1×1 placeholder for icon.png");
}
