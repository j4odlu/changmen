// [changmen 扩展] Compatibility copy generation is tested only in disposable fixtures.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { inspectRdsAssetCopies } from "./rds-assets.mjs";
import { listRdsMigrationNames, readRdsMigrationSql, readRdsSchemaBaseline } from "../../server/db/maintenance/assets.mjs";

const checksum = text => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-rds-assets-"));
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); };
  const sql = "BEGIN;\nSELECT 1;\nCOMMIT;\n", baseline = JSON.stringify({ migrations: { "001_fixture.sql": checksum(sql) } });
  write("server/db/assets/schema-baseline.json", baseline); write("server/db/assets/migrations/001_fixture.sql", sql);
  write("scripts/verification/retained-source-boundaries.json", JSON.stringify({ groups: [{ id: "rds-assets", baselineSha256: checksum(baseline) }] }));
  try { run({ root, write, baseline, sql }); }
  finally { if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("changmen-rds-assets-")) fs.rmSync(root, { recursive: true, force: true }); }
}
it("reads the same historical manifest and all SQL from the data package", () => {
  const baseline = readRdsSchemaBaseline();
  expect(listRdsMigrationNames()).toEqual(Object.keys(baseline.migrations).sort());
  expect(listRdsMigrationNames()).toHaveLength(43);
  for (const [name, expected] of Object.entries(baseline.migrations)) expect(checksum(readRdsMigrationSql(name))).toBe(expected);
  const report = inspectRdsAssetCopies(fileURLToPath(new URL("../../", import.meta.url)));
  expect(report.pairs).toHaveLength(44); expect(report.violations).toEqual([]);
});
for (const name of ["../001_fixture.sql", "/001_fixture.sql", "001_fixture.sql?other", "001_fixture.sql#other", "file:001_fixture.sql", "001_fixture.sql/other"])
  it(`rejects non-filename asset requests: ${name}`, () => expect(() => readRdsMigrationSql(name)).toThrow("Invalid RDS migration asset name"));
it("checks without writes and generates missing compatibility copies only explicitly", () => fixture(({ root, sql }) => {
  expect(inspectRdsAssetCopies(root).violations).toHaveLength(2);
  expect(fs.existsSync(path.join(root, "server/backend"))).toBe(false);
  expect(inspectRdsAssetCopies(root, { write: true }).changed).toHaveLength(2);
  expect(inspectRdsAssetCopies(root).violations).toEqual([]);
  expect(fs.readFileSync(path.join(root, "server/backend/db/migrations/001_fixture.sql"), "utf8")).toBe(sql);
  expect(inspectRdsAssetCopies(root, { write: true }).changed).toEqual([]);
}));
it("rejects byte drift even when the SQL checksum normalizes line endings", () => fixture(({ root, write, sql }) => {
  inspectRdsAssetCopies(root, { write: true });
  write("server/backend/db/migrations/001_fixture.sql", sql.replaceAll("\n", "\r\n"));
  expect(inspectRdsAssetCopies(root).violations).toHaveLength(1);
  expect(inspectRdsAssetCopies(root, { write: true }).changed).toHaveLength(1);
}));
it("refuses invalid canonical SQL before writing any old asset", () => fixture(({ root, write }) => {
  write("server/db/assets/migrations/001_fixture.sql", "SELECT changed;");
  expect(() => inspectRdsAssetCopies(root, { write: true })).toThrow("checksum changed");
  expect(fs.existsSync(path.join(root, "server/backend"))).toBe(false);
}));
it("refuses unlisted canonical SQL instead of silently omitting it", () => fixture(({ root, write }) => {
  write("server/db/assets/migrations/002_unreviewed.sql", "SELECT 1;");
  expect(() => inspectRdsAssetCopies(root)).toThrow("cover every SQL file");
}));
it("never uses an old copy as fallback for a missing canonical file", () => fixture(({ root }) => {
  inspectRdsAssetCopies(root, { write: true });
  fs.unlinkSync(path.join(root, "server/db/assets/migrations/001_fixture.sql"));
  expect(() => inspectRdsAssetCopies(root)).toThrow("cover every SQL file");
}));
