import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { captureRuntimeVersion, readSourceVersion } from "./runtime_version.js";

const write = (root, file, body) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), body); };
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
function fixture(release = false) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-runtime-version-"));
  const root = release ? path.join(base, `backend-${"a".repeat(40)}-123-1`) : base;
  write(root, "server/backend/server.js", "export const value = 1;\n");
  write(root, "client/web/src/App.vue", "<template>one</template>\n");
  write(root, "packages/api-contract/package.json", '{"version":"0.1.0"}');
  write(root, "packages/api-contract/src/actions.ts", 'export const action = "one";');
  if (!release) { git(root, "init", "-q"); git(root, "add", "."); commit(root); }
  return root;
}
function commit(root) { git(root, "-c", "user.name=Version Test", "-c", "user.email=version-test@example.invalid", "commit", "-qm", "fixture"); }
describe("actual runtime source identity", () => {
  it("retains loaded identity after edits and Git commits; disk identity moves independently", () => {
    const root = fixture(), running = captureRuntimeVersion(root, "backend", { startedAt: "2026-10-14T00:00:00Z" });
    expect(running.dirty).toBe(false);
    write(root, "server/backend/server.js", "export const value = 2;\n");
    const changed = readSourceVersion(root, "backend"); expect(changed.dirty).toBe(true); expect(changed.sourceFingerprint).not.toBe(running.sourceFingerprint);
    git(root, "add", "."); commit(root);
    const current = readSourceVersion(root, "backend"); expect(current.dirty).toBe(false); expect(current.commit).not.toBe(running.commit);
    expect(running.startedAt).toBe("2026-10-14T00:00:00Z"); expect(Object.isFrozen(running)).toBe(true);
  });
  it("does not read or expose credentials, or treat documents as running code", () => {
    const root = fixture(), before = readSourceVersion(root, "backend");
    write(root, ".env", "DATABASE_URL=secret-password"); write(root, "server/backend/storage/platforms.json", '{"token":"secret-token"}');
    write(root, "docs/notes.md", "notes");
    expect(readSourceVersion(root, "backend")).toEqual(before); expect(JSON.stringify(before)).not.toContain(root);
  });
  it("detects untracked and deleted runtime code, while keeping frontend-only edits out of backend identity", () => {
    const root = fixture(), before = readSourceVersion(root, "backend");
    write(root, "client/web/src/App.vue", "<template>two</template>");
    expect(readSourceVersion(root, "backend")).toEqual(before);
    write(root, "server/backend/new.js", "export const changed = true;"); expect(readSourceVersion(root, "backend").dirty).toBe(true);
    fs.unlinkSync(path.join(root, "server/backend/new.js")); fs.unlinkSync(path.join(root, "server/backend/server.js"));
    expect(readSourceVersion(root, "backend").dirty).toBe(true);
  });
  it("normalizes EOL and shares the same contract identity across independent frontend/backend releases", () => {
    const root = fixture(), before = readSourceVersion(root, "backend");
    write(root, "server/backend/server.js", "export const value = 1;\r\n"); expect(readSourceVersion(root, "backend")).toEqual(before);
    expect(readSourceVersion(root, "frontend").contractFingerprint).toBe(before.contractFingerprint);
    write(root, "packages/api-contract/src/actions.ts", 'export const action = "two";');
    expect(readSourceVersion(root, "backend").contractFingerprint).not.toBe(before.contractFingerprint);
  });
  it("recognizes the immutable release directory without a .git checkout", () => {
    const root = fixture(true), actual = captureRuntimeVersion(root, "backend");
    expect(actual.commit).toBe("a".repeat(40)); expect(actual.provenance).toBe("release-directory"); expect(actual.dirty).toBeNull();
    expect(actual.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it("a checkout and pristine release have identical source identity, including binary assets and generated router exclusion", () => {
    const root = fixture(); write(root, ".gitignore", "server/backend/core/esport-api/router.js\n");
    write(root, "client/web/src/style.css", "body { color: red; }\n"); write(root, "client/web/src/icon.png", Buffer.from([0xff, 0x01]));
    write(root, "client/web/public/logo.png", Buffer.from([0xff, 0x02]));
    git(root, "add", "."); commit(root);
    const head = git(root, "rev-parse", "HEAD"), release = path.join(root, `backend-${head}-1-1`);
    for (const file of git(root, "ls-files", "-z").split("\0").filter(Boolean)) write(release, file, fs.readFileSync(path.join(root, file)));
    for (const name of ["router", "account_client_routes", "action_registry", "admin_routes", "pm_pf_routes"]) {
      write(root, `server/backend/core/esport-api/${name}.js`, "compiled source");
      write(release, `server/backend/core/esport-api/${name}.js`, "compiled source");
    }
    const beforeHeartbeat = readSourceVersion(release, "backend");
    write(release, "server/match/matcher/.composer-heartbeat.json", '{"timestamp":1}');
    write(release, "server/match/matcher/.matcher-heartbeat.json", '{"timestamp":2}');
    expect(readSourceVersion(release, "backend")).toEqual(beforeHeartbeat);
    for (const role of ["frontend", "backend"]) expect(readSourceVersion(release, role).sourceFingerprint).toBe(readSourceVersion(root, role).sourceFingerprint);
    const before = readSourceVersion(root, "frontend").sourceFingerprint;
    write(root, "client/web/src/icon.png", Buffer.from([0xfe, 0x01])); expect(readSourceVersion(root, "frontend").sourceFingerprint).not.toBe(before);
  });
  it("missing identity is explicitly unknown and cannot prevent app startup", () => {
    const root = path.join(os.tmpdir(), `missing-version-${Date.now()}`), actual = captureRuntimeVersion(root, "backend");
    expect(actual.commit).toBeNull(); expect(actual.sourceFingerprint).toBeNull(); expect(actual.contractFingerprint).toBeNull();
  });
});
