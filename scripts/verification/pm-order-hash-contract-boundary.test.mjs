import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PM_ORDER_HASH_CONTRACTS, pmOrderHashContractSha, restorePmOrderHashContractSource,
  verifyPmOrderHashContractSources } from "./pm-order-hash-contract-boundary.mjs";
import { restorePmBalanceCredentialsSource, verifyPmBalanceCredentialsSources } from "./pm-balance-credentials-boundary.mjs";
import { readPreviousWorkspaceFile } from "./workspace-layout-history.mjs";

const read = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8");

test("only the two contract-config sources restore to their full pre-migration source", () => {
  assert.equal(PM_ORDER_HASH_CONTRACTS.baseline, "71c8fbc9d6e924bcbc1789e8cf5a14039cf6bbbd");
  assert.equal(PM_ORDER_HASH_CONTRACTS.purpose, "decouple-pm-recovery-hash-contract-config");
  assert.deepEqual(PM_ORDER_HASH_CONTRACTS.files.map(row => row.file), [
    "client/packages/venue-browser/polymarket/submission/recovery/pmSubmitJournal.ts",
    "client/packages/venue-browser/polymarket/wallet/contracts.ts",
  ]);
  assert.deepEqual(verifyPmOrderHashContractSources(read), { files: 2 });
  for (const row of PM_ORDER_HASH_CONTRACTS.files) {
    const prior = restorePmOrderHashContractSource(row.file, read(row.file));
    assert.equal(pmOrderHashContractSha(prior), row.beforeSha);
    assert.equal(restorePmOrderHashContractSource(row.file, prior), prior);
    assert.equal(restorePmBalanceCredentialsSource(row.file, read(row.file)), prior);
  }
  const unrelated = "client/packages/venue-browser/polymarket/submission/client/pmOrderClientCache.ts";
  assert.equal(restorePmOrderHashContractSource(unrelated, read(unrelated)), read(unrelated));
});

test("extra edits to addresses, hash logic or recovery and reverting the migration still fail", () => {
  for (const row of PM_ORDER_HASH_CONTRACTS.files) {
    const source = read(row.file);
    const altered = row.file.endsWith("contracts.ts")
      ? source.replace("0xe3333700cA9d93003F00f0F71f8515005F6c00Aa", "0x" + "00".repeat(20))
      : source.replace('chainId: 137', 'chainId: 80002');
    assert.notEqual(altered, source);
    for (const changed of [altered, source + "\n// extra edit\n", restorePmOrderHashContractSource(row.file, source)]) {
      const mutated = file => file === row.file ? changed : read(file);
      assert.throws(() => verifyPmOrderHashContractSources(mutated));
      assert.throws(() => verifyPmBalanceCredentialsSources(mutated));
      assert.equal(restorePmOrderHashContractSource(row.file, changed), changed);
    }
  }
});

test("the existing historical reader keeps the original execution and wallet hashes", () => {
  verifyPmBalanceCredentialsSources(read);
  for (const row of PM_ORDER_HASH_CONTRACTS.files) {
    const previous = readPreviousWorkspaceFile(new URL("../../" + row.file, import.meta.url), "utf8");
    assert.equal(pmOrderHashContractSha(previous), row.beforeSha);
  }
});

test("the native recovery hash module uses project config without importing the legacy SDK", () => {
  const source = read(PM_ORDER_HASH_CONTRACTS.files[0].file);
  assert.match(source, /import \{ POLYGON_POLYMARKET \} from "\.\.\/\.\.\/wallet\/contracts"/);
  assert.doesNotMatch(source, /getContractConfig|@polymarket\/clob-client-v2/);
});
