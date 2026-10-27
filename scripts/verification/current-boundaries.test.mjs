import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { inspectCurrentSourceBoundaries } from "./current-source-boundaries.mjs";
import { currentFreezePaths, currentFrozenChanges, validateFreezeManifest, changedFreezeFiles, validationFreezeFiles } from "./current-esport-freeze.mjs";

const scratch = [];
const sha = text => createHash("sha256").update(text).digest("hex");
afterEach(() => { for (const root of scratch.splice(0)) {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("changmen-current-boundary-")) throw Error("Unexpected test cleanup");
  fs.rmSync(root, { recursive: true, force: true });
} });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-current-boundary-")); scratch.push(root);
  const write = (file, value) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value)); };
  write("scripts/verification/workspace-layout-relocation.json", { files: [{ file: "old/entry.js", canonical: "rds/entry.js" }] });
  write("scripts/verification/node-entry-retirement.json", { removed: [] });
  write("scripts/verification/browser-entry-retirement.json", { retired: [] });
  write("scripts/verification/rds-entry-retirement.json", { entries: [] });
  for (const name of ["backend-probe-relocation", "rds-legacy-relocation", "rds-maintenance-relocation"])
    write("scripts/verification/" + name + ".json", { moves: [] });
  write("scripts/verification/pm-sdk-retirement.json", { files: [] });
  write("scripts/verification/pm-credential-sdk-increments.json", { retired: [{ file: "server/backend/core/integrations/polymarket/clob_l1.js" }] });
  write("scripts/verification/adapter-browser-relocation.json", { records: [] });
  write("scripts/verification/backend-db-access-exceptions.json", { sites: [] });
  const sql = "CREATE TABLE fixture(id integer);\n", baseline = JSON.stringify({ migrations: { "001_fixture.sql": sha(sql) } });
  write("rds/assets/migrations/001_fixture.sql", sql); write("rds/assets/schema-baseline.json", baseline);
  write("scripts/verification/retained-source-boundaries.json", { groups: [{ id: "rds-assets", baselineSha256: sha(baseline) }] });
  write("rds/entry.js", "export const behavior = 'current';");
  return { root, write };
}
it("current invariants accept business evolution without a historical source hash", () => {
  const f = fixture(); expect(inspectCurrentSourceBoundaries(f.root).violations).toEqual([]);
  f.write("rds/entry.js", "export const behavior = 'new implementation';");
  expect(inspectCurrentSourceBoundaries(f.root).violations).toEqual([]);
});
for (const [file, value] of [["old/entry.js", "returned"], ["server/db/new.js", "returned"],
  ["packages/shared/match-identity/teams/team_key.ts", "returned identity implementation"],
  ["packages/shared/match-identity/index.js", "returned identity facade"],
  ["server/backend/core/integrations/polymarket/clob_l1.js", "retired SDK returned"],
  ["rds/assets/migrations/001_fixture.sql", "changed SQL"], ["rds/assets/migrations/002_new.sql", "unregistered SQL"],
  ["scripts/verification/backend-db-access-exceptions.json", { sites: [{ file: "new exception" }] }]])
  it(`retains current protection for ${file}`, () => {
    const f = fixture(); f.write(file, value); expect(inspectCurrentSourceBoundaries(f.root).violations.length).toBeGreaterThan(0);
  });
