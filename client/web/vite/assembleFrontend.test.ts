import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { assembleFrontend } from "./assembleFrontend.mjs";

it("assembles both entries with shared version and distinct assets without changing the original HTML", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-assembly-"));
  const web = path.join(root, "web"), listener = path.join(root, "listener");
  const write = (dir: string, file: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), body);
  };
  try {
    write(web, "index.html", '<script src="/assets/index-original.js"></script>');
    write(web, "runtime-version.json", '{"commit":"same"}');
    write(web, "runtime-version.html", "version");
    write(listener, "index.html", '<script src="/assets/listener/index-new.js"></script>');
    write(listener, "assets/listener/index-new.js", 'import("./nested.js")');
    write(listener, "assets/listener/nested.js", "nested");
    write(listener, "isolation-manifest.json", '{"modules":[{"path":"client/listener/module/bootstrap.ts"}]}');
    assembleFrontend(web, listener);
    expect(fs.readFileSync(path.join(web, "index.html"), "utf8")).toContain("index-original.js");
    expect(fs.readFileSync(path.join(web, "listener/index.html"), "utf8")).toContain("/assets/listener/index-new.js");
    expect(fs.readFileSync(path.join(web, "assets/listener/nested.js"), "utf8")).toBe("nested");
    expect(fs.readFileSync(path.join(web, "listener/runtime-version.json"), "utf8")).toBe('{"commit":"same"}');
    fs.unlinkSync(path.join(listener, "assets/listener/index-new.js"));
    expect(() => assembleFrontend(web, listener)).toThrow("Missing production listener entry");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
