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
it("the explicit historical entry still loads the archived proofs", () => {
  const result = command("await import('./scripts/verification/check-historical-migrations.mjs');");
  expect(result.status).not.toBe(0); expect(result.stderr).toContain("Historical proof imported:");
});
it("the ordinary freeze CLI also runs without historical proof code", () => {
  const result = command("await import('./devtools/venue-adapter/verification/check-esport-freeze.mjs');");
  expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain("[esport-freeze] ok");
});
