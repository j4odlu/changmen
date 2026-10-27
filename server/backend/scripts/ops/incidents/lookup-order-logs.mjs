#!/usr/bin/env node
/**
 * 按 Link 或 order_id 关联 user_logs（预检/下注诊断，不改前端）
 *
 *   node scripts/ops/incidents/lookup-order-logs.mjs --user gb12 --link 1781802360547
 *   node scripts/ops/incidents/lookup-order-logs.mjs --user gb12 --order 1679490229898760669
 *   node scripts/ops/incidents/lookup-order-logs.mjs --user gb12 --link 1781802360547 --json
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";

loadChangmenEnv();

const { lookupOrderLogs, formatLookupReport } = await import(
  "../../../core/admin_tools/user_log_lookup.js",
);

function parseArgs(argv) {
  const out = { userName: "", link: "", orderId: "", json: false, paddingMs: 0 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json")
      out.json = true;
    else if (a === "--user")
      out.userName = argv[++i] ?? "";
    else if (a === "--link")
      out.link = argv[++i] ?? "";
    else if (a === "--order")
      out.orderId = argv[++i] ?? "";
    else if (a === "--padding-ms")
      out.paddingMs = Number(argv[++i]) || 0;
    else if (a === "--help" || a === "-h")
      out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);

if (args.help || !args.userName) {
  console.log(`用法:
  node scripts/ops/incidents/lookup-order-logs.mjs --user <登录名> --link <LinkID>
  node scripts/ops/incidents/lookup-order-logs.mjs --user <登录名> --order <order_id>

选项:
  --padding-ms <ms>  日志时间窗扩展（默认 180000）
  --json             JSON 输出（含 logsRaw）
  --help             帮助
`);
  process.exit(args.help ? 0 : 1);
}

if (!args.link && !args.orderId) {
  console.error("请指定 --link 或 --order");
  process.exit(1);
}

const result = await lookupOrderLogs({
  userName: args.userName,
  link: args.link || undefined,
  orderId: args.orderId || undefined,
  paddingMs: args.paddingMs || undefined,
});

if (args.json) {
  const payload = result.ok
    ? { ...result, logsRaw: result.logsRaw }
    : result;
  console.log(JSON.stringify(payload, null, 2));
}
else {
  console.log(formatLookupReport(result));
}

process.exit(result.ok ? 0 : 1);
