// Enforce the unchanged freeze list at both original and relocated paths.
// Relocation inventories are path metadata only; never execute historical audits.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function validateFreezeManifest(text) {
  const sha = createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
  if (sha !== "f0b521cba45430c9e6d4842abe29c1fd560df6209d4efe1ade4a833dba278ddb") throw Error("Original freeze manifest must remain unchanged");
  return JSON.parse(text);
}
export function changedFreezeFiles(git, base) {
  return [...new Set([
    git(["diff", "--no-renames", "--name-only", "-z", `${base}...HEAD`], { trim: false }),
    git(["diff", "--no-renames", "--name-only", "-z", base], { trim: false }),
    git(["ls-files", "--others", "--exclude-standard", "-z"], { trim: false }),
    git(["diff", "--no-renames", "--name-only", "--cached", "-z"], { trim: false }),
  ].flatMap(output => output.split("\0").filter(Boolean)))];
}
export function validationFreezeFiles(changed, { root, env = process.env, read = file => fs.readFileSync(file, "utf8") }) {
  if (!env.CHANGMEN_VALIDATION_PATHS_FILE) return changed;
  const selected = JSON.parse(read(env.CHANGMEN_VALIDATION_PATHS_FILE));
  if (!env.CHANGMEN_ACCEPTANCE_INVOCATION || selected.invocationId !== env.CHANGMEN_ACCEPTANCE_INVOCATION
    || selected.root !== fs.realpathSync(root) || !Array.isArray(selected.paths)
    || selected.paths.some(file => typeof file !== "string" || !file || path.isAbsolute(file) || /^[a-z]:/i.test(file)
      || file.includes("\\") || file.includes("\0") || file.split("/").includes(".."))) throw Error("Changed-path evidence does not belong to this validation");
  return [...new Set([...changed, ...selected.paths])];
}

export function currentFreezePaths(root, original) {
  const edges = new Map();
  const add = (from, to) => {
    if (!from || !to || from === to) return;
    if ([from, to].some(file => path.posix.isAbsolute(file) || file.split("/").includes(".."))) throw Error("Invalid frozen path relocation");
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from).add(to);
  };
  for (const name of ["adapter-browser-relocation", "client-package-relocation", "node-package-relocation", "workspace-layout-relocation"]) {
    const record = JSON.parse(fs.readFileSync(path.join(root, "scripts/verification/" + name + ".json"), "utf8"));
    for (const row of record.records ?? record.rows ?? record.files ?? record.relocations ?? []) {
      add(row.file, row.canonical);
      for (const match of (row.wrapper ?? "").matchAll(/export\s+\*\s+from\s+["'](\.[^"']+)["']/g)) {
        let target = path.posix.normalize(path.posix.join(path.posix.dirname(row.file), match[1]));
        if (!/\.[cm]?[jt]s$/.test(target)) target += ".ts";
        add(row.file, target);
      }
    }
  }
  // Later venue groups moved implementations out of adapter/ while retaining
  // forwarding entries. Protect both owners, including the FOK/functional target
  // reached through the recorded old forwarding entry.
  for (const [file, targets] of [...edges]) for (const candidate of [file, ...targets])
    if (candidate.startsWith("packages/venue-adapter/")) add(candidate, candidate.replace("packages/venue-adapter/", "client/packages/venue-browser/"));
  const frozen = new Set([...original, "packages/venue-adapter/polymarket/fok",
    "client/packages/venue-browser/polymarket/fok", "client/packages/venue-browser/adapter/polymarket/fok"]);
  for (const file of frozen) for (const target of edges.get(file) ?? []) frozen.add(target);
  return [...frozen];
}
export function currentFrozenChanges(changed, paths) {
  return changed.filter(file => !/\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(file)
    && paths.some(frozen => file === frozen || file.startsWith(frozen + "/")));
}
