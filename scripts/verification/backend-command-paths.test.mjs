import fs from "node:fs";
import { expect, it } from "vitest";
import { inspectBackendCommandPaths, restoreBackendCommandPaths } from "./backend-command-paths.mjs";
import { WORKSPACE_LAYOUT_RELOCATION, restoreWorkspaceLayoutSource, historicalWorkspaceFs } from "./workspace-layout-history.mjs";

const manifest = "server/backend/package.json";
const source = fs.readFileSync(manifest, "utf8");
const original = WORKSPACE_LAYOUT_RELOCATION.files.find(row => row.file === manifest);
const readScripts = scripts => () => JSON.stringify({ scripts });

it("resolves backend Node commands from the package directory, preserving initialization arguments", () => {
  const { entries } = inspectBackendCommandPaths(process.cwd());
  expect(entries.find(row => row.name === "check:rds-schema")?.target).toBe("rds/maintenance/check-rds-schema.mjs");
  expect(entries.find(row => row.name === "db:initialize")?.target).toBe("rds/maintenance/apply-rds-schema.mjs");
  expect(JSON.parse(source).scripts["db:initialize"]).toBe("node ../../rds/maintenance/apply-rds-schema.mjs --initialize");
  expect(entries.filter(row => row.target.startsWith("rds/maintenance/"))).toHaveLength(9);
});

it("rejects all nine pre-migration commands against the actual filesystem", () => {
  const regressed = source.replaceAll("node ../../rds/maintenance/", "node ../db/maintenance/");
  expect(() => inspectBackendCommandPaths(process.cwd(), { read: () => regressed })).toThrow(/9 !== 0/);
  expect(() => inspectBackendCommandPaths(process.cwd(), { read: () => regressed })).toThrow(/#check:rds-schema: missing Node entry/);
});

it("rejects a missing script or a directory used as an entry", () => {
  for (const entry of ["missing-maintenance.mjs", "../../rds/maintenance"]) {
    expect(() => inspectBackendCommandPaths(process.cwd(), {
      read: readScripts({ repair: `node ${entry} --dry-run` }),
    })).toThrow(/#repair: missing Node entry/);
  }
});

it("checks quoted entries and chained commands without treating their arguments as files", () => {
  const targets = [];
  const result = inspectBackendCommandPaths(process.cwd(), {
    read: readScripts({ repair: 'node "scripts/first task.mjs" --out backup.json && node \'scripts/second.mjs\' --initialize' }),
    isFile: target => { targets.push(target); return true; },
  });
  expect(result.commands).toBe(2);
  expect(targets).toEqual(["server/backend/scripts/first task.mjs", "server/backend/scripts/second.mjs"]);
});

it("restores the complete original package proof, including CRLF checkouts", () => {
  for (const current of [source, source.replace(/\r?\n/g, "\r\n")]) {
    expect(restoreBackendCommandPaths(manifest, current).replaceAll("\r\n", "\n"))
      .toBe(source.replaceAll("\r\n", "\n").replaceAll("node ../../rds/maintenance/", "node ../db/maintenance/"));
    expect(restoreWorkspaceLayoutSource(manifest, current)).toBe(original.before);
  }
  expect(historicalWorkspaceFs.readFileSync(manifest, "utf8")).toBe(original.before);
});

it("does not hide other manifest changes or changes to unrelated files", () => {
  const modified = source.replace(" --initialize", " --initialize --force");
  expect(restoreBackendCommandPaths(manifest, modified)).toBe(modified);
  expect(restoreWorkspaceLayoutSource(manifest, modified)).toBe(modified);
  expect(restoreBackendCommandPaths("rds/package.json", source)).toBe(source);
});
