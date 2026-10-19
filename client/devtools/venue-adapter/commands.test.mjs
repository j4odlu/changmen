// [changmen 扩展] Exercise real commands against an isolated miniature repository.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-venue-tools-"));
  const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  for (const name of ["list-web-venue-imports", "relativize-internal-imports", "sync-package-exports"]) {
    for (const prefix of ["packages/venue-adapter/scripts", "client/devtools/venue-adapter"])
      write(`${prefix}/${name}.mjs`, fs.readFileSync(path.join(repo, prefix, `${name}.mjs`), "utf8"));
  }
  write("client/web/src/main.ts", 'import { adapter } from "@changmen/venue-adapter/polymarket";');
  write("packages/venue-adapter/polymarket/index.ts", "export const adapter = 1;");
  write("packages/venue-adapter/package.json", JSON.stringify({ exports: {
    ".": "./registry/index.ts", "./loader/adapter_paths.js": "./loader/adapter_paths.mjs",
    "./loader/adapter_paths.mjs": "./loader/adapter_paths.mjs", "./polymarket": "./polymarket/index.ts",
    "./polymarket/orderBook": "./polymarket/orderBook.ts", "./polymarket/wsBookShadow": "./polymarket/wsBookShadow.ts",
  } }));
  const command = (name, args = ["--check"], canonical = false) => spawnSync(process.execPath,
    [path.join(root, canonical ? "client/devtools/venue-adapter" : "packages/venue-adapter/scripts", `${name}.mjs`), ...args],
    { cwd: os.tmpdir(), encoding: "utf8", windowsHide: true });
  try { run({ root, write, command }); }
  finally { if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("changmen-venue-tools-")) fs.rmSync(root, { recursive: true, force: true }); }
}
it("keeps old and canonical checks equivalent independently of cwd", () => fixture(({ command }) => {
  for (const name of ["list-web-venue-imports", "relativize-internal-imports", "sync-package-exports"]) {
    const old = command(name), next = command(name, ["--check"], true);
    expect(old.status, old.stderr).toBe(0); expect(next.status, next.stderr).toBe(0);
    expect(next.stdout).toBe(old.stdout); expect(next.stderr).toBe(old.stderr);
  }
}));
it("still rejects illegal web deep imports and export drift", () => fixture(({ write, command }) => {
  write("client/web/src/main.ts", 'import { x } from "@changmen/venue-adapter/polymarket/private";');
  expect(command("list-web-venue-imports").status).toBe(1);
  write("client/web/src/main.ts", 'import { x } from "@changmen/venue-adapter/polymarket";');
  write("packages/venue-adapter/package.json", '{"exports":{}}');
  expect(command("sync-package-exports").status).toBe(1);
  expect(command("sync-package-exports", []).status).toBe(0);
  expect(command("sync-package-exports").status).toBe(0);
}));
it("rewrites only adapter source using the original adapter root", () => fixture(({ root, write, command }) => {
  write("packages/venue-adapter/polymarket/source.ts", 'import { adapter } from "@changmen/venue-adapter/polymarket";');
  expect(command("relativize-internal-imports").status).toBe(1);
  expect(command("relativize-internal-imports", []).status).toBe(0);
  expect(fs.readFileSync(path.join(root, "packages/venue-adapter/polymarket/source.ts"), "utf8")).toContain('from "./index"');
  expect(fs.readFileSync(path.join(root, "client/web/src/main.ts"), "utf8")).toContain("@changmen/venue-adapter/polymarket");
  expect(command("relativize-internal-imports").status).toBe(0);
}));
it("retains both browser compatibility exports after the last application import is removed", () => fixture(({ root, write, command }) => {
  write("client/web/src/main.ts", "export {};\n");
  expect(command("sync-package-exports", []).status).toBe(0);
  const exports = JSON.parse(fs.readFileSync(path.join(root, "packages/venue-adapter/package.json"), "utf8")).exports;
  expect(exports["./polymarket/orderBook"]).toBe("./polymarket/orderBook.ts");
  expect(exports["./polymarket/wsBookShadow"]).toBe("./polymarket/wsBookShadow.ts");
}));
