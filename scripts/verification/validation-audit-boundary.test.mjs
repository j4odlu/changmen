import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { VALIDATION_AUDIT_BOUNDARY, restoreValidationAuditSource } from "./validation-audit-boundary.mjs";
import { WORKSPACE_LAYOUT_RELOCATION, readPreviousWorkspaceFile } from "./workspace-layout-history.mjs";
import { restoreDeployCiSource } from "./deploy-ci-boundary.mjs";

for (const row of VALIDATION_AUDIT_BOUNDARY.files) {
  test(`${row.file}: historical tooling uses the existing baseline while live CI evolves`, () => {
    const source = fs.readFileSync(row.file, "utf8");
    const before = execFileSync("git", ["show", `ea73dc5d:${row.file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
    const migration = WORKSPACE_LAYOUT_RELOCATION.files.find(item => item.canonical === row.file);
    expect(row.before).toBe(before);
    expect(row.beforeSha).toBe(migration.afterSha);
    expect(restoreValidationAuditSource(row.file, source)).toBe(before);
    expect(restoreValidationAuditSource(row.file, source.replace(/\r?\n/g, "\r\n"))).toBe(before);
    expect(restoreDeployCiSource(row.file, source)).toBe(before);
    expect(readPreviousWorkspaceFile(row.file, "utf8")).toBe(migration.before);
    expect(restoreValidationAuditSource(row.file, before)).toBe(before);
    // This reader makes no claim about current CI. The live runner tests failures,
    // source drift and incomplete reports directly before authorizing publication.
    for (const mutation of [source + "\nvoid skipChecks();\n", source.replace(/expect\(|assert\.equal\(|return /, "unreviewed(")]) {
      expect(mutation).not.toBe(source);
      expect(restoreValidationAuditSource(row.file, mutation)).toBe(before);
      expect(restoreDeployCiSource(row.file, mutation)).toBe(before);
    }
    expect(restoreValidationAuditSource("unrelated.mjs", source)).toBe(source);
  });
}
