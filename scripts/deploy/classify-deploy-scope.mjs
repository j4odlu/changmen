/**
 * Publish by reviewed physical ownership; shared and unknown inputs stay full.
 * Dependency-audit inventories do not authorize graph-derived scope narrowing.
 *
 * @param {string[]} paths
 * @returns {'frontend' | 'backend' | 'full' | 'noop'}
 */
const frontendRoots = ["client/web/", "client/packages/client-core/", "client/packages/arb-core/",
  "client/packages/venue-browser/", "client/packages/pm-market-data-browser/", "client/devtools/"];
const ciOnlyFiles = new Set(["classify-deploy-scope.mjs", "classify-deploy-scope-cli.mjs", "change-plan.mjs",
  "check-controls.mjs", "release-checks.mjs", "release-summary.mjs", "read-deployed-versions.mjs", "check-database-compatibility.mjs", "release.test.sh"]
  .map(file => "scripts/deploy/" + file));
const backendDeployFiles = new Set(["install-backend.mjs", "backend-install-profile.mjs", "verify-backend-processes.mjs",
  "pack-git-repo.mjs", "compile-backend-router.mjs", "deploy-hk-fast.mjs", "deploy-hk-remaining.mjs"].map(file => "scripts/deploy/" + file));

export function isDatabaseMaintenancePath(p) {
  return /^(?:server\/backend\/db\/migrations\/|(?:rds|server\/db)\/(?:schema|assets|maintenance)\/|server\/backend\/scripts\/ops\/migrations\/)/.test(p)
    || /^server\/backend\/scripts\/(?:apply-rds-schema|apply-order-observation-schema)\.mjs$/.test(p)
    || /^server\/backend\/scripts\/(?:check-rds-schema\.mjs|rds-schema-[^/]+|rds-migrations(?:\.test)?\.mjs)$/.test(p)
    || p === "server/backend/scripts/ops/diagnostics/check-rds-schema.mjs";
}

export function classifyDeployScope(paths) {
  let frontend = false;
  let backend = false;
  let sawDeployRelevant = false;

  for (const raw of paths || []) {
    if (typeof raw !== "string") return "full";
    const p = raw.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^changmen\//, "").trim();
    if (!p)
      continue;
    if (p.startsWith("/") || p.includes(":") || p.includes("\0") || p.split("/").some(part => part === ".." || part === "." || !part)) return "full";

    if (isDatabaseMaintenancePath(p)) continue;

    // Docs / local-only — no VPS action
    if (
      /\.md$/i.test(p)
      || p === ".gitignore"
      || p.startsWith("docs/")
      || p.startsWith(".tmp/")
      || p.startsWith("BAT/")
      || p.startsWith("certificate/")
      || p.startsWith("orders_purge")
    ) {
      continue;
    }

    // CI workflow text only — runners pick it up next push; no live VPS mutate
    if (p.startsWith(".github/"))
      continue;

    // Chrome extension ships separately
    if (p.startsWith("client/chrome-extension/") || p.startsWith("chrome-extension/"))
      continue;

    // These sources run in CI/local verification, never in the eight app entries.
    // Validation and database compatibility selection still see the full diff.
    if (ciOnlyFiles.has(p) || /^scripts\/(?:verification|testing)\//.test(p)
      || /^scripts\/deploy\/(?:[^/]+\.test\.mjs$|fixtures\/)/.test(p)) continue;

    sawDeployRelevant = true;

    // [changmen 扩展] This Node helper is also consumed by the frontend build.
    // Publication/evidence plumbing is shared by both component transports.
    if (p.startsWith("server/storage/runtime_version.")
      || p.startsWith("devtools/runtime-tooling/")
      || p === "scripts/deploy/publish.sh"
      || /^scripts\/deploy\/(?:release-evidence|release-retention|verify-runtime|acceptance-contract|compare-deployed-files)\./.test(p)
      || p === "deploy/scripts/release-common.sh"
      || p.startsWith("sh/deploy-")) {
      frontend = true;
      backend = true;
      continue;
    }
    if (p === "deploy/scripts/release-frontend.sh") {
      frontend = true;
      continue;
    }

    if (p === "package.json" || p === "package-lock.json" || p === "turbo.json") {
      frontend = true;
      backend = true;
      continue;
    }

    if (frontendRoots.some(root => p.startsWith(root))) {
      frontend = true;
      continue;
    }

    if (
      p.startsWith("packages/venue-adapter/")
      || /^server\/packages\/(?:venue-node-(?:loader|registry)|venue-adapter-tools)\//.test(p)
      || p.startsWith("client/platform-adapter/")
      || p.startsWith("packages/")
    ) {
      frontend = true;
      backend = true;
      continue;
    }

    if (
      p.startsWith("server/")
      || p.startsWith("rds/")
      || p.startsWith("deploy/")
      || p.startsWith("devtools/")
      || backendDeployFiles.has(p)
      || p.startsWith("lines/")
    ) {
      backend = true;
      continue;
    }

    // Unknown path → full (safe)
    frontend = true;
    backend = true;
  }

  if (!sawDeployRelevant)
    return "noop";
  if (frontend && backend)
    return "full";
  if (frontend)
    return "frontend";
  if (backend)
    return "backend";
  return "noop";
}

/**
 * @param {string} fromSha
 * @param {string} toSha
 * @param {{ execFileSync?: (file: string, args: string[], opts?: object) => string, execSync?: (cmd: string, opts?: object) => string }} [opts]
 * @returns {string[] | null} null = unknown base / git failed → treat as full
 */
export function listChangedPaths(fromSha, toSha, opts = {}) {
  const from = String(fromSha || "").trim();
  const to = String(toSha || "").trim() || "HEAD";
  if (!from || /^0+$/.test(from))
    return null;

  try {
    let out;
    if (opts.execFileSync) {
      out = opts.execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", from, to], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    else if (opts.execSync) {
      // Tests / legacy: still accept execSync, but quote is caller responsibility
      out = opts.execSync(`git diff --no-renames --name-only -z ${from} ${to}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    else {
      throw new Error("listChangedPaths requires opts.execFileSync or opts.execSync");
    }
    const text = String(out);
    return (text.includes("\0") ? text.split("\0") : text.split(/\r?\n/)).filter(Boolean);
  }
  catch {
    return null;
  }
}

/**
 * Resolve scope for a push / manual run.
 * @param {{ from?: string, to?: string, forceFull?: boolean, paths?: string[], execSync?: Function }} input
 */
export function resolveDeployScope(input = {}) {
  if (input.forceFull)
    return { scope: "full", paths: input.paths || [], reason: "force_full" };

  if (Array.isArray(input.paths)) {
    const scope = classifyDeployScope(input.paths);
    return { scope, paths: input.paths, reason: "paths" };
  }

  const paths = listChangedPaths(input.from || "", input.to || "HEAD", {
    execFileSync: input.execFileSync,
    execSync: input.execSync,
  });
  if (!paths)
    return { scope: "full", paths: [], reason: "unknown_base" };

  const scope = classifyDeployScope(paths);
  return { scope, paths, reason: "git_diff" };
}