it("ignored build residue at an old directory does not count as returned source", () => {
  const f = fixture(); f.write("server/db/node_modules/cache.js", "cache"); f.write("server/db/.turbo/log", "cache");
  expect(inspectCurrentSourceBoundaries(f.root).violations).toEqual([]);
});
it("freeze protection follows both the moved facade and its implementation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-current-boundary-")); scratch.push(root);
  const records = [{ file: "old/bet.ts", canonical: "current/bet.ts", wrapper: 'export * from "./fok/bet";' },
    { file: "old/fok/bet.ts", canonical: "current/fok/bet.ts" }];
  fs.mkdirSync(path.join(root, "scripts/verification"), { recursive: true });
  for (const name of ["adapter-browser-relocation", "client-package-relocation", "node-package-relocation", "workspace-layout-relocation"])
    fs.writeFileSync(path.join(root, "scripts/verification/" + name + ".json"), JSON.stringify({ records: name === "adapter-browser-relocation" ? records : [] }));
  const frozen = currentFreezePaths(root, ["old/bet.ts"]);
  expect(currentFrozenChanges(["current/fok/bet.ts", "current/bet.ts", "old/bet.ts", "current/fok/bet.test.ts", "other/bet.ts"], frozen))
    .toEqual(["current/fok/bet.ts", "current/bet.ts", "old/bet.ts"]);
});
it("keeps both sides of deletions/renames and untracked current paths without splitting filenames on newlines", () => {
  const git = (args, options) => {
    expect(args).toContain("-z"); expect(options.trim).toBe(false);
    if (args[0] === "diff") { expect(args).toContain("--no-renames"); return "old/frozen.ts\0new/name.ts\0"; }
    return "client/packages/new\nname.ts\0";
  };
  expect(changedFreezeFiles(git, "base")).toEqual(["old/frozen.ts", "new/name.ts", "client/packages/new\nname.ts"]);
  expect(() => changedFreezeFiles(() => { throw Error("invalid base"); }, "missing")).toThrow("invalid base");
});
it("a committed frozen change remains visible when the checkout's merge-base is already HEAD", () => {
  const f = fixture(), selected = { invocationId: "current-invocation", root: fs.realpathSync(f.root), paths: ["client/packages/venue-browser/polymarket/fok/bet.ts"] };
  const env = { CHANGMEN_VALIDATION_PATHS_FILE: "evidence", CHANGMEN_ACCEPTANCE_INVOCATION: "current-invocation" };
  const run = data => validationFreezeFiles([], { root: f.root, env, read: () => JSON.stringify(data) });
  expect(currentFrozenChanges(run(selected), ["client/packages/venue-browser/polymarket/fok"])).toEqual(selected.paths);
  for (const changed of [{ ...selected, invocationId: "old" }, { ...selected, root: "another checkout" },
    { ...selected, paths: ["../outside"] }]) expect(() => run(changed)).toThrow("does not belong");
});
it("does not permit replacing or emptying the original freeze policy", () => {
  const source = fs.readFileSync("packages/venue-adapter/esport-freeze.json", "utf8");
  expect(validateFreezeManifest(source).paths.length).toBeGreaterThan(0);
  expect(() => validateFreezeManifest('{"paths":[]}')).toThrow("Original freeze manifest");
});
it("the original freeze policy still covers current FOK implementations and their old forwarding entries", () => {
  const paths = currentFreezePaths(process.cwd(), validateFreezeManifest(fs.readFileSync("packages/venue-adapter/esport-freeze.json", "utf8")).paths);
  for (const file of ["client/packages/venue-browser/polymarket/fok/bet.ts", "client/packages/venue-browser/adapter/polymarket/fok/bet.ts",
    "client/packages/venue-browser/polymarket/auth/l2Auth.ts", "client/packages/client-core/src/bridge/oddsAccess.ts"])
    expect(currentFrozenChanges([file], paths), file).toEqual([file]);
});
it("facades retain their canonical target while that implementation evolves", () => {
  const f = fixture();
  f.write("scripts/verification/adapter-browser-relocation.json", { records: [{ file: "old/api.ts", canonical: "client/packages/venue-browser/adapter/api.ts" }] });
  f.write("scripts/verification/venue-browser-example.json", { rows: [{ file: "old/api.ts", canonical: "client/packages/venue-browser/api.ts" }] });
  f.write("client/packages/venue-browser/adapter/api.ts", 'export * from "@changmen/venue-browser/api";');
  f.write("client/packages/venue-browser/api.ts", "export const current = 1;");
  expect(inspectCurrentSourceBoundaries(f.root).violations).toEqual([]);
  f.write("client/packages/venue-browser/api.ts", "export const current = 2;");
  expect(inspectCurrentSourceBoundaries(f.root).violations).toEqual([]);
  f.write("client/packages/venue-browser/adapter/api.ts", "export const duplicate = 1;");
  expect(inspectCurrentSourceBoundaries(f.root).violations.some(row => row.file.endsWith("adapter/api.ts"))).toBe(true);
});
