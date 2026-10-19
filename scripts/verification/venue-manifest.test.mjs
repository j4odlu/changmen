// [changmen 扩展] Generation and packaging must not alter runtime selection rules.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { inspectVenueManifestCopies, VENUE_MANIFEST_SOURCE as source, VENUE_MANIFEST_COPIES as copies } from "../sync/venue-manifest.mjs";
import { VENUE_MANIFEST_METADATA as record, restoreVenueManifestMetadata } from "./venue-manifest-metadata.mjs";
import { syncPlatformAdapterBackendBundle } from "../../packages/venue-adapter/scripts/sync-backend-bundle.mjs";

const scratch = [];
const sample = [{ id: "OB", dir: "ob", label: "fixture", collect: false, bet: false, collectionMode: "fixture_mode" }];
const bytes = Buffer.from(JSON.stringify(sample, null, 2) + "\r\n");
const write = (root, file, content) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
function temporary() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-venue-manifest-")); scratch.push(root); return root; }
function fixture() {
  const root = temporary();
  write(root, "packages/shared/package.json", JSON.stringify({ name: "@changmen/shared", exports: { "./catalog/venue_manifest.json": "./catalog/venue_manifest.json" } }));
  write(root, source, bytes);
  for (const file of copies) write(root, file, bytes);
  return root;
}
function copyStorage(root) {
  for (const name of ["package.json", "paths.js", "changmen_root.js"])
    write(root, `node_modules/@changmen/storage/${name}`, fs.readFileSync(`server/storage/${name}`));
  write(root, "server/backend/package.json", '{"name":"@changmen/backend","type":"module"}');
}
function child(root, code, overrides = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|COMSPEC)$/i.test(key)));
  return execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: root, env: { ...env, CHANGMEN_STORAGE_DIR: path.join(root, "storage"), ...overrides }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 20000 });
}
afterEach(() => {
  for (const root of scratch.splice(0)) {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("changmen-venue-manifest-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("keeps both compatibility exports byte-identical to the single authored catalog", () => {
  expect(inspectVenueManifestCopies(process.cwd()).violations).toEqual([]);
  expect(fs.readFileSync(source).equals(fs.readFileSync(copies[0]))).toBe(true);
  expect(fs.readFileSync(source).equals(fs.readFileSync(copies[1]))).toBe(true);
});
it("detects stale and missing copies without repairing them during a check", () => {
  const root = fixture();
  write(root, copies[0], "[]"); fs.unlinkSync(path.join(root, copies[1]));
  expect(inspectVenueManifestCopies(root).violations.map(row => row.file)).toEqual(copies);
  expect(fs.readFileSync(path.join(root, copies[0]), "utf8")).toBe("[]");
  expect(fs.existsSync(path.join(root, copies[1]))).toBe(false);
});
it("propagates an authored change in one command and preserves exact bytes and order", () => {
  const root = fixture(), updated = Buffer.from(JSON.stringify([...sample, { id: "OTHER", dir: "other", bet: true }]) + "\n");
  write(root, source, updated);
  expect(inspectVenueManifestCopies(root, { write: true }).changed).toEqual(copies);
  for (const file of copies) expect(fs.readFileSync(path.join(root, file)).equals(updated)).toBe(true);
  expect(inspectVenueManifestCopies(root, { write: true }).changed).toEqual([]);
  expect(inspectVenueManifestCopies(root).violations).toEqual([]);
});
it.each(["missing", "invalid", "object", "wrong-export"])("fails before copying when the authored input is %s", mode => {
  const root = fixture();
  if (mode === "missing") fs.unlinkSync(path.join(root, source));
  if (mode === "invalid") write(root, source, "{");
  if (mode === "object") write(root, source, "{}");
  if (mode === "wrong-export") write(root, "packages/shared/package.json", '{"exports":{}}');
  expect(() => inspectVenueManifestCopies(root, { write: true })).toThrow();
  for (const file of copies) expect(fs.readFileSync(path.join(root, file)).equals(bytes)).toBe(true);
});
it("validates all destinations before writing and rejects an escaping directory link", () => {
  const root = fixture(), outside = temporary();
  const directory = path.dirname(path.join(root, copies[1]));
  fs.unlinkSync(path.join(root, copies[1])); fs.rmdirSync(directory);
  fs.symlinkSync(outside, directory, "junction");
  write(root, source, "[]");
  expect(() => inspectVenueManifestCopies(root, { write: true })).toThrow("escapes workspace");
  expect(fs.readFileSync(path.join(root, copies[0])).equals(bytes)).toBe(true);
  expect(fs.readdirSync(outside)).toEqual([]);
});
it("restores only the exact reviewed metadata changes to the full previous source", () => {
  for (const row of record.changes) {
    const current = fs.readFileSync(row.file, "utf8");
    const baseline = execFileSync("git", ["show", `${record.baseline}:${row.file}`], { encoding: "utf8", windowsHide: true }).replaceAll("\r\n", "\n");
    expect(restoreVenueManifestMetadata(row.file, current)).toBe(baseline);
    expect(restoreVenueManifestMetadata(row.file, current + "\n")).not.toBe(baseline);
  }
});
it("default packaging reads the authored asset even when the compatibility copy is stale or missing", () => {
  const root = fixture(); copyStorage(root);
  const module = "packages/venue-adapter/scripts/sync-backend-bundle.mjs";
  write(root, module, fs.readFileSync(module));
  write(root, "packages/venue-adapter/scripts/package.json", '{"type":"module"}');
  fs.symlinkSync(path.join(root, "packages/shared"), path.join(root, "node_modules/@changmen/shared"), "junction");
  write(root, copies[0], "[]");
  const run = () => child(root, `const {syncPlatformAdapterBackendBundle}=await import(${JSON.stringify(pathToFileURL(path.join(root, module)).href)});syncPlatformAdapterBackendBundle();`);
  run();
  const packed = path.join(root, "server/backend/platform_adapter/registry/manifest.json");
  expect(fs.readFileSync(packed).equals(bytes)).toBe(true);
  fs.unlinkSync(path.join(root, copies[0])); run();
  expect(fs.readFileSync(packed).equals(bytes)).toBe(true);
  // A missing canonical asset must fail before replacing a previously valid artifact.
  fs.unlinkSync(path.join(root, source));
  expect(run).toThrow();
  expect(fs.readFileSync(packed).equals(bytes)).toBe(true);
});
it("explicit external packaging preserves its own manifest without requiring a shared catalog", () => {
  const root = temporary(), src = path.join(root, "external"), dst = path.join(root, "bundle");
  write(src, "registry/manifest.json", bytes);
  syncPlatformAdapterBackendBundle({ src, dst });
  expect(fs.readFileSync(path.join(dst, "registry/manifest.json")).equals(bytes)).toBe(true);
});
it.each(["CHANGMEN_ADAPTER_ROOT", "GAMEBET_ADAPTER_ROOT"])("%s uses the external catalog after preload and cache reset", key => {
  const root = temporary(); copyStorage(root);
  const adapter = syncPlatformAdapterBackendBundle({ dst: path.join(root, "external") });
  const external = [{ ...sample[0], dir: "custom-ob", label: "EXTERNAL ONLY", collectionMode: "vps_http_ws" }];
  write(adapter, "registry/manifest.json", JSON.stringify(external));
  write(root, "server/backend/platform_node/ob/session.js", "// root validation marker");
  write(root, "server/backend/platform_node/custom-ob/package.json", '{"type":"module"}');
  write(root, "server/backend/platform_node/custom-ob/session.js", "export const origin='external';");
  const result = child(root, `
    import assert from 'node:assert/strict';import net from 'node:net';
    net.Socket.prototype.connect=()=>{throw Error('network forbidden')};
    const api=await import(${JSON.stringify(pathToFileURL(path.join(adapter, "loader/adapter_paths.mjs")).href)});
    const inspect=()=>{assert.equal(api.getAdapterRoot(),${JSON.stringify(adapter)});
      const feeds=api.adapterRequire('registry','feeds.js');assert.equal(feeds.getPlatform('ob').label,'EXTERNAL ONLY');
      assert.equal(feeds.isVpsOwnedPlatformCollect('OB'),true);assert.equal(feeds.listPlatforms().length,1);
      assert.equal(api.requirePlatform('OB','backend','session.js').origin,'external');};
    inspect();api.resetAdapterRootForTests();await api.initAdapterRegistry();await api.initEsmPlatformBackends();inspect();
    console.log('external catalog retained');
  `, { [key]: adapter, CHANGMEN_PLATFORM_PROBES_ROOT: path.join(root, "server/backend/platform_node") });
  expect(result).toContain("external catalog retained");
});
