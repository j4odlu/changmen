import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { PM_FUNCTIONAL_RELOCATIONS, readRelocatedPmFunctionalSource } from "./pm-functional-source-relocation.mjs";
import { verifyPmOfficialSettlementSource } from "./pm-settlement-policy-boundary.mjs";

// [changmen 扩展] 本次迁移前的固定提交；逐文件恢复 import 后全文比较，不重置原 FOK/VPS 基线。
export const PM_FUNCTIONAL_SOURCE_BASE = "e901bb596952256284cd8a9eb8b73b572c963915";
const files = [];
for (const [file, target] of Object.entries(PM_FUNCTIONAL_RELOCATIONS)) {
  const current = readRelocatedPmFunctionalSource(file, fs.readFileSync(file, "utf8"));
  const original = execFileSync("git", ["show", `${PM_FUNCTIONAL_SOURCE_BASE}:${file}`], { encoding: "utf8" }).replace(/\r\n/g, "\n");
  const reviewedSettlement = verifyPmOfficialSettlementSource(file, current);
  if (!reviewedSettlement)
    assert.equal(current, original, `${file}: complete implementation or dependency changed`);
  files.push({ original: file, current: target, completeSourceIdentical: !reviewedSettlement,
    ...(reviewedSettlement ? { reviewedPolicy: "official-winner-only" } : {}) });
}
fs.mkdirSync("output", { recursive: true });
fs.writeFileSync("output/pm-functional-source-relocation.json", `${JSON.stringify({ reference: PM_FUNCTIONAL_SOURCE_BASE, files }, null, 2)}\n`);
process.stdout.write(`PM functional relocation: ${files.length} complete implementations and compatibility entries verified.\n`);
