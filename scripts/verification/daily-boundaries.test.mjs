import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const denyHistory = `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){
 if(url.includes('/scripts/verification/')&&/(?:workspace-layout-history|browser-entry-history|.*(?:relocation|retirement)|retained-source-boundaries|frontend-build-inputs|fok-exact-boundaries)\\.mjs$/.test(url))
  throw Error('Historical proof imported: '+url);return next(url,context);}});`;
function command(code) {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", denyHistory + code], {
    cwd: process.cwd(), encoding: "utf8", timeout: 35000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, CHANGMEN_HISTORICAL_AUDIT: "", ESPORT_FREEZE_BASE: "HEAD" },
  });
}
it("daily boundaries pass with historical audit modules forbidden by the Node loader", () => {
  const result = command("await import('./scripts/check-team-boundaries.mjs');");
  expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain("check-team-boundaries: OK");
}, 40000);
it("a legitimate business source change does not require registering a historical increment", () => {
  const result = command(`import fs from 'node:fs';const read=fs.readFileSync;
   fs.readFileSync=function(file,...args){const source=read.call(this,file,...args);return typeof source==='string'&&String(file).replaceAll('\\\\','/').endsWith('/client/web/src/api/match.ts')?source+'\\nvoid 0;\\n':source;};
   await import('./scripts/check-team-boundaries.mjs');`);
  expect(result.status, result.stderr).toBe(0);
}, 40000);
it("business changes still reject forbidden cross-layer dependencies", () => {
  const result = command(`import fs from 'node:fs';const read=fs.readFileSync;
   fs.readFileSync=function(file,...args){const source=read.call(this,file,...args);return typeof source==='string'&&String(file).replaceAll('\\\\','/').endsWith('/client/web/src/api/match.ts')?source+'\\nimport "@changmen/db";\\n':source;};
   await import('./scripts/check-team-boundaries.mjs');`);
  expect(result.status).toBe(1); expect(result.stderr).toContain("client/web/src/api/match.ts");
  expect(result.stderr).not.toContain("Historical proof imported:");
}, 40000);
it("daily boundaries reject a business dependency added to a registered presentation component", () => {
  const result = command(`import fs from 'node:fs';const read=fs.readFileSync;
   fs.readFileSync=function(file,...args){const source=read.call(this,file,...args);return typeof source==='string'&&String(file).replaceAll('\\\\','/').endsWith('/order/presentation/OrderProfitLine.vue')?source.replace('<script setup lang="ts">','<script setup lang="ts">import "@/stores/accountStore";'):source;};
   await import('./scripts/check-team-boundaries.mjs');`);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("OrderProfitLine.vue: presentation boundary:");
}, 40000);
it("daily boundaries reject a missing fixed parent integration test before other checks", () => {
  const result = command(`import fs from 'node:fs';const exists=fs.existsSync;
   fs.existsSync=function(file){return String(file).endsWith('OrderList.runtime.test.ts')?false:exists.call(this,file);};
   await import('./scripts/check-team-boundaries.mjs');`);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Required presentation test missing: client/web/src/components/order/OrderList.runtime.test.ts");
}, 40000);
it("the explicit historical entry still loads the archived proofs", () => {
  const result = command("await import('./scripts/verification/check-historical-migrations.mjs');");
  expect(result.status).not.toBe(0); expect(result.stderr).toContain("Historical proof imported:");
});
it("the ordinary freeze CLI also runs without historical proof code", () => {
  const result = command("await import('./devtools/venue-adapter/verification/check-esport-freeze.mjs');");
  expect(result.status, result.stderr).toBe(0);
  if (!result.stdout.includes("[esport-freeze] ok")) {
    // An explicitly reviewed frozen edit succeeds with its warning on stderr.
    // Keep requiring both the real authorization and the CLI's exact allow marker.
    expect(["1", "true"]).toContain(process.env.ALLOW_ESPORT_TOUCH);
    expect(result.stderr).toContain("[esport-freeze] ALLOW_ESPORT_TOUCH — 放行");
  }
});
