import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { PM_FOK_RELOCATIONS, readRelocatedPmFokSource } from "./pm-fok-source-relocation.mjs";

// [changmen 扩展] 单独核对迁移模块的完整实现，不能用整批保护的首个历史失败掩盖这些文件。
const manifest = JSON.parse(fs.readFileSync("scripts/verification/vps-fok-baseline.json", "utf8"));
const normalize = source => source.replace(/\r\n/g, "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const files = [];
for (const [file, target] of Object.entries(PM_FOK_RELOCATIONS)) {
  const current = readRelocatedPmFokSource(file, fs.readFileSync(file, "utf8"));
  for (const base of ["219535c8", manifest.version]) {
    const original = normalize(execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }));
    assert.equal(current, original, `${file}: complete implementation changed after relocation (${base})`);
    if (base === manifest.version)
      assert.equal(sha(original), manifest.protectedFiles[file], `${file}: fixed VPS provenance mismatch`);
  }
  files.push({ original: file, current: target, completeSourceIdentical: true });
}
const result = { files, references: ["219535c8", manifest.version], wholeSourceComparisons: files.length * 2, fixedManifestUnchangedByThisCheck: true };
fs.mkdirSync("output", { recursive: true });
fs.writeFileSync("output/pm-fok-source-relocation.json", `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
