// [changmen 扩展] 使用已提交的唯一冻结证书，不生成或替换冻结清单。
import { PM_FOK_RELOCATIONS } from "./pm-fok-source-relocation.mjs";
import { PM_FOLDER_FREEZE_SHA, PM_FOLDER_SOURCE_BASE, certifyPmFolderRelease, checkPmFolderFreeze } from "./pm-folder-release-boundary.mjs";
import { PM_FUNCTIONAL_RELOCATIONS } from "./pm-functional-source-relocation.mjs";
export const ESPORT_RELOCATION_BASE = PM_FOLDER_SOURCE_BASE;
export const ESPORT_FREEZE_MANIFEST_SHA = PM_FOLDER_FREEZE_SHA;
export const FROZEN_RELOCATION_DOCUMENTS = Object.freeze({
  "packages/venue-adapter/polymarket/fok/README.md": "6c178d10abbd140e66725c1a51bc569dbdcdd29d38c7e56ebd15615471e787dc",
});
const root = "packages/venue-adapter/polymarket/";
const names = ["collect", "orders", "orderStatus", "orderTypes", "legOutcome", "userWs", "userWsMessages", "pmLogicalPosition", "pmOrigin", "pmDetection", "pmBetGuard", "pmClientApi", "l2Auth"];
export const FROZEN_PM_RELOCATIONS = Object.freeze({
  ...PM_FOK_RELOCATIONS,
  ...Object.fromEntries(names.map(name => [`${root}${name}.ts`, PM_FUNCTIONAL_RELOCATIONS[`${root}${name}.ts`]])),
});
export function isEsportFrozen(file, paths) {
  if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(file)) return false;
  return [...paths, `${root}fok`, ...Object.values(FROZEN_PM_RELOCATIONS)].some(prefix => file === prefix || file.startsWith(`${prefix}/`));
}
export function certifyEsportRelocations({ manifestText, readSource, baselineRead }) {
  const verified = certifyPmFolderRelease(manifestText, readSource, baselineRead);
  const frozen = new Set([...Object.entries(FROZEN_PM_RELOCATIONS).flat(), ...Object.keys(FROZEN_RELOCATION_DOCUMENTS)]);
  return new Set([...verified].filter(file => frozen.has(file)));
}
export function checkEsportChanges(changed, manifestText, readSource, baselineRead) {
  return checkPmFolderFreeze(changed, manifestText, readSource, baselineRead);
}
