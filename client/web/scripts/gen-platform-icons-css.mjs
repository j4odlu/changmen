/**
 * 从 packages/shared/catalog/venue_manifest.json 生成平台角标 CSS。
 * predev / prebuild 门禁：manifest.icon 必须对应 public/assets/venue/ 下真实文件。
 *
 * 用法：node scripts/gen-platform-icons-css.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../../../packages/shared/catalog/venue_manifest.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const venuePublicDir = path.join(webRoot, "public/assets/venue");
const outFile = path.join(webRoot, "src/styles/platform-icons.generated.css");

const VENUE_ICON_PUBLIC_DIR = "/assets/venue";

/** @param {string} id */
function cssEscapePlatformId(id) {
  return id.replace(/[^\w-]/g, "\\$&");
}

const lines = [
  "/**",
  " * AUTO-GENERATED — 勿手改。",
  " * 源：packages/shared/catalog/venue_manifest.json（icon 字段）",
  " * 命令：node client/web/scripts/gen-platform-icons-css.mjs",
  " */",
  "",
];

let failed = 0;
for (const entry of manifest) {
  if (!entry.icon)
    continue;

  const filePath = path.join(venuePublicDir, entry.icon);
  if (!fs.existsSync(filePath)) {
    console.error(`[gen-platform-icons-css] missing file for ${entry.id}: ${entry.icon}`);
    failed += 1;
    continue;
  }

  const selector = cssEscapePlatformId(entry.id);
  const url = `${VENUE_ICON_PUBLIC_DIR}/${entry.icon}`;
  lines.push(
    `.cm-platform-icon.${selector},`,
    `.provider-icon.${selector} {`,
    `  background-image:url(${url});`,
    "}",
    "",
  );
}

if (failed) {
  console.error(`[gen-platform-icons-css] FAILED (${failed} missing icon file(s))`);
  process.exit(1);
}

const next = `${lines.join("\n")}\n`;
const prev = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
if (next !== prev) {
  fs.writeFileSync(outFile, next);
  console.log(`[gen-platform-icons-css] wrote ${path.relative(webRoot, outFile)} (${manifest.filter((e) => e.icon).length} platforms)`);
}
else {
  console.log(`[gen-platform-icons-css] up to date (${manifest.filter((e) => e.icon).length} platforms)`);
}
