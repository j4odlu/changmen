import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { installHooks } from "../git-hooks/install.mjs";
import { needsFrontendTypecheck } from "../git-hooks/pre-commit.mjs";

it("checks frontend, shared, build tools, manifests and deleted/moved input paths", () => {
  for (const file of ["client/web/src/Main.vue", "client/packages/book/index.ts", "packages/shared/types.ts",
    "packages/venue-adapter/registry/adapters.ts", "devtools/runtime-tooling/runtime_version.js", "package-lock.json"])
    expect(needsFrontendTypecheck([file])).toBe(true);
  for (const file of ["docs/TEAM_BOUNDARIES.md", "client/web/docs/A8.json", "server/backend/server.js"])
    expect(needsFrontendTypecheck([file])).toBe(false);
});

it("a real Git commit is blocked by failed typecheck, accepts docs, and works from a subdirectory", () => {
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "changmen-hook-test-"));
  const git = args => execFileSync("git", args, { cwd: temporary, encoding: "utf8", windowsHide: true });
  try {
    git(["init", "-q"]); git(["config", "user.name", "Hook Test"]); git(["config", "user.email", "hook-test@example.invalid"]);
    const hookDir = path.join(temporary, "scripts/git-hooks"); fs.mkdirSync(hookDir, { recursive: true });
    for (const file of ["pre-commit", "pre-commit.mjs"])
      fs.copyFileSync(new URL(`../git-hooks/${file}`, import.meta.url), path.join(hookDir, file));
    fs.writeFileSync(path.join(temporary, "package.json"), JSON.stringify({ name: "changmen", scripts: { "typecheck:frontend": 'node -e "process.exit(7)"' } }));
    git(["add", "."]); git(["-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"]);
    expect(installHooks(hookDir)).toMatchObject({ hooksPath: "scripts/git-hooks", globalSettingsChanged: false });
    fs.mkdirSync(path.join(temporary, "client/web/src"), { recursive: true });
    fs.writeFileSync(path.join(temporary, "client/web/src/test.ts"), "export const value = 1;\n");
    git(["add", "client"]);
    const blocked = spawnSync("git", ["commit", "-m", "must fail"], { cwd: hookDir, encoding: "utf8", windowsHide: true, timeout: 30000 });
    expect(blocked.status).not.toBe(0); expect(blocked.stdout + blocked.stderr).toContain("[pre-commit] Frontend inputs changed");
    git(["reset", "--quiet"]);
    fs.writeFileSync(path.join(temporary, "README.md"), "docs\n"); git(["add", "README.md"]);
    git(["commit", "-qm", "documentation bypasses unrelated typecheck"]);
    fs.writeFileSync(path.join(temporary, "package.json"), JSON.stringify({ name: "changmen", scripts: { "typecheck:frontend": 'node -e "process.exit(0)"' } }));
    git(["add", "package.json", "client"]); git(["commit", "-qm", "frontend passes"]);
  } finally {
    expect(path.dirname(path.resolve(temporary))).toBe(fs.realpathSync(os.tmpdir()));
    expect(path.basename(temporary)).toMatch(/^changmen-hook-test-/);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}, 60000);
