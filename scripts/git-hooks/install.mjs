// [changmen 扩展] Configure only the calling repository; never changes global Git settings.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function installHooks(cwd = process.cwd()) {
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
  const root = git(["rev-parse", "--show-toplevel"]);
  const hook = path.join(root, "scripts/git-hooks/pre-commit");
  if (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name !== "changmen" || !fs.existsSync(hook))
    throw Error("Run hooks:install inside the changmen repository with its tracked hook files");
  if (process.platform !== "win32") fs.chmodSync(hook, fs.statSync(hook).mode | 0o111);
  git(["config", "--local", "core.hooksPath", "scripts/git-hooks"]);
  return { root, hooksPath: git(["config", "--local", "--get", "core.hooksPath"]), globalSettingsChanged: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(installHooks())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
