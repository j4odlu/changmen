// [changmen 扩展] 真实兼容 CLI 的离线负向测试；来源固定，I/O 限于读源码，不连接 VPS。
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
function check(plan, mutation = "source => source", backendRef = "832f3f76c30d6ad741ce850a68cd6ba1da7d06f9") {
  const code = `
    import fs from 'node:fs';
    import { gitSource } from './scripts/verification/fok-exact-boundaries.mjs';
    import { legacyBusinessFiles } from './scripts/verification/gtc-legacy-backend-fixture.mjs';
    import { publicFiles } from './scripts/verification/public-release-boundaries.mjs';
    const backend=${JSON.stringify(backendRef)},frontend='e901bb596952256284cd8a9eb8b73b572c963915';
    const files=[...publicFiles,...legacyBusinessFiles,'server/backend/core/orderModes/gtc/handler.js','server/backend/core/orderModes/gtc/orders.js'];
    if(gitSource(backend,'server/backend/core/orderModes/gtc/handler.js').includes('"Pm_GtcRecover"')) files.push('server/backend/core/orderModes/gtc/recovery.js');
    const snapshot={captureId:'offline',frontendVersion:frontend,backendVersion:backend,sources:Object.fromEntries(files.map(file=>[file,gitSource(file.startsWith('server/')?backend:frontend,file)]))};
    const read=fs.readFileSync;
    fs.readFileSync=function(file,...args){
      if(file==='output/vps-fok-baseline.json') return JSON.stringify(snapshot);
      const source=read.call(this,file,...args);
      return file==='server/backend/core/orderModes/gtc/orders.js'&&typeof source==='string'?(${mutation})(source):source;
    };
    fs.writeFileSync=()=>{};
    process.argv=['node','script',...${JSON.stringify(plan ? [`--release-plan=${plan}`] : [])}];
    await import('./scripts/verification/verify-gtc-backend-compatibility.mjs');
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", code], { encoding: "utf8", timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
}
it("real default compatibility CLI still rejects frontend-only on captured old backend", () => {
  const result = check(); expect(result.status).toBe(1); expect(result.stdout).toContain('"frontendOnlyGtcCompatible":false');
}, 30000);
it("real compatibility CLI verifies backend-first while retaining the blocked frontend-only combination", () => {
  const result = check("backend-first"); expect(result.status).toBe(0);
  expect(result.stdout).toContain('"blockedCombinations":["frontend-only"]');
}, 30000);
it.each(["backend-first", "frontend-only"])("real %s CLI accepts continuation after the new backend has been published", plan => {
  const result = check(plan, "source => source", "3d7562687f8bc81da7c138ddb1a93f48a7c8a7bf");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('"frontendOnlyGtcCompatible":true');
  expect(result.stdout).toContain('"blockedCombinations":[]');
}, 30000);
it("real backend-first CLI rejects a supported endpoint that silently drops restored original orders", () => {
  const result = check("backend-first", 'source => source.replace("return result;", "return [];")');
  expect(result.status).toBe(1); expect(result.stderr).toContain("AssertionError");
}, 30000);
it("real backend-first CLI cannot exempt a changed existing GTC read contract", () => {
  const result = check("backend-first", 'source => source.replace("return readOrdersForMode(body, owner", "return readOrdersForMode(body, \\\"foreign\\\"")');
  expect(result.status).toBe(1); expect(result.stderr).toContain("complete legacy GTC orders module");
}, 30000);
