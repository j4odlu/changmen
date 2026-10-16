// [changmen 扩展] 公共预检提取和双 FOK 模式的精确增量；不修改任何原 FOK/VPS 基线。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { restorePmOptimizedFokSource, verifyPmOptimizedFokContract } from "./pm-optimized-fok-boundary.mjs";
import { restorePmPreflightModeIsolation, verifyPmPreflightModeIsolation } from "./pm-preflight-mode-isolation-boundary.mjs";
const normalize = value => value.replaceAll("\r\n", "\n");
const digest = value => createHash("sha256").update(normalize(value)).digest("hex");
const registered = normalize(fs.readFileSync(new URL("./pm-unified-preflight-increments.json", import.meta.url), "utf8"));
assert.equal(digest(registered), "13669430f01a712ef3ca243e9deb19ef817ec6076d803c6efc843bef1f4d1cec", "reviewed unified PM preflight increments stay fixed");
const changes = JSON.parse(registered);
export const PM_UNIFIED_PREFLIGHT_HELPERS = Object.freeze({
  "packages/venue-adapter/polymarket/fok/preflight.ts": "82d2be80a97eb414f58889d9643891243ce657fdb15f9d7ba83d3e0f6d9658f3",
  "packages/venue-adapter/polymarket/submission/preflight/pmBuyPreflight.ts": "05194a5c8208044876151df197f6024a4eabbfca0a9bdecd0d1caa513e0cebb5",
  "packages/venue-adapter/polymarket/submission/preflight/pmFokPreflightMode.ts": "236e18550eb99dfc3a142457ef54488fa586b16f8641f9f6c5a7e409525d85ef",
  "packages/venue-adapter/polymarket/submission/preflight/legacy/pmBetGuard.ts": "c9e54fcecf0c03aa2d2c2d3bb00b0acfb145b25ed635fadf5d28defb9602a2d6",
  "packages/venue-adapter/polymarket/submission/preflight/legacy/pmSportGamma.ts": "0fba27246c17030bac090396c186172325eae33324eeb8b7336a16d05f17fc5d"
});
const beforeHashes = {
  "packages/venue-adapter/polymarket/fok/bet.ts": "403516bdebdf2a45cb9d99703d70b88b69bb8857b80c8328cada5ddd783f9c43",
  "packages/venue-adapter/polymarket/gtc/preparation.ts": "4f07461c5abe1b4b17f1bdf70af9fc1a8617a12d89be8ce6c05a4c18ff31eefb",
  "client/web/src/types/extensionPrefs.ts": "5b9e850382c0621331aa77f1c44cab57a8fb6ced8e1380e4f5c19cba38258bf9",
  "client/web/src/stores/userStore.ts": "88089ca5e8c7466420817b4d075559863e4b5430a29c4dfffa2a1105a3c2b5c5",
  "client/web/src/components/user/tabs/UserDiagExtensionsTab.vue": "78b3e7a6d5e8adf4ae14adee33c81e5ef959e3d62d8a20468fdbb45ec69168d8",
  "client/web/src/stores/betting/autoBet/phases/prepareArbAttempt.ts": "9bfd6e6b0233cf9b9cbf4568b2cf80d696039f588b4e05c0531aff74e222ed6a",
  "packages/venue-adapter/polymarket/index.ts": "1ab1ca89fdbcc2bf22426b2241cfee02f7079a0b2ac7a2aca2b3f50091a33bea"
};
const markers = {
  "packages/venue-adapter/polymarket/index.ts": "capturePmFokPreflightMode",
  "packages/venue-adapter/polymarket/fok/bet.ts": "checkFokBuy",
  "packages/venue-adapter/polymarket/gtc/preparation.ts": "runPmBuyPreflight",
  "client/web/src/types/extensionPrefs.ts": "pmFokPreflightMode",
  "client/web/src/stores/userStore.ts": "setPmFokPreflightMode",
  "client/web/src/components/user/tabs/UserDiagExtensionsTab.vue": "pmFokPreflightMode",
  "client/web/src/stores/betting/autoBet/phases/prepareArbAttempt.ts": "capturePmFokPreflightMode",
};
export function restorePmUnifiedPreflightSource(file, source, required = false) {
  source = restorePmOptimizedFokSource(file, source);
  source = restorePmPreflightModeIsolation(file, source);
  if (!changes[file] || (!required && !source.includes(markers[file]))) return source;
  let restored = normalize(source);
  for (const [before, after] of changes[file]) {
    assert.equal(restored.split(after).length, 2, file + ": exact unified PM preflight increment");
    restored = restored.replace(after, before);
  }
  return restored;
}
export function verifyPmUnifiedPreflightHelpers(read) {
  verifyPmPreflightModeIsolation(file => restorePmOptimizedFokSource(file, read(file)));
  verifyPmOptimizedFokContract(read);
  for (const [file, expected] of Object.entries(PM_UNIFIED_PREFLIGHT_HELPERS))
    assert.equal(digest(restorePmPreflightModeIsolation(file, restorePmOptimizedFokSource(file, read(file)))), expected, file + ": complete reviewed unified PM preflight helper");
}
export function verifyPmUnifiedPreflightContract(read) {
  verifyPmUnifiedPreflightHelpers(read);
  for (const file of Object.keys(changes))
    assert.equal(digest(restorePmUnifiedPreflightSource(file, read(file), true)), beforeHashes[file], file + ": complete module before unified PM preflight increments");
}
