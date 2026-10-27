import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const source = path.join(repo, "server/storage");

// All files and env values are synthetic. Never load the developer's backend .env/storage.
export function runStorageFixture(t, script, { files = {}, env = {}, timeout = 10000 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-storage-ts-"));
  const write = (name, bytes) => {
    const target = path.resolve(root, name);
    assert(target.startsWith(root + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  };
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert(path.basename(root).startsWith("changmen-storage-ts-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  for (const name of fs.readdirSync(source)) {
    if (name === "package.json" || name.endsWith(".ts") && !name.endsWith(".d.ts"))
      write("server/storage/" + name, fs.readFileSync(path.join(source, name)));
  }
  write("server/backend/package.json", JSON.stringify({ name: "@changmen/backend", type: "module" }));
  write("package.json", '{"type":"module"}');
  for (const name of [pkg.name, ...Object.keys(pkg.dependencies)]) {
    const target = name === pkg.name ? path.join(root, "server/storage")
      : fs.realpathSync(path.join(repo, "node_modules", name));
    const link = path.join(root, "node_modules", name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  }
  for (const [name, bytes] of Object.entries(files)) write(name, bytes);
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC)$/i.test(name)));
  Object.assign(childEnv, {
    NODE_OPTIONS: "", NODE_PATH: "", DATABASE_URL: "", DATABASE_URL_PUBLIC: "", DATABASE_URL_INTERNAL: "",
    DOTENV_CONFIG_QUIET: "true", STORAGE_FIXTURE_ROOT: root,
  }, Object.fromEntries(Object.entries(env).map(([name, value]) => [name, value.replaceAll("{root}", root)])));
  const preamble = `import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
const root=process.env.STORAGE_FIXTURE_ROOT;`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", preamble + script], {
    cwd: root, env: childEnv, encoding: "utf8", timeout, windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
