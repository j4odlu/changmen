import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expandedRequirements, readReference, reference } from "../testing/schema-compatibility/reference.mjs";
import { readSchemaBaseline, schemaDifferences } from "../../server/backend/scripts/rds-schema-check.mjs";
import { RDS_MIGRATIONS } from "../../server/backend/scripts/apply-rds-schema.mjs";

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
  });
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
    ["Exercise isolated upgrade and code rollback", "postgres.log", 0],
    ["Exercise isolated upgrade and code rollback", "postgres.log", 23],
    ["Exercise canonical reconciliation and publication preflight", "history.log", 0],
    ["Exercise canonical reconciliation and publication preflight", "history.log", 23],
  ])("CI %s retains %s and propagates exit %s", (step, logFile, exitCode) => {
    const workflow = readFileSync(path.join(root, ".github/workflows/database-compatibility.yml"), "utf8");
    const block = workflow.match(new RegExp(`      - name: ${step}\\r?\\n([\\s\\S]*?)(?=      - |$)`))?.[1];
    expect(block).toBeDefined();
    const script = block.split(/        run: \|\r?\n/)[1].split(/\r?\n/).map(line => line.replace(/^          /, "")).join("\n");
    const tempRoot = path.resolve(os.tmpdir());
    const directory = mkdtempSync(path.join(tempRoot, "changmen-schema-ci-"));
    try {
      const bash = process.platform === "win32" ? "C:/msys64/usr/bin/bash.exe" : "bash";
      const result = spawnSync(bash, ["--noprofile", "--norc", "-e", "-c",
        `mkdir -p output/schema-compatibility; npm() { printf 'synthetic test output\\n'; return ${exitCode}; };\n${script}`],
      { cwd: directory, encoding: "utf8", windowsHide: true, timeout: 10_000 });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(exitCode);
      expect(readFileSync(path.join(directory, "output/schema-compatibility", logFile), "utf8")).toContain("synthetic test output");
    } finally {
      if (path.dirname(directory) !== tempRoot || !path.basename(directory).startsWith("changmen-schema-ci-")) throw Error("Unexpected test directory");
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
