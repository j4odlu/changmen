import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { OB_FOOTBALL_EXTRACTION as evidence, restoreObFootballSource, verifyObFootballExtraction } from "./ob-football-extraction.mjs";
import { readPreviousWorkspaceFile } from "./workspace-layout-history.mjs";
import { readAdapterHistory } from "./browser-entry-history.mjs";
import { inspectWorkspaceLayout } from "./workspace-layout-relocation.mjs";
const read = file => fs.readFileSync(file, "utf8");
const normal = source => source.replaceAll("\r\n", "\n");
it("authenticates the complete OB extraction and restores the original immutable FOK source through both historical readers", () => {
  expect(verifyObFootballExtraction(read)).toEqual({ files: 1, assets: 2 });
  expect(evidence.before).toBe(normal(execFileSync("git", ["show", `${evidence.baseline}:${evidence.file}`], { encoding: "utf8", windowsHide: true })));
  const manifest = JSON.parse(read("scripts/verification/vps-fok-baseline.json"));
  expect(evidence.beforeSha).toBe(manifest.protectedFiles[evidence.file]);
  for (const source of [read(evidence.file), normal(read(evidence.file)).replaceAll("\n", "\r\n")])
    expect(restoreObFootballSource(evidence.file, source)).toBe(evidence.before);
  expect(readPreviousWorkspaceFile(evidence.file, "utf8")).toBe(evidence.before);
  expect(readPreviousWorkspaceFile(evidence.file).toString()).toBe(evidence.before);
  expect(readAdapterHistory(evidence.file, "utf8")).toBe(evidence.before);
});
it("does not conceal extra changes to the HTTP/cache entry or either extracted implementation", () => {
  const changed = read(evidence.file) + "\nvoid unexpectedRequest();";
  expect(restoreObFootballSource(evidence.file, changed)).toBe(changed);
  expect(() => verifyObFootballExtraction(file => file === evidence.file ? changed : read(file))).toThrow("Unreviewed OB football extraction");
  for (const row of evidence.assets) {
    const tampered = file => read(file) + (file === row.file ? "\nvoid changed();" : "");
    expect(() => restoreObFootballSource(evidence.file, read(evidence.file), tampered)).toThrow("extracted OB football implementation changed");
    expect(() => verifyObFootballExtraction(tampered)).toThrow("extracted OB football implementation changed");
    expect(() => inspectWorkspaceLayout(process.cwd(), { read: tampered })).toThrow("extracted OB football implementation changed");
  }
});
for (const [file, change, message] of [
  [evidence.file, 'source => source.replace("const CACHE_TTL_MS = 10_000", "const CACHE_TTL_MS = 100_000")', "unregistered protected source difference"],
  [evidence.assets[0].file, 'source => source.replace("if (csid && csid !== CSID_FOOTBALL)", "if (false)")', "extracted OB football implementation changed"],
  [evidence.assets[1].file, 'source => source.replace("const betId = matchId * 100 + seq", "const betId = matchId * 10 + seq")', "extracted OB football implementation changed"],
]) it(`real immutable VPS entry rejects a changed OB implementation: ${file}`, () => {
  const code = `
    import fs from "node:fs";
    const read = fs.readFileSync;
    fs.readFileSync = function(path, ...args) {
      const value = read.call(this, path, ...args);
      if (typeof value !== "string" || !String(path).replaceAll(String.fromCharCode(92), "/").endsWith(${JSON.stringify(file)})) return value;
      const changed = (${change})(value);
      if (changed === value) throw new Error("Mutation did not apply");
      return changed;
    };
    process.argv = [process.execPath, "scripts/verification/verify-vps-fok-baseline.mjs"];
    await import("./scripts/verification/verify-vps-fok-baseline.mjs");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
}, 30000);
