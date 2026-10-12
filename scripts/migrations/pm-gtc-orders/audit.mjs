// [changmen 扩展] 只处理本地一致性快照；不加载 .env、数据库模块、应用或场馆代码。
import fs from "node:fs";
import path from "node:path";
import { mergePlanReport, planGtcOrdersMerge } from "./plan.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("Usage: node scripts/migrations/pm-gtc-orders/audit.mjs --input snapshot.json [--output new-report.json]\nOffline audit only. No --apply option. Exit 0=preflight passed, 2=data conflict, 1=invalid input.\n");
}
else {
  try {
    const options = new Map();
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index];
      if (!["--input", "--output"].includes(key) || options.has(key) || !args[index + 1] || args[index + 1].startsWith("--"))
        throw new Error("Only --input and optional --output are supported; database apply is unavailable");
      options.set(key, args[index + 1]);
    }
    if (!options.has("--input"))
      throw new Error("--input is required");
    const input = path.resolve(options.get("--input"));
    const output = options.has("--output") ? path.resolve(options.get("--output")) : null;
    if (output && (input === output || fs.existsSync(output)))
      throw new Error("Report must be a new file; input and existing evidence cannot be overwritten");
    const snapshot = JSON.parse(fs.readFileSync(input, "utf8"));
    const report = mergePlanReport(planGtcOrdersMerge(snapshot));
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (output)
      fs.writeFileSync(output, text, { flag: "wx" });
    else
      process.stdout.write(text);
    process.exitCode = report.preflightPassed ? 0 : 2;
  }
  catch (error) {
    process.stderr.write(`GTC orders merge preflight failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
