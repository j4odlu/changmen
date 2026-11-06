import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { directoryEntryConfig, prepareDirectoryEntries } from "./frontend-static-routing.mjs";

const original = `(changmen_https_site) {
  root * /root/changmen/client/web/dist
  handle /api/* { reverse_proxy 127.0.0.1:3456 }
  @spa_html_https path / /index.html
  header @spa_html_https Cache-Control "no-cache, no-store, must-revalidate"
  handle {
    try_files {path} /index.html
    file_server
  }
}
api.example { tls { client_auth { mode require_and_verify } } }
`;
test("adds directory entries before SPA fallback and retains TLS/API bytes", () => {
  const next = directoryEntryConfig(original);
  assert(next.includes("try_files {path} {path}/index.html /index.html"));
  assert(next.includes("path / /index.html /listener /listener/ /listener/index.html"));
  assert.equal(next.replace(" {path}/index.html", "").replace(" /listener /listener/ /listener/index.html", ""), original);
  assert.equal(directoryEntryConfig(next), next);
  assert.throws(() => directoryEntryConfig(original.replace("/root/changmen", "/other")), /Unknown frontend Caddy root/);
  assert.throws(() => directoryEntryConfig(original.replace("try_files {path} /index.html", "try_files /custom")), /Unknown frontend Caddy fallback/);
});
for (const failure of [null, "validate", "reload"]) test(`validates before replacing and restores configuration on ${failure || "success"}`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-caddy-")), file = path.join(root, "Caddyfile");
  fs.writeFileSync(file, original); const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (command === "caddy") {
      assert.equal(fs.readFileSync(file, "utf8"), original);
      assert(fs.readFileSync(args[2], "utf8").includes("{path}/index.html"));
      if (failure === "validate") throw Error("Invalid config");
    }
    if (command === "systemctl" && failure === "reload" && calls.length === 2) throw Error("Reload failed");
  };
  try {
    if (failure) assert.throws(() => prepareDirectoryEntries(file, run), failure === "validate" ? /Invalid config/ : /Reload failed/);
    else { assert.deepEqual(prepareDirectoryEntries(file, run), { changed: true });
      assert.deepEqual(prepareDirectoryEntries(file, run), { changed: false }); }
    assert.equal(fs.readFileSync(file, "utf8"), failure ? original : directoryEntryConfig(original));
    assert.equal(calls.length, failure === "validate" ? 1 : failure === "reload" ? 3 : 2);
    assert.deepEqual(fs.readdirSync(root), ["Caddyfile"]);
    assert.deepEqual(prepareDirectoryEntries(path.join(root, "absent"), run), { changed: false, reason: "Caddy config absent" });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
