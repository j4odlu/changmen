// [changmen 扩展] 使用当前完整迁移源码与不可变 Git 来源；不写回生产文件。
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { FROZEN_PM_RELOCATIONS, FROZEN_RELOCATION_DOCUMENTS, certifyEsportRelocations, checkEsportChanges } from "./esport-relocation-boundaries.mjs";
const manifestFile = "packages/venue-adapter/esport-freeze.json";
const read = file => fs.readFileSync(file, "utf8");
const options = { manifestText: read(manifestFile), readSource: read, baselineRead: gitSource };
describe("default freeze verifies exact full relocation instead of an exemption", () => {
  it("certifies only seventeen existing module pairs and one exact document", () => {
    const certified = certifyEsportRelocations(options);
    expect([...certified].sort()).toEqual([...Object.entries(FROZEN_PM_RELOCATIONS).flat(), ...Object.keys(FROZEN_RELOCATION_DOCUMENTS)].sort());
  });
  for (const [file, target] of Object.entries(FROZEN_PM_RELOCATIONS)) {
    for (const [name, requested, transform] of [
      ["facade side effect", file, source => source + "\nvoid unexpectedTrade();\n"],
      ["wrong target/export", file, source => source.replace("export *", "export { missing }")],
      ["implementation side effect", target, source => source + "\nvoid unexpectedTrade();\n"],
      ["missing implementation", target, () => { throw new Error("missing relocated module"); }],
    ]) it(`${file}: rejects ${name}`, () => {
      expect(() => certifyEsportRelocations({ ...options, readSource: path => path === requested ? transform(read(path)) : read(path) })).toThrow();
    });
  }
  it("rejects a redirected relative dependency", () => {
    const file = FROZEN_PM_RELOCATIONS["packages/venue-adapter/polymarket/bet.ts"];
    expect(read(file)).toContain('from "../pmClientApi"');
    expect(() => certifyEsportRelocations({ ...options, readSource: path => path === file ? read(path).replace('from "../pmClientApi"', 'from "../gtc/client"') : read(path) })).toThrow(/exact unified PM preflight increment|original implementation unchanged outside optimized increments/);
  });
  it("rejects a changed manifest and changed immutable source", () => {
    expect(() => certifyEsportRelocations({ ...options, manifestText: JSON.stringify({ paths: [] }) })).toThrow("original freeze manifest unchanged");
    expect(() => certifyEsportRelocations({ ...options, baselineRead: (base, file) => gitSource(base, file) + "\nvoid changedBaseline();" })).toThrow();
  });
  it("keeps unknown frozen implementations and ordinary venue changes blocked", () => {
    const changed = ["packages/venue-adapter/polymarket/fok/extra.ts", "packages/venue-adapter/predictfun/bet.ts", "client/web/src/stores/oddsStore.ts"];
    expect(checkEsportChanges(changed, options.manifestText, read, gitSource).hits).toEqual(changed);
  });
  it("does not exempt other documentation in the frozen folder", () => {
    expect(checkEsportChanges(["packages/venue-adapter/polymarket/fok/extra.md"], options.manifestText, read, gitSource).hits).toEqual(["packages/venue-adapter/polymarket/fok/extra.md"]);
    expect(() => certifyEsportRelocations({ ...options, readSource: file => file.endsWith("fok/README.md") ? read(file) + "changed" : read(file) })).toThrow("exact relocation document");
  });
});

// 真正 CLI 的默认配置；用隔离进程注入读文件和 git 目录清单故障，既不改文件也不设放行。
function cli({ file, change, untracked, base } = {}) {
  const code = `
    import fs from 'node:fs'; import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
    const read = fs.readFileSync, exec = cp.execFileSync;
    fs.readFileSync = function(path, ...args) { const source=read.call(this,path,...args); return typeof source === 'string' && String(path).replaceAll('\\\\','/').endsWith(${JSON.stringify(file ?? "never")}) ? (${change ?? "source => source"})(source) : source; };
    cp.execFileSync = function(command,args,...rest) { const result=exec.call(this,command,args,...rest); return args[0] === 'ls-files' ? result + ${JSON.stringify(untracked ? `${untracked}\0` : "")} : result; };
    delete process.env.ALLOW_ESPORT_TOUCH;
    ${base ? `process.env.ESPORT_FREEZE_BASE=${JSON.stringify(base)};` : "delete process.env.ESPORT_FREEZE_BASE;"}
    syncBuiltinESMExports(); await import('./packages/venue-adapter/scripts/check-esport-freeze.mjs');
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", code], { encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
}
it("real default freeze CLI passes certified relocation without a flag", () => {
  const result = cli(); expect(result.status).toBe(0); expect(result.stdout).toContain("frozen hits=0");
}, 30_000);
for (const file of ["packages/venue-adapter/polymarket/bet.ts", "packages/venue-adapter/polymarket/fok/bet.ts", "packages/venue-adapter/polymarket/orders/history/orders.ts"]) {
  it(`real default CLI rejects added actions in ${file}`, () => {
    const result = cli({ file, change: 'source => source + "\\nvoid unexpectedTradingAction();\\n"' });
    expect(result.status).toBe(1); expect(result.stderr).toMatch(/compatibility entry|complete implementation and dependencies unchanged|exact reviewed settlement implementation|original implementation unchanged outside optimized increments/);
  }, 30_000);
}
it("real default CLI detects a new untracked frozen implementation", () => {
  const result = cli({ untracked: "packages/venue-adapter/polymarket/fok/newSubmit.ts" });
  expect(result.status).toBe(1); expect(result.stderr).toContain("fok/newSubmit.ts");
}, 30_000);
it("real default CLI rejects an invalid diff base rather than treating errors as no changes", () => {
  const result = cli({ base: "nonexistent-freeze-baseline-for-test" });
  expect(result.status).toBe(1); expect(result.stderr).toContain("unknown revision");
}, 30_000);
