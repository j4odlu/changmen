// [changmen 扩展] 精确登记钱包初始化前移、Gamma 预热与交易赛况闸；原 FOK 固定基线不变。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { verifyPmAccountSigningContract } from "./pm-account-signing-boundary.mjs";
import { restorePmOptimizedFokSource } from "./pm-optimized-fok-boundary.mjs";
import { gitSource, moduleTokens, replaceExact } from "./fok-exact-boundaries.mjs";
import { restoreGtcSelectionHistorySource } from "./gtc-selection-history-boundary.mjs";
import { restorePmUnifiedPreflightSource, verifyPmUnifiedPreflightContract } from "./pm-unified-preflight-boundary.mjs";
import { restoreA8MakeupSource } from "./a8-makeup-boundary.mjs";

const registered = fs.readFileSync(new URL("./pm-preflight-increments.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(registered).digest("hex"), "4f0c597bacc484e229baf8ee6f9ba5b558bccc59087b200060581a9921d50976", "PM preflight reviewed increments must remain fixed");
const changes = JSON.parse(registered);
const helpers = {
  "packages/venue-adapter/polymarket/markets/pmGammaCache.ts": "ce3f181e0b6af9233df908fef0e8a6aad01ad6b7363aee5a570bc3f9e9a4eb4f",
  "packages/venue-adapter/polymarket/markets/pmSportPrewarm.ts": "d39fcabf80b2138d973c2342f2dfb509699adcae11425daec50bbcbd4d5e249d",
};
const markers = {
  "client/web/src/stores/account/betGateway.ts": "requireClobConfirmation",
  "client/web/src/runtime/appSession.ts": "preparePolymarketAccountRuntimes",
  "client/web/src/stores/betting/autoBet/phases/checkArbLegs.ts": "requireClobConfirmation",
  "client/web/src/stores/betting/autoBet/phases/prepareArbAttempt.ts": "prewarmPmSportForCandidate",
  "client/web/src/stores/betting/autoBet/retryFailedLeg.ts": "requireClobConfirmation",
  "packages/venue-adapter/polymarket/fok/bet.ts": "requireClobConfirmation",
  "packages/venue-adapter/polymarket/submission/pmManualSell.ts": "= getPolymarketOrderClientRuntime",
  "client/web/src/runtime/podPmFollowPlace.ts": "getRetainedPmPrivateKey",
  "client/web/src/runtime/sportsSession.ts": "preparePolymarketAccountRuntimes",
  "client/web/src/stores/account/accountCrud.ts": "getRetainedPmSessionEpoch",
  "packages/venue-adapter/contract/index.ts": "requireClobConfirmation",
  "packages/venue-adapter/polymarket/index.ts": "preparePolymarketAccountRuntimes",
  "packages/venue-adapter/polymarket/markets/pmSportGamma.ts": "createPmGammaReader",
  "packages/venue-adapter/polymarket/submission/preflight/pmBetGuard.ts": "requireClobConfirmation",
  "packages/venue-adapter/polymarket/submission/client/pmOrderClientCache.ts": "preparePolymarketOrderClientRuntime",
};

// [changmen 扩展] 钱包 await 完成后取消旧会话；只还原这两行增量，原登记内容和哈希不变。
const walletCompletionGuards = {
  "client/web/src/runtime/appSession.ts": "if (!isAuthSessionCurrent(sessionVersion)) return;",
  "client/web/src/runtime/sportsSession.ts": "if (gen !== sportsSessionGen) return;",
};

export function restorePmPreflightSource(file, source, required = false) {
  source = restoreA8MakeupSource(file, source, replaceExact);
  source = restorePmUnifiedPreflightSource(file, source);
  const guard = walletCompletionGuards[file];
  if (guard) {
    source = source.replaceAll("\r\n", "\n");
    const before = "  await preparePolymarketAccountRuntimes(accountStore.accounts);\n";
    const after = before + "  " + guard + "\n";
    if (required || source.includes(after)) source = replaceExact(source, after, before);
  }
  const increments = changes[file];
  if (!increments) return source;
  if (!required && !source.includes(markers[file])) return source;
  source = source.replaceAll("\r\n", "\n");
  for (const [before, after] of increments) {
    if (source.includes(after)) {
      assert.equal(source.split(after).length, 2, `${file}: unique PM preflight increment`);
      source = source.replace(after, before);
    }
    else source = replaceExact(source, after, before);
  }
  return source;
}

export function verifyPmPreflightContract(readSource) {
  verifyPmUnifiedPreflightContract(readSource);
  verifyPmAccountSigningContract(readSource);
  for (const [file, expected] of Object.entries(helpers)) {
    const digest = createHash("sha256").update(restorePmOptimizedFokSource(file, readSource(file)).replaceAll("\r\n", "\n")).digest("hex");
    assert.equal(digest, expected, `${file}: complete reviewed PM preflight helper`);
  }
  for (const file of Object.keys(changes)) {
    // 强制真实源码包含所有新边界；整体删除新逻辑不能借由兼容旧源码的分支蒙混过关。
    let restored = restorePmPreflightSource(file, readSource(file), true);
    if (file.endsWith("prepareArbAttempt.ts"))
      restored = restoreGtcSelectionHistorySource(file, restored, replaceExact, true);
    assert.deepEqual(moduleTokens(restored), moduleTokens(gitSource("1f9ca758959a24d947439bc42be6ae2ce5c3661e", file)), `${file}: only reviewed PM preflight increments`);
  }
  return { precisePmPreflightModules: Object.keys(changes).length, pinnedPmPreflightHelpers: Object.keys(helpers).length };
}
