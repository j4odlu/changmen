#!/usr/bin/env node
/**
 * 电竞业务冻结闸门：diff 命中 esport-freeze.json 路径且未 ALLOW_ESPORT_TOUCH=1 → 失败。
 *
 * 用法：
 *   node packages/venue-adapter/scripts/check-esport-freeze.mjs
 *   ESPORT_FREEZE_BASE=origin/main node ...
 *   ALLOW_ESPORT_TOUCH=1 node ...   # 显式解冻（仍应跑 quote-hub-contracts）
 *
 * Base 默认：与 origin/main|master 的 merge-base；否则 HEAD（仅查工作区相对 HEAD）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentFreezePaths, currentFrozenChanges, validateFreezeManifest, changedFreezeFiles, validationFreezeFiles } from "../../../scripts/verification/current-esport-freeze.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PKG_ROOT = path.join(REPO_ROOT, "packages/venue-adapter");
const MANIFEST = path.join(PKG_ROOT, "esport-freeze.json");

const LIST_ONLY = process.argv.includes("--list");
const ALLOW_CLI = process.argv.includes("--allow");
const allowEnv = "ALLOW_ESPORT_TOUCH";

function git(args, opts = {}) {
  try {
    const output = execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    return opts.trim === false ? output : output.trim();
  }
  catch (err) {
    if (opts.allowFail)
      return "";
    throw err;
  }
}

function loadManifest() {
  const raw = validateFreezeManifest(fs.readFileSync(MANIFEST, "utf8"));
  const paths = (raw.paths || []).map(p => String(p).replace(/\\/g, "/"));
  return { ...raw, paths };
}

function detectBase() {
  if (process.env.ESPORT_FREEZE_BASE)
    return process.env.ESPORT_FREEZE_BASE.trim();
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    const ok = git(["rev-parse", "--verify", ref], { allowFail: true });
    if (!ok)
      continue;
    const mb = git(["merge-base", "HEAD", ref], { allowFail: true });
    if (mb)
      return mb;
  }
  return "HEAD";
}

async function main() {
  const manifest = loadManifest();
  if (LIST_ONLY) {
    for (const p of manifest.paths)
      console.log(p);
    process.exit(0);
  }

  const base = detectBase();
  const changed = validationFreezeFiles(changedFreezeFiles(git, base), { root: REPO_ROOT });
  let hits;
  if (process.env.CHANGMEN_HISTORICAL_AUDIT === "1") {
    const { checkPmFolderFreeze } = await import("../../../scripts/verification/pm-folder-release-boundary.mjs");
    const { readPreviousWorkspaceFile } = await import("../../../scripts/verification/workspace-layout-history.mjs");
    ({ hits } = checkPmFolderFreeze(changed, fs.readFileSync(MANIFEST, "utf8"),
      file => readPreviousWorkspaceFile(path.join(REPO_ROOT, file), "utf8"),
      (ref, file) => git(["show", `${ref}:${file}`], { trim: false })));
  } else hits = currentFrozenChanges(changed, currentFreezePaths(REPO_ROOT, manifest.paths));

  if (!hits.length) {
    console.log(`[esport-freeze] ok (base=${base}, changed=${changed.length}, frozen hits=0)`);
    process.exit(0);
  }

  const unlocked = ALLOW_CLI
    || process.env[allowEnv] === "1"
    || process.env[allowEnv] === "true";
  console.error(`[esport-freeze] 命中电竞冻结面 (base=${base}):`);
  for (const h of hits)
    console.error(`  - ${h}`);
  console.error("");
  console.error("体育/N3.5 迭代不应改这些文件。冻结清单: packages/venue-adapter/esport-freeze.json");
  console.error(`解冻: ${allowEnv}=1 或 --allow（并说明原因；改 hub/collect 后请跑 test:quote-hub-contracts）`);

  if (unlocked) {
    console.warn(`[esport-freeze] ${ALLOW_CLI ? "--allow" : allowEnv} — 放行（请确认有意解冻）`);
    process.exit(0);
  }

  process.exit(1);
}

await main();
