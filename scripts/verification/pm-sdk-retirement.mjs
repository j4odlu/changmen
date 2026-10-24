// Exact offline source view for historical audits; runtime never uses these snapshots.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { restorePmCredentialSdkSource } from "./pm-credential-sdk-boundary.mjs";
const sha = source => createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");
const text = fs.readFileSync(new URL("./pm-sdk-retirement.json", import.meta.url), "utf8");
assert.equal(sha(text), "aa14677447d6416ecc4aeec5c317d18bd0fd8bc7f0420733580bbd6f8c69635b", "PM SDK retirement evidence changed");
export const PM_SDK_RETIREMENT = JSON.parse(text);
assert.equal(PM_SDK_RETIREMENT.purpose, "retire-pm-legacy-sdks");
for (const row of PM_SDK_RETIREMENT.files) assert.equal(sha(row.before), row.beforeSha);
export const pmSdkRetirementFiles = new Set(["package-lock.json", ...PM_SDK_RETIREMENT.files.map(row => row.file)]);
export const pmSdkRetiredFiles = new Set(PM_SDK_RETIREMENT.files.filter(row => row.afterSha === null).map(row => row.file));
const readNative = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8");
function verifyAssets(read) {
  for (const row of PM_SDK_RETIREMENT.assets) assert.equal(sha(read(row.file)), row.sha, row.file + ": captured SDK fixture changed");
}
export function restorePmSdkRetirementSource(file, source, read = readNative) {
  source = restorePmCredentialSdkSource(file, source);
  if (file === "package-lock.json" && sha(source) === PM_SDK_RETIREMENT.lock.afterSha) {
    verifyAssets(read);
    const lock = JSON.parse(source);
    for (const row of PM_SDK_RETIREMENT.lock.packages) {
      assert.deepEqual(lock.packages[row.key] ?? null, row.after);
      if (row.before === null) delete lock.packages[row.key];
      else lock.packages[row.key] = row.before;
    }
    assert.equal(Object.keys(lock.packages).length, PM_SDK_RETIREMENT.lock.keyOrder.length);
    lock.packages = Object.fromEntries(PM_SDK_RETIREMENT.lock.keyOrder.map(key => [key, lock.packages[key]]));
    const restored = JSON.stringify(lock, null, 2) + "\n";
    assert.equal(sha(restored), PM_SDK_RETIREMENT.lock.beforeSha, "Original lock must restore exactly");
    return restored;
  }
  const row = PM_SDK_RETIREMENT.files.find(row => row.file === file);
  if (!row || row.afterSha === null || sha(source) !== row.afterSha) return source;
  verifyAssets(read);
  return row.before;
}
export function readRetiredPmSdkSource(file) {
  if (!pmSdkRetiredFiles.has(file)) return undefined;
  assert(!fs.existsSync(new URL("../../" + file, import.meta.url)), file + ": retired SDK polyfill returned");
  verifyAssets(readNative);
  return PM_SDK_RETIREMENT.files.find(row => row.file === file).before;
}
export function verifyPmSdkRetirement(read = readNative) {
  const currentRead = read;
  read = file => restorePmCredentialSdkSource(file, currentRead(file));
  verifyAssets(read);
  for (const row of PM_SDK_RETIREMENT.files) {
    if (row.afterSha === null) readRetiredPmSdkSource(row.file);
    else assert.equal(sha(read(row.file)), row.afterSha, row.file + ": unreviewed PM SDK retirement");
  }
  assert.equal(sha(read("package-lock.json")), PM_SDK_RETIREMENT.lock.afterSha, "Unreviewed dependency lock change");
  restorePmSdkRetirementSource("package-lock.json", read("package-lock.json"), read);
  return { files: PM_SDK_RETIREMENT.files.length, assets: PM_SDK_RETIREMENT.assets.length };
}

// A historical relocation can still compare its recorded SDK edge after uninstall.
// This returns evidence identity only; it never resolves or loads a runtime module.
export function historicalRetiredPmSdkTarget(file, spec) {
  if (!["@polymarket/builder-relayer-client", "@polymarket/builder-signing-sdk"].includes(spec)) return undefined;
  const canonical = file.replace(/^packages\/venue-adapter\//, "client/packages/venue-browser/");
  const row = PM_SDK_RETIREMENT.files.find(row => row.file === canonical);
  assert(row?.before.includes(`"${spec}"`), file + ": unrecorded retired SDK edge");
  verifyPmSdkRetirement();
  const dependency = PM_SDK_RETIREMENT.lock.packages.find(row => row.key === "node_modules/" + spec);
  assert(dependency?.before?.version && dependency.after === null);
  return `retired:${spec}@${dependency.before.version}`;
}
