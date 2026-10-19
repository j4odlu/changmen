#!/usr/bin/env npx tsx
/**
 * OB 锁盘观察 — 读 game/view fixture，对照 HTTP 与 changmen fo/展示（A8 parity）。
 *
 * 示例：
 *   npx tsx client/platform-adapter/ob/scripts/ob_lock_observe.ts --fixture path/to/view.json
 *   npx tsx client/platform-adapter/ob/scripts/ob_lock_observe.ts --fixture view.json --json
 *
 * fixture：浏览器 Network 里 game/view 响应另存为 JSON（含 data 数组）。
 * 需要 live 拉盘时用可选包：npm run ob:view --workspace=@changmen/platform-probes
 */

import fs from "node:fs";
import path from "node:path";
import { summarizeGameViewJson } from "../shared/lock_decision";

function parseArgs(argv: string[]) {
  const out = {
    fixture: null as string | null,
    json: false,
    onlyDiff: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--fixture" && val) {
      out.fixture = path.resolve(val);
      i += 1;
    } else if (key === "--json") {
      out.json = true;
    } else if (key === "--only-diff") {
      out.onlyDiff = true;
    }
  }
  return out;
}

function formatRow(r: ReturnType<typeof summarizeGameViewJson>["rows"][number]) {
  const flag = r.changmenDiffersFromOfficial ? "≠官网" : "＝官网";
  return [
    r.marketId,
    (r.name || "").slice(0, 28),
    `s${r.status}/v${r.visible}/u${r.suspended}`,
    r.http.official ? "锁" : "开",
    r.changmenDisplay.locked ? "锁" : "开",
    flag,
    r.http.reasons[0] || r.changmenDisplay.reason,
  ].join(" | ");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fixture) {
    console.error("usage: ob_lock_observe.ts --fixture <game-view.json> [--json] [--only-diff]");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(args.fixture, "utf8"));
  const summary = summarizeGameViewJson(raw);

  let rows = summary.rows;
  if (args.onlyDiff) {
    rows = summary.changmenExtra.length
      ? summary.changmenExtra
      : rows.filter((r) => r.http.official);
  }

  if (args.json) {
    console.log(JSON.stringify({ ...summary, rows }, null, 2));
    return;
  }

  console.log("OB 锁盘观察 — HTTP: status!==6 || visible!==1 || suspended!==0");
  console.log(`fixture: ${args.fixture}`);
  console.log(
    `盘口 ${summary.total} | HTTP锁 ${summary.lockedOfficial} | changmen展示与官网不同 ${summary.changmenDisplayDiffCount}`,
  );
  console.log("marketId | name | status | HTTP | changmen展示 | 对照 | 原因");
  for (const r of rows) {
    console.log(formatRow(r));
  }
  console.log("\n判定模块: client/platform-adapter/ob/shared/lock_decision.ts");
}

main();
