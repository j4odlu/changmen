// [changmen 扩展] Only the reviewed account persistence increments are restored.
// Every accepted new statement is exact; all other source still reaches the
// original full-module comparison against the unchanged 551-entry manifest.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const accountPersistenceContract = "scripts/verification/account-persistence-increments.json";
const contractSha256 = "eb6acaa6496e781871e21ca6a99e458762c4b49409743c25bdf12c009ceadc45";
const files = new Set([
  "server/backend/core/account/account_service.js",
  "server/backend/core/integrations/polymarket/pm_client_handlers.js",
  "server/backend/core/integrations/predictfun/pf_player_account.js",
]);

export function restoreAccountPersistenceSource(file, source, readSource, replaceExact) {
  if (!files.has(file)) return source;
  const text = readSource(accountPersistenceContract).replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(text).digest("hex"), contractSha256,
    "reviewed account persistence increments must remain exact");
  const contract = JSON.parse(text);
  assert.equal(contract.previousCommit, "1f9ca758959a24d947439bc42be6ae2ce5c3661e");
  for (const change of contract.files[file])
    source = replaceExact(source, change.after, change.before);
  return source;
}
