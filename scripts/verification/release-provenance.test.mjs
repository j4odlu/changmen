import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { gzipSync } from "node:zlib";
import { assertLayout, assertStable, assertSourceHashes, assertPublicAsset, assertCaptureEvidence, sha, rawSha, runtime, sshRead } from "./release-provenance.mjs";
import { publicFiles, verifyActualPublicModule } from "./public-release-boundaries.mjs";
import { gitSource } from "./fok-exact-boundaries.mjs";
const frontend = "e901bb596952256284cd8a9eb8b73b572c963915", backend = "832f3f76c30d6ad741ce850a68cd6ba1da7d06f9";
const wire = value => 'CHANGMEN_CAPTURE_GZIP_V1:' + gzipSync(Buffer.from(JSON.stringify(value))).toString('base64') + '\n';
it("compressed transport preserves the entire decoded payload and original deadline", () => {
  const payload = { sources: { "module.ts": "中国😀\n".repeat(200000) } };
  const actual = sshRead("read only", { spawn: (command, args, options) => {
    expect(command).toBe("ssh"); expect(args).toContain("-C"); expect(options.timeout).toBe(45000);
    expect(options.input).toContain('gzipSync'); expect(options.input).toContain('read only');
    expect(Buffer.byteLength(wire(payload))).toBeLessThan(Buffer.byteLength(JSON.stringify(payload)) / 10);
    return { status: 0, stdout: wire(payload), stderr: "" };
  } });
  expect(actual).toEqual(payload);
});
it("compressed capture requires one complete gzip stream and valid complete JSON", () => {
  const valid = wire({ source: 'exact code' });
  for (const stdout of [valid.slice(0, -8), valid + 'unexpected output', '{"source":',
    'CHANGMEN_CAPTURE_GZIP_V1:' + gzipSync(Buffer.from('{"source":')).toString('base64')])
    expect(() => sshRead('read only', { spawn: () => ({ status: 0, stdout, stderr: '' }) })).toThrow();
});
it("compressed transfer cannot evade the original decoded capture size bound", () => {
  const stdout = wire({ source: 'x'.repeat(45 * 1024 * 1024) });
  expect(() => sshRead('read only', { spawn: () => ({ status: 0, stdout, stderr: '' }) })).toThrow();
});
it("timeouts and incomplete JSON still fail; a partial capture is never accepted", () => {
  expect(() => sshRead("read only", { spawn: () => ({ status: null, stdout: '{"sources":', stderr: "", error: { code: "ETIMEDOUT" } }) })).toThrow("ETIMEDOUT");
  expect(() => sshRead("read only", { spawn: () => ({ status: 0, stdout: '{"sources":', stderr: "" }) })).toThrow();
});
function layout() {
  const b = `/root/changmen/.releases/backend/backend-${backend}-123-1`;
  return { version: frontend, frontend: `/root/changmen/.releases/frontend/frontend-${frontend}-456-1`, backend: b,
    markers: { frontend: `79 ${frontend}`, backend: `40 ${backend}` },
    processes: [{ name: "changmen-esport", status: "online", pid: 123, cwd: b + "/server/backend", script: b + "/server/backend/scripts/start-db.mjs" }] };
}
describe("independent serving provenance never changes the immutable FOK baseline", () => {
  it("accepts independently deployed versions and preserves the old baseline", () => {
    expect(assertLayout(layout())).toEqual({ frontendVersion: frontend, backendVersion: backend });
    expect(JSON.parse(fs.readFileSync("scripts/verification/vps-fok-baseline.json", "utf8")).version).toBe("75b1efac66625e5f2bc9884a965b244bfaf337ed");
  });
  for (const [name, mutate] of [
    ["frontend version", row => { row.version = backend; }], ["short commit", row => { row.version = frontend.slice(0, 8); }],
    ["backend path", row => { row.backend = row.backend.replace(backend, frontend); }],
    ["wrong frontend root", row => { row.frontend = row.frontend.replace("/frontend/", "/backend/"); }],
    ["missing state", row => { delete row.markers.backend; }], ["backend state", row => { row.markers.backend = `40 ${frontend}`; }],
    ["frontend state", row => { row.markers.frontend = `79 ${backend}`; }], ["state suffix", row => { row.markers.frontend += " extra"; }],
    ["offline", row => { row.processes[0].status = "stopped"; }], ["wrong cwd", row => { row.processes[0].cwd = "/root/changmen/server/backend"; }],
    ["wrong script", row => { row.processes[0].script += ".wrong"; }], ["missing pid", row => { row.processes[0].pid = 0; }],
    ["duplicate process", row => { row.processes.push(row.processes[0]); }], ["missing process", row => { row.processes = []; }],
  ]) it(`rejects ${name}`, () => { const row = layout(); mutate(row); expect(() => assertLayout(row)).toThrow(); });
  for (const [name, mutate] of [
    ["frontend pointer", row => { row.frontend = row.frontend.replace("456-1", "457-1"); }],
    ["backend pointer", row => { row.backend = row.backend.replace("123-1", "124-1"); row.processes[0].cwd = row.backend + "/server/backend"; row.processes[0].script = row.backend + "/server/backend/scripts/start-db.mjs"; }],
    ["deploy sequence", row => { row.markers.frontend = `80 ${frontend}`; }], ["process restart", row => { row.processes[0].pid++; }],
  ]) it(`rejects valid-looking mid-check ${name} drift`, () => { const after = layout(); mutate(after); expect(() => assertStable(layout(), after)).toThrow(); });
  it("rejects missing/modified backend sources even when frontend commit matches", () => {
    const sources = { "server/backend/server.js": "original backend" };
    assertSourceHashes(sources, { "server/backend/server.js": sha("original backend") });
    for (const hashes of [{}, { "server/backend/server.js": sha("frontend archive copy") }]) expect(() => assertSourceHashes(sources, hashes)).toThrow();
  });
  it("rejects HTTP failure and mismatched public assets byte for byte", () => {
    const asset = { file: "index.html", sha256: rawSha(Buffer.from("original\r\n")) };
    assertPublicAsset(asset, 200, Buffer.from("original\r\n"));
    for (const [status, bytes] of [[404, "original\r\n"], [200, "original\n"], [200, "wrong JS"]]) expect(() => assertPublicAsset(asset, status, Buffer.from(bytes))).toThrow();
  });
  it("includes root and nonstandard new runtime directories, config and schemas", () => {
    for (const file of ["new-execution/new.ts", "unknown-directory/extra.sql", ".github/workflows/deploy.yml", "package-lock.json", "scripts/new.sh"]) expect(runtime(file)).toBe(true);
    for (const file of ["output/new.ts", "docs/fixture.js", "client/test.test.ts"]) expect(runtime(file)).toBe(false);
  });
  it("accepts only fresh, passed evidence for the same independent versions and immutable baseline", () => {
    const snapshot = { captureId: "11111111-1111-1111-1111-111111111111", frontendVersion: frontend, backendVersion: backend, immutableBaseline: "75b1efac66625e5f2bc9884a965b244bfaf337ed" };
    const report = { ...snapshot, passed: true }; assertCaptureEvidence(snapshot, report);
    for (const patch of [{ captureId: "older" }, { frontendVersion: backend }, { backendVersion: frontend }, { immutableBaseline: frontend }, { passed: false }])
      expect(() => assertCaptureEvidence(snapshot, { ...report, ...patch })).toThrow();
    expect(() => assertCaptureEvidence({}, { passed: true })).toThrow();
  });
});
describe("complete actual public entry boundary in addition to fixed FOK parity", () => {
  for (const file of publicFiles) {
    const actual = gitSource(file.startsWith("server/") ? backend : frontend, file);
    const current = fs.readFileSync(file, "utf8");
    it(`${file}: validates current full module against its own release`, () => verifyActualPublicModule(file, current, actual));
    for (const [name, mutate] of [
      ["added trade", source => source + "\nvoid unexpectedTrade();"],
      ["extra import", source => 'import { hidden } from "./hidden";\n' + source],
      ["literal whitespace", source => source + '\nconst injected = "a  b";'],
    ]) it(`${file}: rejects ${name}`, () => expect(() => verifyActualPublicModule(file, mutate(current), actual)).toThrow());
  }
  const file = publicFiles[1], actual = gitSource(backend, file), current = fs.readFileSync(file, "utf8");
  for (const [name, before, after] of [
    ["extra action", '"Pm_GtcSaveOrders"].includes', '"Pm_GtcSaveOrders", "Pm_UnexpectedTrade"].includes'],
    ["dispatch arguments", "handlePmGtc(action, body, ctx.user.id)", "handlePmGtc(action, body, \"other-owner\")"],
    ["GTC branch side effect", "return ok(await handlePmGtc", "void unexpectedTrade(); return ok(await handlePmGtc"],
    ["unknown fallback", "未知预测市场 action:", "未知 预测市场 action:"],
  ]) it(`rejects ${name} inside a registered GTC branch`, () => { expect(current).toContain(before); expect(() => verifyActualPublicModule(file, current.replace(before, after), actual)).toThrow(); });
});
