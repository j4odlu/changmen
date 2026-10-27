import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test as it } from "node:test";
import { isVersionSource } from "../../../devtools/runtime-tooling/runtime_version.js";
import { backendArchiveIncludes } from "../../../scripts/deploy/pack-git-repo.mjs";
import { classifyDeployScope } from "../../../scripts/deploy/classify-deploy-scope.mjs";
import { declaredInstallClosure, frontendInstallBoundary, readInstallWorkspaces } from "../../../scripts/verification/component-install-inputs.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

it("boots all public entry points in native Node with one injected plugin and no retired shared exports", () => {
  const script = `
    import assert from "node:assert/strict";
    import * as identity from "@changmen/match-identity";
    import * as keys from "@changmen/match-identity/teams/team_key.js";
    import * as esport from "@changmen/match-identity/profiles/esport.js";
    import { stableBetId } from "@changmen/match-identity/teams/match_utils.js";
    import { startTimesCompatibleStrict } from "@changmen/match-identity/time_windows.js";
    import { resolveCanonicalTeamName } from "@changmen/match-identity/teams/canonical_ob_name.js";
    import { providerPriority } from "@changmen/match-identity/teams/provider_priority.js";
    import { ensureClientMatchId } from "@changmen/match-identity/ids/client_match_ids.js";
    import aliases from "@changmen/match-identity/teams/team_aliases.json" with { type: "json" };
    assert.equal(esport.setTeamPlugin, identity.setTeamPlugin);
    identity.setTeamPlugin({lookupById: (platform, id) => platform + ":" + id});
    assert.equal(keys.lookupGbTeamIdByPlatform("OB", "1"), "OB:1");
    keys.setTeamPlugin(null);
    assert.equal(identity.lookupGbTeamIdByPlatform("OB", "1"), null);
    assert.equal(stableBetId(2, 3), 8195);
    assert.equal(startTimesCompatibleStrict(0, 0), false);
    assert.equal(resolveCanonicalTeamName("OB name", "name"), "OB name");
    assert.equal(providerPriority("OB"), 10);
    assert.equal(await ensureClientMatchId({findClientMatchIdByMergeKey: async()=>3}, "key"), 3);
    assert.equal(typeof aliases, "object");
    await assert.rejects(import("@changmen/shared/match-identity"), {code:"ERR_PACKAGE_PATH_NOT_EXPORTED"});
    await assert.rejects(import("@changmen/shared/match-identity/teams/team_key.js"), {code:"ERR_PACKAGE_PATH_NOT_EXPORTED"});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

it("ships and fingerprints domain source and aliases only with the backend", () => {
  for (const name of ["index.ts", "types.ts", "teams/team_key.ts", "teams/team_aliases.json", "package.json"]) {
    const file = "packages/match-identity/" + name;
    assert.equal(backendArchiveIncludes(file), true, file);
    assert.equal(isVersionSource(file, "backend"), true, file);
    assert.equal(isVersionSource(file, "frontend"), false, file);
    assert.equal(classifyDeployScope([file]), "backend", file);
  }
  assert.equal(fs.existsSync(new URL("../../shared/match-identity/index.js", import.meta.url)), false);
});

it("keeps frontend installation free of identity, including accidental indirect dependencies", () => {
  const packages = readInstallWorkspaces(root);
  assert(!declaredInstallClosure(root, packages, "@changmen/web", {build:true}).workspaces.includes("@changmen/match-identity"));
  assert(declaredInstallClosure(root, packages, "@changmen/db").workspaces.includes("@changmen/match-identity"));
  packages.get("@changmen/shared").pkg.dependencies = { "@changmen/match-identity": "file:../match-identity" };
  const broken = declaredInstallClosure(root, packages, "@changmen/web", {build:true});
  assert(frontendInstallBoundary(broken).some(row => row.spec === "@changmen/match-identity"));
});
