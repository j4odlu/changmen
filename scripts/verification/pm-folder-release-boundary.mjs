// [changmen 扩展] 独立 PM 目录迁移：完整实现证明，原冻结清单与业务基线不变。
import { verifyClientPackageRelocation } from "./client-package-relocation.mjs";
import { verifyNodePackageRelocation } from "./node-package-relocation.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PM_FOK_RELOCATIONS, readRelocatedPmFokSource } from "./pm-fok-source-relocation.mjs";
import { PM_FUNCTIONAL_RELOCATIONS, readRelocatedPmFunctionalSource } from "./pm-functional-source-relocation.mjs";
import { verifyPmOfficialSettlementSource } from "./pm-settlement-policy-boundary.mjs";
import { PM_UNIFIED_PREFLIGHT_HELPERS, verifyPmUnifiedPreflightHelpers } from "./pm-unified-preflight-boundary.mjs";

export const PM_FOLDER_SOURCE_BASE = "e901bb596952256284cd8a9eb8b73b572c963915";
export const PM_FOLDER_FREEZE_SHA = "f0b521cba45430c9e6d4842abe29c1fd560df6209d4efe1ade4a833dba278ddb";
const normalize = s => s.replace(/\r\n/g, "\n");
export const PM_FOLDER_RELOCATIONS = Object.freeze({ ...PM_FOK_RELOCATIONS, ...PM_FUNCTIONAL_RELOCATIONS });
const fokDoc = "packages/venue-adapter/polymarket/fok/README.md";
const fokDocSha = "6c178d10abbd140e66725c1a51bc569dbdcdd29d38c7e56ebd15615471e787dc";

export function certifyPmFolderRelease(manifestText, read, baselineRead) {
  assert.equal(createHash("sha256").update(normalize(manifestText)).digest("hex"), PM_FOLDER_FREEZE_SHA, "original freeze manifest unchanged");
  const certified = new Set();
  verifyPmUnifiedPreflightHelpers(read);
  for (const file of Object.keys(PM_UNIFIED_PREFLIGHT_HELPERS)) certified.add(file);
  for (const [file, target] of Object.entries(PM_FOLDER_RELOCATIONS)) {
    const restored = (PM_FOK_RELOCATIONS[file] ? readRelocatedPmFokSource : readRelocatedPmFunctionalSource)(file, read(file), read);
    // [changmen 扩展] 明确登记的结算策略及卖出盈亏保护模块另做完整源码核验，其余仍逐字锁定迁移前基线。
    if (!verifyPmOfficialSettlementSource(file, restored))
      assert.equal(restored, normalize(baselineRead(PM_FOLDER_SOURCE_BASE, file)), `${target}: complete implementation and dependencies unchanged`);
    if (PM_FOK_RELOCATIONS[file]) {
      for (const base of ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"])
        assert.equal(restored, normalize(baselineRead(base, file)), `${target}: fixed FOK/VPS baseline`);
    }
    certified.add(file); certified.add(target);
  }
  assert.equal(createHash("sha256").update(normalize(read(fokDoc))).digest("hex"), fokDocSha, "exact relocation document");
  certified.add(fokDoc);
  return certified;
}

export function checkPmFolderFreeze(changed, manifestText, read, baselineRead) {
  const certified = certifyPmFolderRelease(manifestText, read, baselineRead);
  for (const file of verifyClientPackageRelocation(read)) certified.add(file);
  for (const file of verifyNodePackageRelocation(read)) certified.add(file);
  // 新实现继承原模块的冻结保护；不豁免整个目录或其它新增文件。
  const originalPaths = JSON.parse(manifestText).paths;
  const paths = [...originalPaths, "packages/venue-adapter/polymarket/fok", ...Object.entries(PM_FOLDER_RELOCATIONS)
    .filter(([file]) => originalPaths.includes(file)).map(([, target]) => target)];
  const hits = changed.filter(file => !/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(file)
    && paths.some(fp => file === fp || file.endsWith(`/${fp}`) || file.startsWith(`${fp}/`)));
  return { hits: hits.filter(file => !certified.has(file)), certifiedHits: hits.filter(file => certified.has(file)), certifiedRelocations: Object.keys(PM_FOLDER_RELOCATIONS).length };
}
