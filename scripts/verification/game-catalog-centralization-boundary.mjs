// [changmen 扩展] Only restore the exact game-configuration migration; the original FOK manifest stays fixed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const gameCatalogContract = "scripts/verification/game-catalog-centralization-increments.json";
const contractSha256 = "a2f7a5a05163611ed3c51e42aec4fc501f00a55c670e27146d730cf439a94d8e";
const files = new Set([
  "packages/shared/catalog/game_catalog.ts",
  "packages/venue-adapter/ray/a8Collect.ts",
]);

export function restoreGameCatalogCentralization(file, source, readSource, replaceExact) {
  if (!files.has(file))
    return source;
  const normal = text => text.replaceAll("\r\n", "\n");
  const sha = text => createHash("sha256").update(normal(text)).digest("hex");
  const text = readSource(gameCatalogContract);
  assert.equal(sha(text), contractSha256, "exact reviewed game catalog migration contract");
  const contract = JSON.parse(text);
  assert.equal(contract.previousCommit, "84364793171244eca85378ef7bce3388f147b237");
  for (const [path, hash] of Object.entries(contract.hashes))
    assert.equal(sha(readSource(path)), hash, `${path}: complete reviewed configuration migration`);
  for (const change of [...contract.files[file]].reverse())
    source = replaceExact(source, change.after, change.before);
  return source;
}
