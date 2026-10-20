import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {historicalWorkspaceFs as __workspaceHistoryFs} from './workspace-layout-history.mjs';
const {mkdtempSync,readFileSync,rmSync,writeFileSync,writeSync}=__workspaceHistoryFs;
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expandedRequirements, readReference, reference } from "../testing/schema-compatibility/reference.mjs";
import { readSchemaBaseline, schemaDifferences } from "@changmen/db/maintenance/rds-schema-check.mjs";
import { RDS_MIGRATIONS } from "@changmen/db/maintenance/apply-rds-schema.mjs";
import { checkDatabaseCompatibility } from "../deploy/check-database-compatibility.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
describe("fixed database compatibility reference", () => {
  it("pins published round 3 independently of the candidate branch", () => {
    expect(reference.commit).toBe("9aa9159ce6b531153bd5321f89f2fcd19002671e");
    const sources = readReference(root);
    expect(Object.keys(sources)).toHaveLength(52);
    for (const file of ["server/db/rds/profile_store.js", "server/db/rds/admin_users_store.js",
      "server/db/rds/value_signals_store.js", "server/backend/scripts/rds-schema-check.mjs"])
      expect(sources[file]).toContain("export");
    // The old module graph must never fall through to candidate application modules.
    for (const [file, source] of Object.entries(sources)) {
      if (!/\.[cm]?js$/.test(file)) continue;
      for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g))
        expect(sources[path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]))], `${file}: ${match[1]}`).toBeDefined();
    }
  }, 30000);
  it("requires additive fields and indexes before a future consumer is accepted", () => {
    const baseline = readSchemaBaseline(), future = expandedRequirements(baseline);
    const differences = schemaDifferences(baseline.schema, future.schema);
    expect(differences).toContain("columns.users.round4_optional_note: missing");
    expect(differences).toContain("indexes.users.round4_users_name_idx: missing");
    expect(differences).toContain("tables.round4_schema_probe: missing");
    expect(schemaDifferences(future.schema, baseline.schema)).toEqual([]);
  });
  it("keeps production requirements and initialization manifest unchanged", () => {
    const baseline = readSchemaBaseline(), before = structuredClone(baseline);
    const future = expandedRequirements(baseline);
    expect(baseline).toEqual(before);
    expect(future.migrations).toEqual(baseline.migrations);
    expect(RDS_MIGRATIONS.some(name => /round4|fixture|expand/.test(name))).toBe(false);
    expect(Object.keys(baseline.schema.tables).some(name => name.startsWith("round4_"))).toBe(false);
  });
  it.each([
    ["schema-compatibility", 0], ["schema-compatibility", 23],
    ["history-schema", 0], ["history-schema", 23],
  ])("CI runner retains %s output and propagates failure %s", (phase, exitCode) => {
    const workflow = readFileSync(path.join(root, ".github/workflows/database-compatibility.yml"), "utf8");
    expect(workflow).toContain("run: node scripts/deploy/check-database-compatibility.mjs");
    expect(workflow).toContain("path: output/database-compatibility/");
    const tempRoot = path.resolve(os.tmpdir());
    const directory = mkdtempSync(path.join(tempRoot, "changmen-schema-ci-"));
    try {
      const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
      git("init", "-q"); writeFileSync(path.join(directory, "input.js"), "fixture"); git("add", ".");
      git("-c", "user.name=CI Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
      const result = checkDatabaseCompatibility({ cwd: directory, env: {}, run: (_node, args, options) => {
        writeSync(options.stdio[1], "synthetic test output\n");
        return { status: args[0].endsWith(`/${phase}-postgres.mjs`) ? exitCode : 0 };
      } });
      expect(result.passed).toBe(exitCode === 0);
      expect(result.results.find(row => row.phase === phase)?.exitCode).toBe(exitCode);
      expect(readFileSync(path.join(directory, "output/database-compatibility", phase + ".log"), "utf8")).toContain("synthetic test output");
    } finally {
      if (path.dirname(directory) !== tempRoot || !path.basename(directory).startsWith("changmen-schema-ci-")) throw Error("Unexpected test directory");
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
