import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import fs from "node:fs";
import { expect, it } from "vitest";
import { verifyPmLegacyFokRuntimeContract } from "./pm-legacy-fok-runtime-boundary.mjs";
const readBeforeExecution = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8"));
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
it("preserves all code outside the exact legacy FOK signer compatibility repair", () => {
  expect(() => verifyPmLegacyFokRuntimeContract(read)).not.toThrow();
});
it.each([
  ["preflight/pmBuyPreflight.ts", 'tasks.sportMode === "legacy"', "true"],
  ["preflight/pmBuyPreflight.ts", "sessionGeneration !== polymarketSigningSessionGeneration(account)", "false"],
  ["client/pmOrderClientCache.ts", "return Math.max(clearedGeneration, account.accountId", "return Math.max(0, account.accountId"],
])("rejects mode isolation or revocation guard changes in %s", (suffix, before, after) => {
  expect(() => verifyPmLegacyFokRuntimeContract(file => file.endsWith(suffix)
    ? read(file).replace(before, after) : read(file))).toThrow();
});
