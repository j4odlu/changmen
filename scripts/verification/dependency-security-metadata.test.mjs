import fs from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { restoreDependencySecurityMetadata } from "./dependency-security-metadata.mjs";
const base = "8db3321d04aca0924998b93fc9fd3efd89ebd8d6";
const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const record = JSON.parse(read("scripts/verification/dependency-security-metadata.json"));
const sha = source => createHash("sha256").update(source).digest("hex");
for (const row of record.changes) it(`${row.file}: exactly reverses the reviewed security update and rejects extra edits`, () => {
  const source = read(row.file), previous = gitSource(base, row.file);
  expect(sha(source)).toBe(row.migratedSha256);
  expect(restoreDependencySecurityMetadata(row.file, source)).toBe(previous);
  for (const changed of [source + "\n", source.replace("{", '{\n  "extra": true,')])
    expect(restoreDependencySecurityMetadata(row.file, changed)).not.toBe(previous);
});
it("preserves all workspace declarations, all transaction SDK records and every historical proof", () => {
  const old = JSON.parse(gitSource(base, "package-lock.json")), current = JSON.parse(read("package-lock.json"));
  const allowed = new Set(["@babel/parser", "@babel/types", "axios", "body-parser", "engine.io", "esbuild", "form-data",
    "ip-address", "nanoid", "postcss", "proxy-addr", "proxy-from-env", "qs", "socket.io-parser", "source-map-js", "uuid", "vue", "ws"]);
  for (const file of new Set([...Object.keys(old.packages), ...Object.keys(current.packages)])) {
    if (JSON.stringify(old.packages[file]) === JSON.stringify(current.packages[file])) continue;
    const name = file.split("node_modules/").at(-1);
    expect(name.startsWith("@vue/") || name.startsWith("@esbuild/") || allowed.has(name), file).toBe(true);
    expect(file, "Workspace manifests and transaction SDK records cannot change").toContain("node_modules/");
  }
  const pkg = JSON.parse(read("package.json")), previous = JSON.parse(gitSource(base, "package.json"));
  expect(pkg.overrides).toEqual({ "@polymarket/builder-relayer-client": { axios: "0.34.0" },
    "axios@>=1 <1.20.0": "1.20.0", qs: "6.16.1", ws: "8.21.0", "uuid@<11.1.1": "11.1.1" });
  expect(pkg.scripts["hooks:install"]).toBe("node scripts/git-hooks/install.mjs");
  delete pkg.overrides; delete pkg.scripts["hooks:install"]; expect(pkg).toEqual(previous);
  for (const file of ["vps-fok-baseline.json", "runtime-tooling-migration.json", "pm-source-isolation-metadata.json",
    "pm-client-folder-metadata.json", "frontend-build-inputs.json", "runtime-source-coverage.json", "retained-source-boundaries.json"])
    expect(read(`scripts/verification/${file}`)).toBe(gitSource(base, `scripts/verification/${file}`));
});
