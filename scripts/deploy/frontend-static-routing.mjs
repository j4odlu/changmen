import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const directoryFallback = "try_files {path} {path}/index.html /index.html";
export function directoryEntryConfig(source) {
  assert(source.includes("root * /root/changmen/client/web/dist"), "Unknown frontend Caddy root");
  const next = source.replaceAll("try_files {path} /index.html", directoryFallback)
    .replace(/(^[\t ]*@spa_html(?:_https)?[\t ]+path[\t ]+\/[\t ]+\/index\.html)([\t ]*\r?$)/gm,
      "$1 /listener /listener/ /listener/index.html$2");
  assert(next.includes(directoryFallback), "Unknown frontend Caddy fallback");
  return next;
}

/** Backward-compatible static routing; validate before replacing, restore on reload failure. */
export function prepareDirectoryEntries(file = "/etc/caddy/Caddyfile", run = execFileSync) {
  if (!fs.existsSync(file)) return { changed: false, reason: "Caddy config absent" };
  assert(!fs.lstatSync(file).isSymbolicLink(), "Caddy config must be a regular file");
  const original = fs.readFileSync(file, "utf8"), next = directoryEntryConfig(original);
  if (next === original) return { changed: false };
  const temporary = `${file}.listener-${randomUUID()}`;
  const stat = fs.statSync(file), mode = stat.mode & 0o777;
  const write = text => {
    fs.writeFileSync(temporary, text, { mode, flag: "wx" });
    if (process.platform !== "win32") fs.chownSync(temporary, stat.uid, stat.gid);
    fs.chmodSync(temporary, mode);
  };
  const invoke = (command, args) => run(command, args, { stdio: "pipe", timeout: 30000, windowsHide: true });
  let replaced = false;
  try {
    write(next);
    invoke("caddy", ["validate", "--config", temporary, "--adapter", "caddyfile"]);
    fs.renameSync(temporary, file); replaced = true;
    invoke("systemctl", ["reload", "caddy"]);
    return { changed: true };
  } catch (error) {
    if (replaced) {
      write(original); fs.renameSync(temporary, file);
      try { invoke("systemctl", ["reload", "caddy"]); }
      catch (restoreError) { throw new AggregateError([error, restoreError], "Caddy reload and restoration failed"); }
    }
    throw error;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(prepareDirectoryEntries())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
