import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const manifest = "server/backend/package.json";
const sha = source => createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");
const beforeSha = "b2b6be5392bdb30c7732342f2f4c48b446d7fae9aa643c1bfc7c542fc574a8aa";
const afterSha = "0dc562e5f9492bf478f08d8c7a4c85aeef64e783c3ccfd301eb3c0589e1285ac";

/** [changmen 扩展] 只还原九个维护命令的路径修复，完整历史基线保持不变。 */
export function restoreBackendCommandPaths(file, source) {
  if (file !== manifest || sha(source) !== afterSha) return source;
  const current = "node ../../rds/maintenance/";
  assert.equal(source.split(current).length - 1, 9, "Expected nine RDS maintenance command repairs");
  const restored = source.replaceAll(current, "node ../db/maintenance/");
  assert.equal(sha(restored), beforeSha, "Backend command repair must restore the original workspace proof");
  return restored;
}

/** Check literal `node <file>` entries without importing or executing maintenance code. */
export function inspectBackendCommandPaths(root, {
  read = file => fs.readFileSync(path.join(root, file), "utf8"),
  isFile = file => fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile() === true,
} = {}) {
  const { scripts } = JSON.parse(read(manifest));
  const entries = [];
  const missing = [];
  for (const [name, command] of Object.entries(scripts)) {
    // npm forwarding and flag-led test invocations are outside this literal-entry check.
    const nodeEntry = /(?:^|&&|\|\||;)\s*node\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
    for (const match of command.matchAll(nodeEntry)) {
      const entry = match[1] ?? match[2] ?? match[3];
      if (entry.startsWith("-")) continue;
      const target = path.relative(root, path.resolve(root, path.dirname(manifest), entry)).replaceAll("\\", "/");
      entries.push({ name, entry, target });
      if (!isFile(target)) missing.push(`${manifest}#${name}: missing Node entry ${entry} (${target})`);
    }
  }
  assert.equal(missing.length, 0, missing.join("\n"));
  return { commands: entries.length, entries };
}
