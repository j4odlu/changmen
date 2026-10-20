// [changmen 扩展] 在隔离进程注入源码故障，验证真实发布入口失败；不写回生产文件。
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

function reject(script, file, change, expected) {
  const code = `
    import fs from "node:fs";
    import { execFileSync } from "node:child_process";
    const original = fs.readFileSync;
    fs.readFileSync = function(path, ...args) {
      const value = original.call(this, path, ...args);
      if (typeof value === "string" && String(path).replaceAll(String.fromCharCode(92), "/").endsWith(${JSON.stringify(file)})) {
        const changed = (${change})(value);
        if (changed === value) throw new Error("Test mutation did not apply to the actual source");
        return changed;
      }
      return value;
    };
    process.argv = [process.execPath, ${JSON.stringify(`scripts/verification/${script}`)}];
    await import(${JSON.stringify(`./scripts/verification/${script}`)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], { encoding: "utf8", timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(expected);
}
it("real core entry rejects a changed POST payload inside notification wrappers", () => {
  reject("verify-fok-execution-parity.mjs", "client/web/src/stores/account/betGateway.ts", "source => source.replace(\"provider.betting(account, option)\", \"provider.betting(account, { ...option, betMoney: 0 })\")", "complete source outside reject display change");
}, 30_000);
it("real VPS entry rejects added makeup work instead of exempting a protected module", () => {
  reject("verify-vps-fok-baseline.mjs", "client/web/src/stores/betting/autoBet/arbMakeUpFromRejects.ts", "source => source + \"\\nvoid unexpectedMakeup();\\n\"", "unregistered protected source difference");
}, 30_000);
it("real core entry protects the RAY reject-monitor makeup implementation", () => {
  reject("verify-fok-execution-parity.mjs", "client/web/src/runtime/rayOrderMonitor/autoMakeup.ts", "source => source + \"\\nvoid unexpectedMakeup();\\n\"", "complete committed RAY monitor source");
}, 30_000);
it("real VPS entry still checks original immutable manifest provenance", () => {
  reject("verify-vps-fok-baseline.mjs", "scripts/verification/vps-fok-baseline.json", "source => { const data = JSON.parse(source); data.protectedFiles[\"client/web/src/stores/account/betGateway.ts\"] = \"0\".repeat(64); return JSON.stringify(data); }", "immutable manifest provenance");
}, 30_000);
it("real core entry also checks the private GTC sell helper rather than deleting it unchecked", () => {
  reject("verify-fok-execution-parity.mjs", "client/web/src/stores/account/pmManualSell.ts", "source => source.replace(\"ordersToSave.map(row =>\", \"ordersToSave.slice(1).map(row =>\")", "complete committed GTC persistence body");
}, 30_000);
it("real core entry rejects rolling the gateway back to the old unisolated notification behavior", () => {
  reject("verify-fok-execution-parity.mjs", "client/web/src/stores/account/betGateway.ts", "source => execFileSync(\"git\", [\"show\", \"219535c8:client/web/src/stores/account/betGateway.ts\"], { encoding: \"utf8\" })", "exact reject display increment");
}, 30_000);
it("real core entry rejects a native helper that switches the order table", () => {
  reject("verify-fok-execution-parity.mjs", "rds/rds/native_orders.js", "source => source.replace('const table = \"orders\"', 'const table = \"orders_financial\"')", "complete native orders helper");
}, 30_000);
it("real VPS entry rejects deleting orders outside the requested IDs", () => {
  reject("verify-vps-fok-baseline.mjs", "rds/rds/orders_store.js", "source => source.replace(\"DELETE FROM orders WHERE id = ANY($1::bigint[])\", \"DELETE FROM orders WHERE true\")", "complete native retirement boundary");
}, 30_000);

// [changmen 扩展] 新统一边界也必须由真实发布检查入口拒绝，不能只测试辅助函数。
for (const [script, file, change, expected] of [
  ["verify-fok-execution-parity.mjs", "client/web/src/stores/betting/autoBet/phases/placeArbLegs.ts", 'source => source.replace("original?.actions.retry !== false", "true")', "exact boundary occurrence"],
  ["verify-vps-fok-baseline.mjs", "client/web/src/stores/betting/autoBet/phases/settleBothArbLegs.ts", 'source => source.replace("rejectWaitSec ?? 0", "rejectWaitSec ?? 1")', "exact boundary occurrence"],
  ["verify-fok-execution-parity.mjs", "client/web/src/orderModes/gtc/arbLeg.ts", 'source => source + "\\nvoid unexpectedTrade();\\n"', "complete reviewed unified capability contract"],
  ["verify-fok-execution-parity.mjs", "client/web/src/orderModes/router.ts", 'source => source + "\\nvoid executeGtcPair();\\n"', "complete reviewed unified capability contract"],
  ["verify-vps-fok-baseline.mjs", "client/web/src/stores/betting/execution/selection.ts", 'source => source + "\\nvoid mutateSelection();\\n"', "complete reviewed unified capability contract"],
]) it(`real ${script} rejects a changed unified boundary in ${file}`, () => {
  reject(script, file, change, expected);
}, 30_000);
