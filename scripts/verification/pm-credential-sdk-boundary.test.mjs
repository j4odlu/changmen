import { test, vi } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PM_CREDENTIAL_SDK, pmCredentialSdkSha, restorePmCredentialSdkSource, verifyPmCredentialSdkSources, readRetiredPmCredentialSdkSource } from "./pm-credential-sdk-boundary.mjs";
import { verifyPmBalanceCredentialsSources } from "./pm-balance-credentials-boundary.mjs";
import { readPreviousWorkspaceFile } from "./workspace-layout-history.mjs";
import { PM_SDK_RETIREMENT, restorePmSdkRetirementSource, verifyPmSdkRetirement } from "./pm-sdk-retirement.mjs";

const read = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8");

test("only credential source, tests and dependency audit changes restore to their complete prior source", () => {
  assert.equal(PM_CREDENTIAL_SDK.baseline, "bda8e916c70e6e3c1079baa2851aa48550db4a5b");
  assert.deepEqual([...PM_CREDENTIAL_SDK.files.map(row => row.file)].sort(), [
    "client/packages/venue-browser/adapter/polymarket/tests/auth/credentials.test.ts",
    "client/packages/venue-browser/polymarket/auth/credentials.ts",
    "scripts/verification/pm-dependency-audit.test.mjs",
    "scripts/verification/pm-dependency-inputs.json",
    "scripts/verification/source-ownership.test.mjs",
    "scripts/verification/workspace-layout-history.mjs",
  ]);
  assert.deepEqual(verifyPmCredentialSdkSources(read), { files: 6, retired: 1 });
  for (const row of PM_CREDENTIAL_SDK.files) {
    const prior = restorePmCredentialSdkSource(row.file, read(row.file));
    assert.equal(pmCredentialSdkSha(prior), row.beforeSha);
    assert.equal(restorePmCredentialSdkSource(row.file, prior), prior);
  }
  const unrelated = "client/packages/venue-browser/polymarket/fok/bet.ts";
  assert.equal(restorePmCredentialSdkSource(unrelated, read(unrelated)), read(unrelated));
});

test("extra source changes and reverting this migration fail both current and prior guards", () => {
  for (const row of PM_CREDENTIAL_SDK.files) {
    for (const changed of [read(row.file) + "\n// extra edit\n", restorePmCredentialSdkSource(row.file, read(row.file))]) {
      const mutated = file => file === row.file ? changed : read(file);
      assert.throws(() => verifyPmCredentialSdkSources(mutated));
      assert.throws(() => verifyPmBalanceCredentialsSources(mutated));
    }
  }
});

test("historical workspace reads retain the original relocation and funding snapshots", () => {
  const file = "client/packages/venue-browser/adapter/polymarket/tests/auth/credentials.test.ts";
  const row = PM_CREDENTIAL_SDK.files.find(row => row.file === file);
  assert.equal(pmCredentialSdkSha(readPreviousWorkspaceFile(new URL("../../" + file, import.meta.url), "utf8")), row.beforeSha);
  verifyPmBalanceCredentialsSources(read);
});

test("the earlier SDK retirement gate accepts only the exact credential audit changes", () => {
  verifyPmSdkRetirement(read);
  for (const file of ["scripts/verification/pm-dependency-inputs.json", "scripts/verification/pm-dependency-audit.test.mjs"]) {
    const row = PM_SDK_RETIREMENT.files.find(row => row.file === file);
    assert(row);
    assert.equal(restorePmSdkRetirementSource(file, read(file), read), row.before);
    const altered = read(file) + "\n// unreviewed edit\n";
    assert.throws(() => verifyPmSdkRetirement(target => target === file ? altered : read(target)));
    assert.equal(restorePmSdkRetirementSource(file, altered, read), altered);
  }
});

test("the deleted L1 source remains available only to historical proofs and cannot return at runtime", async () => {
  assert.deepEqual(PM_CREDENTIAL_SDK.retired.map(row => row.file), ["server/backend/core/integrations/polymarket/clob_l1.js"]);
  const row = PM_CREDENTIAL_SDK.retired[0];
  const file = new URL("../../" + row.file, import.meta.url);
  assert.equal(fs.existsSync(file), false);
  assert.equal(pmCredentialSdkSha(readRetiredPmCredentialSdkSource(row.file)), row.beforeSha);
  assert.equal(readPreviousWorkspaceFile(file, "utf8"), row.before);
  await assert.rejects(import(file.href));
  const exists = fs.existsSync;
  const spy = vi.spyOn(fs, "existsSync").mockImplementation(target => String(target) === file.href ? true : exists(target));
  try {
    assert.throws(() => readRetiredPmCredentialSdkSource(row.file), /retired server L1 implementation returned/);
    assert.throws(() => verifyPmCredentialSdkSources(read), /retired server L1 implementation returned/);
  } finally { spy.mockRestore(); }
});
