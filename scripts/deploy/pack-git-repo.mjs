/**
 * Pack deployable repo from git HEAD only (no .turbo / .claude / untracked junk).
 * Backend artifacts include routes compiled from the extracted HEAD sources.
 */
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isVersionSource } from "../../devtools/runtime-tooling/runtime_version.js";
import { compileBackendRouter } from "./compile-backend-router.mjs";

/** Abort if pack exceeds this — local caches must never ship again. */
export const REPO_PACK_MAX_MB = 40;

export const BACKEND_ARCHIVE_PROFILE = "backend-runtime-v2";
const deploymentFiles = new Set(["deploy/ecosystem.config.cjs", "deploy/scripts/deploy-server-remote.sh",
  "scripts/deploy/install-backend.mjs", "scripts/deploy/backend-install-profile.mjs",
  "scripts/deploy/verify-backend-processes.mjs", "scripts/verification/component-install-inputs.mjs"]);

export function backendArchiveIncludes(file) {
  if (typeof file !== "string" || !file || file.includes("\\") || file.includes(":") || file.includes("\0")
    || file.split("/").some(part => !part || part === "." || part === "..")) throw Error("Unsafe archive path");
  if (/(?:^|\/)(?:node_modules|dist|docs|output|test|tests|__tests__|\.git|\.turbo|\.ai|\.claude)(?:\/|$)|\.(?:test|spec)\.|\.md$/i.test(file)
    || /(?:^|\/)(?:\.env(?:\.|$)|\.npmrc$)|\.(?:pem|key|pfx|p12)$/i.test(file)
    || file.startsWith("server/backend/storage/")) return false;
  // Retain every manifest unchanged: npm ci consumes the original root lock and
  // workspace layout, even though only the sixteen Node workspaces are installed.
  if (file === "package.json" || file === "package-lock.json" || file.endsWith("/package.json")) return true;
  return deploymentFiles.has(file)
    || /^(?:server\/|rds\/|packages\/(?:shared|api-contract)\/|devtools\/(?:runtime-tooling|platform-probes)\/)/.test(file);
}

/** A deterministic, HEAD-only backend artifact; legacy full-repository packing stays explicit. */
export function packBackendRepoArchive(repoRoot, outPath, opts = {}) {
  // Windows' bundled bsdtar can reject tracked non-ASCII names. Use the same
  // MSYS GNU tar already required by the release integration tests when present.
  const msysTar = "C:/msys64/usr/bin/tar.exe", gnu = process.platform !== "win32" || fs.existsSync(msysTar);
  const tar = process.platform === "win32" && gnu ? msysTar : "tar";
  const run = (command, args, extra = {}) => execFileSync(command, args,
    { cwd: repoRoot, encoding: "utf8", windowsHide: true, maxBuffer: 30e6, ...extra });
  const archiveCommand = args => run(tar, [...(process.platform === "win32" && gnu ? ["--force-local"] : []), ...args]);
  const inventory = run("git", ["ls-tree", "-r", "-z", "HEAD"]).split("\0").filter(Boolean).map(row => {
    const split = row.indexOf("\t"), [mode, type] = row.slice(0, split).split(" ");
    return { file: row.slice(split + 1), mode, type };
  });
  const members = inventory.filter(row => backendArchiveIncludes(row.file));
  for (const row of members) if (row.type !== "blob" || !["100644", "100755"].includes(row.mode))
    throw Error(`Unsupported backend archive member: ${row.file}`);
  const missing = inventory.filter(row => isVersionSource(row.file, "backend") && !backendArchiveIncludes(row.file));
  if (missing.length) throw Error(`Backend identity sources would be omitted: ${missing.map(row => row.file).join(", ")}`);
  if (!members.length) throw Error("Empty backend archive");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-backend-pack-"));
  try {
    const source = path.join(temporary, "source"), full = path.join(temporary, "full.tgz"), list = path.join(temporary, "members");
    const original = packGitRepoArchive(repoRoot, full, opts);
    fs.mkdirSync(source); archiveCommand(["-xzf", full, "-C", source]);
    const timestamp = new Date(Number(run("git", ["show", "-s", "--format=%ct", "HEAD"]).trim()) * 1000);
    const generated = compileBackendRouter(source, repoRoot, timestamp);
    const files = [...new Set([...members.map(row => row.file), ...generated])].sort();
    fs.writeFileSync(list, files.join("\0") + "\0");
    const owner = gnu ? ["--owner=0", "--group=0", "--numeric-owner"]
      : ["--uid=0", "--gid=0", "--uname=root", "--gname=root"];
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    archiveCommand([...owner, "-czf", path.resolve(outPath), "-C", source, "--null", "-T", list]);
    const bytes = fs.statSync(outPath).size, maxMb = Number(opts.maxMb) > 0 ? Number(opts.maxMb) : REPO_PACK_MAX_MB;
    if (bytes > maxMb * 1024 * 1024) { fs.unlinkSync(outPath); throw Error("Backend archive exceeds size limit"); }
    return { profile: BACKEND_ARCHIVE_PROFILE, head: original.head, bytes, mb: bytes / (1024 * 1024),
      files: files.length, fullFiles: inventory.length, fullBytes: original.bytes };
  } catch (error) { fs.rmSync(outPath, { force: true }); throw error; }
  finally {
    if (path.dirname(temporary) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith("changmen-backend-pack-"))
      throw Error("Unexpected backend pack cleanup target");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * @param {string} repoRoot git work tree root
 * @param {string} outPath destination .tgz / .tar.gz
 * @param {{ maxMb?: number }} [opts]
 * @returns {{ bytes: number, mb: number, head: string }}
 */
export function packGitRepoArchive(repoRoot, outPath, opts = {}) {
  const maxMb = Number(opts.maxMb) > 0 ? Number(opts.maxMb) : REPO_PACK_MAX_MB;

  const gitOk = spawnSync("git", ["-C", repoRoot, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });
  if (gitOk.status !== 0 || String(gitOk.stdout || "").trim() !== "true")
    throw new Error(`not a git work tree: ${repoRoot}`);

  const head = spawnSync("git", ["-C", repoRoot, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  });
  if (head.status !== 0)
    throw new Error(`git rev-parse HEAD failed in ${repoRoot}`);
  const headShort = String(head.stdout || "").trim();

  if (fs.existsSync(outPath))
    fs.unlinkSync(outPath);

  // Only tracked files at HEAD — immune to .turbo / .claude / tmp_* growth
  const archived = spawnSync(
    "git",
    ["-C", repoRoot, "archive", "--format=tar.gz", `-o`, outPath, "HEAD"],
    { encoding: "utf8" },
  );
  if (archived.status !== 0) {
    const err = String(archived.stderr || archived.stdout || "").trim();
    throw new Error(`git archive failed: ${err || `exit ${archived.status}`}`);
  }
  if (!fs.existsSync(outPath))
    throw new Error(`git archive produced no file: ${outPath}`);

  const bytes = fs.statSync(outPath).size;
  const mb = bytes / (1024 * 1024);
  console.log(`==> repo pack (git HEAD ${headShort}): ${mb.toFixed(1)} MB -> ${outPath}`);
  if (mb > maxMb) {
    try {
      fs.unlinkSync(outPath);
    }
    catch {
      /* ignore */
    }
    throw new Error(
      `repo pack ${mb.toFixed(1)} MB exceeds ${maxMb} MB limit. `
      + `Refusing to upload — check for unexpected large tracked files.`,
    );
  }
  return { bytes, mb, head: headShort };
}
