/**
 * Classify deploy scope from changed paths (step 5: FE/BE split pipelines).
 *
 * @param {string[]} paths
 * @returns {'frontend' | 'backend' | 'full' | 'noop'}
 */
export function classifyDeployScope(paths) {
  let frontend = false;
  let backend = false;
  let sawDeployRelevant = false;

  for (const raw of paths || []) {
    const p = String(raw || "").replace(/^changmen\//, "").replace(/^\.\//, "").trim();
    if (!p)
      continue;

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

    sawDeployRelevant = true;

    if (p === "package.json" || p === "package-lock.json" || p === "turbo.json") {
      frontend = true;
      backend = true;
      continue;
    }

    if (p.startsWith("client/web/")) {
      frontend = true;
      continue;
    }

    if (
      p.startsWith("packages/venue-adapter/")
      || p.startsWith("client/platform-adapter/")
      || p.startsWith("packages/")
    ) {
      frontend = true;
      backend = true;
      continue;
    }

    if (
      p.startsWith("server/")
      || p.startsWith("deploy/")
      || p.startsWith("devtools/")
      || p.startsWith("scripts/deploy/")
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
      out = opts.execFileSync("git", ["diff", "--name-only", from, to], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    else if (opts.execSync) {
      // Tests / legacy: still accept execSync, but quote is caller responsibility
      out = opts.execSync(`git diff --name-only ${from} ${to}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    else {
      throw new Error("listChangedPaths requires opts.execFileSync or opts.execSync");
    }
    return String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
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
