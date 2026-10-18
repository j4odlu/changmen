// [changmen 扩展] The hook checks frontend inputs from this repository root.
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function needsFrontendTypecheck(files) {
  return files.some(file => ["package.json", "package-lock.json"].includes(file)
    || /^(?:client\/|packages\/(?:api-contract|shared|client-core|arb-core|venue-adapter)\/|devtools\/runtime-tooling\/)/.test(file)
      && /\.(?:[cm]?js|tsx?|vue|json|css|scss|less|html|svg)$/.test(file)
      && !/(?:^|\/)docs\//.test(file));
}

export function runPreCommit({ cwd = process.cwd(), run = spawnSync } = {}) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", windowsHide: true }).trim();
  const files = execFileSync("git", ["diff", "--cached", "--name-only", "--no-renames", "-z"],
    { cwd: root, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  if (!needsFrontendTypecheck(files)) return 0;
  console.log("[pre-commit] Frontend inputs changed: npm run typecheck:frontend");
  // Fixed command only: staged filenames are never interpolated into a shell.
  const result = process.platform === "win32"
    ? run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run typecheck:frontend"], { cwd: root, stdio: "inherit", windowsHide: true })
    : run("npm", ["run", "typecheck:frontend"], { cwd: root, stdio: "inherit" });
  if (result.error) console.error(`[pre-commit] Cannot run frontend typecheck: ${result.error.message}`);
  return result.status === 0 && !result.error ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runPreCommit(); }
  catch (error) { console.error(`[pre-commit] ${error.message}`); process.exitCode = 1; }
}
