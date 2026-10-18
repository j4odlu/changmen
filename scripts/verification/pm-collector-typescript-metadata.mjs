// [changmen 扩展] Reverse exact collector dependency increments before all
// historical full-lock proofs. No SDK record or fixed FOK baseline is replaced.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { restorePmSportsTypeScriptMetadata } from "./pm-sports-typescript-metadata.mjs";

const sha = source => createHash("sha256").update(source).digest("hex");
const previousHash = "2edd6a75e0f30b5b474bd2137ced4992a85ea83c06625dd84a37181742ac30b3";
const migratedHash = "d6dbb22d9e795a3e8099dc86f32d649f292031b9853167f959cf46bcbf928f1b";
const before = `    "server/collectors/polymarket-esports": {
      "name": "@changmen/polymarket-esports-collector",
      "version": "1.0.0",
      "dependencies": {
        "@changmen/db": "file:../../db",
        "@changmen/shared": "file:../../../packages/shared",
        "@changmen/storage": "file:../../storage"
      }
    },
`;

const sportsBefore = `    "server/collectors/polymarket-sports": {
      "name": "@changmen/polymarket-sports",
      "version": "1.0.0",
      "dependencies": {
        "@changmen/db": "file:../../db",
        "@changmen/storage": "file:../../storage",
        "ws": "^8.21.0"
      }
    },
`;
const sportsAfter = sportsBefore.replace('        "@changmen/db": "file:../../db",\n',
  '        "@changmen/db": "file:../../db",\n        "@changmen/shared": "file:../../../packages/shared",\n');
const after = `    "server/collectors/polymarket-esports": {
      "name": "@changmen/polymarket-esports-collector",
      "version": "1.0.0",
      "dependencies": {
        "@changmen/api-contract": "file:../../../packages/api-contract",
        "@changmen/db": "file:../../db",
        "@changmen/shared": "file:../../../packages/shared",
        "@changmen/storage": "file:../../storage"
      },
      "devDependencies": {
        "@types/node": "^25.9.1",
        "typescript": "6.0.3"
      }
    },
`;

export function restorePmCollectorTypeScriptMetadata(file, source) {
  source = restorePmSportsTypeScriptMetadata(file, source);
  if (file === "server/collectors/polymarket-sports/package.json") {
    source = source.replaceAll("\r\n", "\n");
    if (sha(source) !== "000d09d5bde7fc5660a4cc8473d709cd66a151fbc0c82017182b951d31f43d8e") return source;
    const restored = source.replace('    "@changmen/shared": "file:../../../packages/shared",\n', "");
    assert.equal(sha(restored), "59aa3b7ca94218dfccc7e731cb9a382c9bcaadfdccc54d663811037df5849e6b",
      "The complete original sports collector manifest must restore exactly");
    return restored;
  }
  if (file !== "package-lock.json") return source;
  source = source.replaceAll("\r\n", "\n");
  if (sha(source) !== migratedHash) return source;
  assert.equal(source.split(after).length, 2, "Exactly one collector record may change");
  assert.equal(source.split(sportsAfter).length, 2, "Exactly one sports collector record may change");
  const restored = source.replace(after, before).replace(sportsAfter, sportsBefore);
  assert.equal(sha(restored), previousHash, "The complete previous lock must restore exactly");
  return restored;
}
