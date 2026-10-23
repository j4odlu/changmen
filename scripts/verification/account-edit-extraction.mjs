// [changmen 扩展] Exact account-dialog extraction proof; original migration/FOK inventories stay unchanged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./account-edit-extraction.json", import.meta.url), "utf8");
assert.equal(sha(text), "a71228b27ed5a584b1f9f3f4a015816f2a7034b374386ae1cb9994bc5bba33b8", "Account dialog extraction inventory changed");
export const ACCOUNT_EDIT_EXTRACTION = JSON.parse(text);
assert.equal(ACCOUNT_EDIT_EXTRACTION.purpose, "account-edit-dialog-extraction-only");
assert.equal(sha(ACCOUNT_EDIT_EXTRACTION.before), ACCOUNT_EDIT_EXTRACTION.beforeSha);

export function restoreAccountEditSource(file, source) {
  if (file !== ACCOUNT_EDIT_EXTRACTION.file || sha(source) !== ACCOUNT_EDIT_EXTRACTION.afterSha) return source;
  // A historical source view may only hide this exact extraction when every new
  // implementation is still authenticated on disk. This is never a runtime loader.
  for (const row of ACCOUNT_EDIT_EXTRACTION.assets)
    assert.equal(sha(fs.readFileSync(new URL("../../" + row.file, import.meta.url), "utf8")), row.sha,
      row.file + ": extracted account implementation changed");
  return ACCOUNT_EDIT_EXTRACTION.before;
}

export function verifyAccountEditExtraction(read) {
  assert.equal(sha(read(ACCOUNT_EDIT_EXTRACTION.file)), ACCOUNT_EDIT_EXTRACTION.afterSha, "Unreviewed account dialog extraction");
  for (const row of ACCOUNT_EDIT_EXTRACTION.assets)
    assert.equal(sha(read(row.file)), row.sha, row.file + ": extracted account implementation changed");
  return { files: 1, assets: ACCOUNT_EDIT_EXTRACTION.assets.length };
}
