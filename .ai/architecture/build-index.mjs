// Architecture Index generator — derives .ai/architecture/index.json from existing repo facts.
// This file does NOT create a second source of truth: every entry carries `source`/`evidence`
// pointers into the real registry/code/config. Hand-curated blocks are limited to facts that
// were code-verified during the Architecture Truth Audit phases 1–4 (2026-09-19,
// see docs/ARCHITECTURE_TRUTH_AUDIT.md) and are marked as such in each entry's `derivation`.
//
// Phase 4 additions:
//   - superseded facts bucket (TE-1): history is preserved but never served as current truth
//   - evidence freshness (TE-2 companion): audit-derived entries are annotated with
//     evidenceStatus from .ai/architecture/verified-fingerprints.json (content hashes,
//     recorded at audit events via --record-verified). Stale evidence downgrades status.
//
// Usage:
//   node .ai/architecture/build-index.mjs                 # regenerate index.json
//   node .ai/architecture/build-index.mjs --check         # drift report (PASS/DRIFT/UNKNOWN), exit 1 on DRIFT
//   node .ai/architecture/build-index.mjs --record-verified  # audit event: snapshot evidence hashes + regenerate
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK_MODE = process.argv.includes("--check");
const RECORD_MODE = process.argv.includes("--record-verified");
const FINGERPRINT_FILE = path.join(ROOT, ".ai", "architecture", "verified-fingerprints.json");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const readText = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
export const hashContent = (s) => crypto.createHash("sha1").update(s).digest("hex");
// Evidence strings carry ":line" pointers (e.g. "rds/rds/matcher_store.js:192"); the file
// path is the part before the first line-suffix colon.
export function evidencePath(e) {
  const m = String(e).match(/^(.*?):[\d]+([,-][\d]+)*$/);
  return m ? m[1] : String(e);
}

// Evidence-priority layers used across this index. Lower number = stronger truth.
const EVIDENCE_PRIORITY = ["code", "registry", "checks", "docs", "readme", "inference"];
// Lifecycle: active (default) | superseded (historical, never served as current) |
// status per entry: verified | conflicted | stale | dead-code | derived | docs-only | unknown
const STATUS_VOCABULARY = [
  "verified",        // mechanically derived or code-verified with evidence
  "verified-*",      // verified with a qualifier (e.g. verified-not-in-pm2-manifest)
  "conflicted",      // two+ evidence layers disagree; human decision required
  "stale",           // evidence files changed since last verification; re-audit required
  "dead-code",       // exists in code but has no live caller
  "derived",         // computed/derived from other entries
  "docs-only",       // only documentation asserts this
  "unknown",         // not derivable; do not guess
];

// ---------------------------------------------------------------- freshness (Phase 4)
// Minimal viable freshness: content-hash snapshot taken at audit events. If an evidence
// file's content changes after verification, dependent entries become stale (re-audit).
// UNKNOWN > pretending verified: entries with no snapshot coverage are "unverified".
export function computeEvidenceStatus(evidenceFiles, snapshot) {
  const hashes = (snapshot && snapshot.hashes) || {};
  const hasSnapshot = Object.keys(hashes).length > 0;
  let covered = 0;
  let mismatched = [];
  let nonFile = [];
  for (const raw of evidenceFiles) {
    const rel = evidencePath(raw);
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { nonFile.push(rel); continue; }
    covered++;
    const h = hashContent(fs.readFileSync(abs, "utf8"));
    if (hashes[rel] && hashes[rel] !== h) mismatched.push(rel);
    if (!hashes[rel]) nonFile.push(rel); // exists on disk but never snapshotted → no proof of stability
  }
  if (mismatched.length > 0) {
    return { evidenceStatus: "reaudit-required", mismatchedEvidence: mismatched, nonFileEvidence: nonFile };
  }
  if (!hasSnapshot || covered === 0) {
    return { evidenceStatus: "unverified", nonFileEvidence: nonFile, statusNote: covered > 0 ? "no verification snapshot exists for this evidence; UNKNOWN > pretending verified" : undefined };
  }
  if (nonFile.length > 0) {
    // no mismatch, but coverage is incomplete — current only within the verified boundary
    return { evidenceStatus: "current-partial", nonFileEvidence: nonFile };
  }
  return { evidenceStatus: "current", nonFileEvidence: [] };
}
// Apply freshness to an audit-derived entry: verified + reaudit-required → stale (keep priorStatus).
export function applyFreshness(entry, snapshot) {
  if (!entry || entry.derivation !== "audit-code-review-2026-09-19") return entry;
  const files = collectEntryEvidence(entry);
  const f = computeEvidenceStatus(files, snapshot);
  const next = { ...entry, ...f };
  if (f.evidenceStatus === "reaudit-required" && next.status === "verified") {
    next.priorStatus = "verified";
    next.status = "stale";
    next.statusNote = "evidence changed since last verification; re-audit required before relying on this fact";
  }
  return next;
}
function collectEntryEvidence(entry) {
  const files = new Set();
  if (Array.isArray(entry.evidence)) entry.evidence.forEach((e) => files.add(e));
  for (const op of entry.operations || []) {
    for (const w of op.writers || []) (w.evidence || []).forEach((e) => files.add(e));
  }
  return [...files];
}

// ---------------------------------------------------------------- drift check
// canonical platform registry → derived copies. Compare sets; never auto-fix.
function platformSetFromManifest() {
  const manifest = readJson("packages/venue-adapter/registry/manifest.json");
  return manifest.map((p) => p.id ?? p.dir).filter(Boolean).sort();
}
function tryParse(desc, fn) {
  try {
    const ids = fn();
    if (!ids || !ids.length) return { ...desc, status: "UNKNOWN", note: "parsed empty set" };
    return { ...desc, ids: [...new Set(ids)].sort() };
  } catch (e) {
    return { ...desc, status: "UNKNOWN", note: `parse failed: ${e.message}` };
  }
}
function derivedPlatformCopies() {
  const cap = new Set(["shared", "contract", "_template", "registry", "loader", "scripts", "adaptation"]);
  return [
    tryParse({ path: "packages/venue-adapter/registry/adapters.ts", extract: "regex platform adapter imports" }, () =>
      [...readText("packages/venue-adapter/registry/adapters.ts").matchAll(/from\s+"\.\.\/([a-z0-9_-]+)(?:\/|")/gi)]
        .map((m) => m[1]).filter((d) => !cap.has(d))),
    tryParse({ path: "packages/venue-adapter/shared/platforms.ts", extract: "regex PLATFORMS object keys" }, () =>
      [...readText("packages/venue-adapter/shared/platforms.ts").matchAll(/^\s{2}(\w+):\s*[{"]/gm)].map((m) => m[1])),
    tryParse({ path: "packages/api-contract/src/schemas.ts", extract: "regex zod enum members" }, () => {
      const seg = readText("packages/api-contract/src/schemas.ts").match(/z\.enum\(\[([\s\S]*?)\]\)/);
      if (!seg) throw new Error("z.enum block not found");
      return [...seg[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    }),
    tryParse({ path: "packages/client-core/src/types/platforms.ts", extract: "regex exported const members" }, () =>
      [...readText("packages/client-core/src/types/platforms.ts").matchAll(/^\s+"(\w+)",?$/gm)].map((m) => m[1])),
    { ...tryParse({ path: "chrome-extension/src/content/platforms.js", extract: "regex enum members", allowedExtra: ["HGA"] }, () =>
        [...readText("chrome-extension/src/content/platforms.js").matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])),
      note: "HGA 为 Chrome content 层 A8 兼容 provider，非 venue-adapter canonical 平台" },
    tryParse({ path: "server/backend/scripts/check-collect-platforms.js", extract: "regex ALL_PLATFORMS members" }, () => {
      const txt = readText("server/backend/scripts/check-collect-platforms.js");
      const seg = txt.match(/ALL_PLATFORMS\s*=\s*\[([\s\S]*?)\]/);
      if (!seg) throw new Error("ALL_PLATFORMS not found");
      return [...seg[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    }),
    { ...tryParse({ path: "server/backend/platforms.example.json", extract: "json keys (seed subset)", comparison: "subset" }, () =>
        Object.keys(readJson("server/backend/platforms.example.json"))), note: "seed 文件，允许为 canonical 子集" },
    { ...tryParse({ path: "packages/shared/catalog/sport_catalog.json collect.platforms", extract: "json per-sport union (semantic subset)", comparison: "subset" }, () => {
        const sc = readJson("packages/shared/catalog/sport_catalog.json");
        return (sc.sports || []).flatMap((s) => (s.collect && s.collect.platforms) || []);
      }), note: "per-sport 语义子集，仅校验 ⊆ canonical" },
  ];
}
function compareCopy(canonicalIds, copy) {
  if (copy.status === "UNKNOWN") return copy;
  const c = new Set(canonicalIds.map((x) => x.toLowerCase()));
  const mine = new Set(copy.ids.map((x) => x.toLowerCase()));
  const missing = canonicalIds.filter((x) => !mine.has(x.toLowerCase()));
  const allowedExtra = new Set((copy.allowedExtra || []).map((x) => x.toLowerCase()));
  const extra = copy.ids.filter((x) => !c.has(x.toLowerCase()) && !allowedExtra.has(x.toLowerCase()));
  const isSubsetMode = copy.comparison === "subset";
  // subset mode: a derived copy is allowed to know FEWER platforms, never MORE (extra = drift)
  const ok = isSubsetMode ? extra.length === 0 : missing.length === 0 && extra.length === 0;
  return { ...copy, status: ok ? "PASS" : "DRIFT", missing, extra: isSubsetMode ? [] : extra };
}
export function computeDrift() {
  const canonical = platformSetFromManifest();
  const platformRegistry = {
    canonical: { path: "packages/venue-adapter/registry/manifest.json", count: canonical.length, ids: canonical },
    derived: derivedPlatformCopies().map((c) => compareCopy(canonical, c)),
    status: "derived", // whole block is derived data, recomputed every build
  };
  const eco = require(path.join(ROOT, "deploy/ecosystem.config.cjs"));
  const ecoNames = eco.apps.map((a) => a.name).sort();
  const lineApps = (readJson("lines/esport/line.json").pm2Apps || []).slice().sort();
  const sportPm2 = (readJson("packages/shared/catalog/sport_catalog.json").sports || [])
    .flatMap((s) => s.pm2Apps || []).sort();
  const setEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pm2Registry = {
    canonical: { path: "deploy/ecosystem.config.cjs", ids: ecoNames },
    derived: [
      { path: "lines/esport/line.json pm2Apps", ids: lineApps, status: setEq(lineApps, ecoNames) ? "PASS" : "DRIFT", missing: ecoNames.filter((x) => !lineApps.includes(x)), extra: lineApps.filter((x) => !ecoNames.includes(x)) },
      { path: "packages/shared/catalog/sport_catalog.json pm2Apps", ids: sportPm2, status: setEq(sportPm2, ecoNames) ? "PASS" : "DRIFT", missing: ecoNames.filter((x) => !sportPm2.includes(x)), extra: sportPm2.filter((x) => !ecoNames.includes(x)), note: "sport_catalog 按运动登记，语义子集/超集需人工判断" },
    ],
    note: "进程是否默认启动/暂停以 deploy-server-remote.sh 解析为准（runtimes 节）",
  };
  return { platformRegistry, pm2Registry, generated: "every build; never auto-fixed" };
}

// ---------------------------------------------------------------- modules
const rootPkg = readJson("package.json");
function expandWorkspace(pattern) {
  if (!pattern.includes("*")) return [pattern];
  const [pre, post] = pattern.split("*");
  const base = pre.endsWith("/") ? pre.slice(0, -1) : pre;
  const dir = path.join(ROOT, base);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => base + "/" + e.name + post)
    .filter((p) => fs.existsSync(path.join(ROOT, p, "package.json")));
}
const moduleDirs = [...new Set(rootPkg.workspaces.flatMap(expandWorkspace))].sort();
const candidateRoots = ["packages", "client", "server", "server/match", "server/collectors", "devtools"];
const uncovered = [];
for (const r of candidateRoots) {
  const dir = path.join(ROOT, r);
  if (!fs.existsSync(dir)) continue;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue;
    const rel = r + "/" + e.name;
    if (fs.existsSync(path.join(ROOT, rel, "package.json")) && !moduleDirs.includes(rel)) uncovered.push(rel);
  }
}
const modules = {};
for (const dir of [...moduleDirs, ...uncovered.sort()]) {
  const pkg = readJson(path.posix.join(dir, "package.json"));
  const inGlob = moduleDirs.includes(dir);
  modules[pkg.name] = {
    dir,
    version: pkg.version ?? null,
    private: pkg.private ?? null,
    changmenDeps: Object.keys(pkg.dependencies || {}).filter((d) => d.startsWith("@changmen/")),
    status: inGlob ? "verified" : "verified-not-in-workspaces-glob",
    derivation: "generated-from-package.json",
    source: inGlob ? "package.json (workspaces)" : "package.json (absent from root workspaces array — see conflict F-09)",
    evidence: [`${dir}/package.json`, "package.json (workspaces)"],
  };
}

// ---------------------------------------------------------------- runtimes + capabilities
const ecosystem = require(path.join(ROOT, "deploy/ecosystem.config.cjs"));
const deploySh = readText("deploy/scripts/deploy-server-remote.sh");
const bashVarDefaults = {};
for (const m of deploySh.matchAll(/^(PM2_\w+)="\$\{\1:-([\w-]+)\}"/gm)) bashVarDefaults[m[1]] = m[2];
const resolveVar = (t) => bashVarDefaults[t] ?? t;
const pm2Targets = [...deploySh.matchAll(/PM2_TARGETS\+=\("(\$\{?(\w+)\}?)"\)/g)].map((m) => resolveVar(m[2]));
const deletedApps = [...deploySh.matchAll(/pm2 delete "\$(\w+)"/g)].map((m) => resolveVar(m[1]));

// Capability map: runtime hosts capabilities; capabilities are implemented by modules.
const CAPABILITY_DEFS = {
  "ingest-api": {
    label: "采集接入 API（API_SaveMatch/SaveBet/SaveLiveTimer + 内存热缓存）",
    implementedBy: ["@changmen/backend"],
    hostedBy: ["changmen-esport"],
    ownsOperations: ["platform_matches:browser-ingest-write", "platform_bets:browser-ingest-write", "live_timers:replace-per-platform"],
    evidence: ["server/backend/core/esport-api/router.ts:557,567,577", "server/backend/core/esport-api/store.js"],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  "match-merge": {
    label: "赛事归一化（内嵌 matchMerge 循环 + composeOnce 合场）",
    implementedBy: ["@changmen/matcher", "@changmen/shared/match-identity"],
    hostedBy: ["changmen-esport"],
    ownsOperations: ["client_matches:compose-upsert-main", "client_matches:compose-id-stub-insert", "client_matches:prune-ended-mark"],
    evidence: ["server/backend/server.js:163-175,265", "server/match/matcher/ops/match_merge_once.js:116", "server/match/matcher/compose/compose_once.js:144", "server/match/matcher/lib/write_guard.js:41-50"],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  distribution: {
    label: "分发（Client_GetMatchs M+R 缓存 + realtime-hub Socket.IO 推送）",
    implementedBy: ["@changmen/backend", "@changmen/realtime-hub"],
    hostedBy: ["changmen-esport"],
    ownsOperations: [],
    evidence: ["docs/DATA_STORAGE.md:80", "server/realtime-hub/channels.js:1,3,6"],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  "bet-execution": {
    label: "下注执行（Pm_*/Pf_* actions + 5 个 HTTP 代理端点）",
    implementedBy: ["@changmen/backend"],
    hostedBy: ["changmen-esport"],
    ownsOperations: ["orders:upsert", "football_orders:upsert"],
    evidence: ["server/backend/http_routes.js:374-382", "server/backend/core/account/order_store.js:161"],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  "account-ledger": {
    label: "账号账本（players/profiles 内存镜像 + 写穿透）",
    implementedBy: ["@changmen/backend", "@changmen/db"],
    hostedBy: ["changmen-esport"],
    ownsOperations: ["profiles_players_memory:write-through"],
    evidence: ["server/backend/core/db/store.js:12"],
    conflicts: ["F-01"],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  "discovery-collectors": {
    label: "VPS 侧平台数据发现（collector daemons + pm-sports）",
    implementedBy: ["@changmen/polymarket-esports-collector", "@changmen/predictfun-collector", "@changmen/sxbet-collector", "@changmen/polymarket-sports"],
    hostedBy: ["changmen-polymarket-collector", "changmen-predictfun-collector", "changmen-sxbet-collector", "changmen-pm-sports"],
    ownsOperations: ["platform_matches:collector-write", "platform_bets:collector-write", "client_matches:update-pm_sport-field", "market_index_jsons:write"],
    evidence: ["server/collectors/polymarket-esports/loop.js:66-69", "rds/rds/pm_sport_store.js:74"],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  "ws-relay": {
    label: "WS 转发（ws_forward engine 内嵌 + 独立 market hub 进程）",
    implementedBy: ["@changmen/ws-forward"],
    hostedBy: ["changmen-esport", "changmen-pm-market-hub", "changmen-pm-sport-market-hub", "changmen-predictfun-market-hub", "changmen-sxbet-market-hub"],
    ownsOperations: [],
    evidence: ["server/backend/server.js:72,85", "server/ws_forward/index.js:22,51-63"],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  "control-plane": {
    label: "管控（Client_Admin*、platform_sync 凭证种子、CollectConfig）",
    implementedBy: ["@changmen/backend"],
    hostedBy: ["changmen-esport"],
    ownsOperations: ["platforms_json:setPlatform"],
    evidence: ["server/backend/server.js:92-120", "packages/api-contract/src/actions.ts"],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  "value-scan": {
    label: "正 EV 扫描（手动 daemon，不在 PM2 manifest）",
    implementedBy: ["@changmen/value-bet"],
    hostedBy: ["value-bet (manual)"],
    ownsOperations: ["value_signals:upsert"],
    evidence: ["server/value-bet/value-bet.js", "server/value-bet/db/signal_store.js:17,63,111"],
    status: "verified-not-in-pm2-manifest", derivation: "audit-code-review-2026-09-19",
  },
};
const runtimes = {};
for (const app of ecosystem.apps) {
  const portEnv = Object.keys(app.env || {}).find((k) => /(^PORT$|_PORT$)/.test(k));
  const hostsCapabilities = Object.entries(CAPABILITY_DEFS)
    .filter(([, d]) => d.hostedBy.includes(app.name))
    .map(([k]) => k);
  runtimes[app.name] = {
    entry: app.script,
    portEnv: portEnv ? { key: portEnv, value: app.env[portEnv] } : null,
    maxMemoryRestart: app.max_memory_restart ?? null,
    hosts: hostsCapabilities, // runtime ≠ capability: one runtime hosts many
    defaultDeployed: pm2Targets.includes(app.name),
    pausedByDeployScript: deletedApps.includes(app.name),
    singleInstanceFrozen: app.name === "changmen-esport",
    status: "verified",
    derivation: "generated-from-ecosystem + audit-code-review",
    source: "deploy/ecosystem.config.cjs + deploy/scripts/deploy-server-remote.sh",
    evidence: ["deploy/ecosystem.config.cjs", "deploy/scripts/deploy-server-remote.sh"],
  };
}
runtimes["value-bet (manual)"] = {
  entry: "server/value-bet/value-bet.js",
  portEnv: null,
  hosts: ["value-scan"],
  defaultDeployed: false,
  pausedByDeployScript: false,
  singleInstanceFrozen: false,
  status: "verified-not-in-pm2-manifest",
  derivation: "audit-code-review-2026-09-19",
  source: "manual start only (npm run value-bet)",
  evidence: ["server/value-bet/value-bet.js", "server/value-bet/package.json"],
};

// ---------------------------------------------------------------- resources (field/operation-level ownership)
// NOT table-level ownership: each operation lists its writers with runtime/status/evidence.
// Phase 4 (TE-2): client_matches writer list re-audited against code on 2026-09-19 — all DML
// symbols verified by direct grep of server/ (see docs/ARCHITECTURE_TRUTH_AUDIT.md Phase 4).
const W = (target, runtime, status, evidence, extra = {}) => ({ target, runtime, status, evidence, ...extra });
const resources = {
  platform_matches: {
    kind: "table", persistence: "RDS platform_matches", multiInstanceAllowed: false,
    doc: "docs/DATA_STORAGE.md:9",
    operations: [
      {
        operation: "browser-ingest-write", target: "rows where platform=<browser-collected>",
        ownershipScope: "operation", writerCardinality: "multiple",
        writers: [
          W("esport-api/store.js saveMatches → sb.writePlatformMatches", "changmen-esport", "verified",
            ["server/backend/core/esport-api/router.ts:557", "server/backend/core/esport-api/store.js:204,264", "rds/rds/platform_collector_store.js:683,713"]),
        ],
        memoryFirst: "是：内存先写 + _writeRds fire-and-forget，队列满 drop（rds/rds/common.js:71-103）",
        guard: "浏览器写路径对 VPS 馆被 isVpsOwnedPlatformCollect 拦截（warn+return，store.js:208）",
        note: "与 collector-write 按 platform 前缀分区共存（刻意多写者）",
      },
      {
        operation: "collector-write", target: "rows where platform=<vps-owned>",
        ownershipScope: "operation", writerCardinality: "multiple",
        writers: [
          W("polymarket-esports loop（writePlatformMatchesAsync）", "changmen-polymarket-collector", "verified", ["server/collectors/polymarket-esports/loop.js:66-69", "rds/rds/platform_collector_store.js:713"]),
          W("predictfun-collector loop", "changmen-predictfun-collector", "verified-runtime-paused", ["server/collectors/predictfun-collector/loop.js:118,127,129", "rds/rds/platform_collector_store.js:713"]),
          W("sxbet-collector loop", "changmen-sxbet-collector", "verified-runtime-paused", ["server/collectors/sxbet-collector/loop.js:74,84,85", "rds/rds/platform_collector_store.js:713"]),
        ],
        memoryFirst: "否（Async 直写）",
      },
      {
        operation: "compose-unbind-sweep", target: "行（UPDATE 清 client_match_id 失效绑定）",
        ownershipScope: "operation", writerCardinality: "single",
        writers: [W("clearPlatformMatchIdsPointingAtEnded（platform_collector_store.js:637；compose_once.js:272-273 在合场写路径内调用）", "changmen-esport", "verified",
          ["rds/rds/platform_collector_store.js:637", "server/match/matcher/compose/compose_once.js:272-273"])],
      },
      {
        operation: "matcher-link-unbind", target: "行（UPDATE 清 client_match_id）",
        ownershipScope: "operation", writerCardinality: "unknown",
        writers: [
          W("clearPlatformMatchIdsForClientMatchIds（platform_collector_store.js:611）", "changmen-esport / offline-scripts（经 @changmen/db 导出）", "verified",
            ["rds/rds/platform_collector_store.js:611"], { note: "全仓无 in-repo 调用方（refactor_audit.mjs 符号表除外）；caller surface UNKNOWN" }),
        ],
      },
      {
        operation: "matcher-merge-reassign", target: "行（UPDATE source→target 重挂 / DELETE 平台行）",
        ownershipScope: "operation", writerCardinality: "multiple",
        writers: [
          W("reassignPlatformMatchIds（matcher_store.js:537；merge_client_matches.js:85 UI merge）", "changmen-esport", "verified", ["rds/rds/matcher_store.js:537", "server/match/matcher/ops/merge_client_matches.js:85"]),
          W("deletePlatformMatchRow（matcher_store.js:543）", "changmen-esport / offline-scripts", "verified", ["rds/rds/matcher_store.js:543", "server/backend/core/esport-api/store.js:291"], { note: "无 in-repo 调用方（仅注释引用）；导出 API，caller surface UNKNOWN" }),
        ],
      },
      {
        operation: "collector-prune-pf", target: "PF 行（DELETE → platform_matches_history）",
        ownershipScope: "operation", writerCardinality: "single",
        writers: [W("prunePredictFunPlatformMatches（platform_collector_store.js:810；predictfun loop.js:86,134）", "changmen-predictfun-collector", "verified-runtime-paused",
          ["rds/rds/platform_collector_store.js:810", "server/collectors/predictfun-collector/loop.js:86,134"], { note: "Phase 4 completeness regression 发现的遗漏写者（TE-2 同类），已补入" })],
      },
      {
        operation: "offline-ops-wipe", target: "PF 行（事故脚本 DELETE）",
        ownershipScope: "operation", writerCardinality: "single",
        writers: [W("wipe-pf-esport-matches.mjs（:141 DELETE FROM platform_matches）", "offline-scripts", "verified", ["server/backend/scripts/ops/incidents/wipe-pf-esport-matches.mjs:141"])],
      },
      {
        operation: "prune-orphan-archive", target: "orphan rows → platform_matches_history",
        ownershipScope: "operation", writerCardinality: "single",
        writers: [W("prunePolymarketPlatformMatches", "changmen-esport", "verified", ["rds/rds/platform_collector_store.js:740,115-120"])],
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  platform_bets: {
    kind: "table", persistence: "RDS platform_bets", multiInstanceAllowed: false,
    doc: "docs/DATA_STORAGE.md:10",
    operations: [
      {
        operation: "browser-ingest-write", target: "rows per match (full replace)",
        ownershipScope: "operation", writerCardinality: "multiple",
        writers: [W("esport-api/store.js saveBets → sb.replacePlatformBetsForMatch", "changmen-esport", "verified",
          ["server/backend/core/esport-api/router.ts:567", "server/backend/core/esport-api/store.js:313,337", "rds/rds/platform_collector_store.js:1050-1088"])],
        memoryFirst: "是（同 platform_matches）",
        note: "sticky 平台（PB/OB/RAY）空快照不清（platform_collector_store.js:15,38）",
      },
      {
        operation: "collector-write", target: "rows where platform=<vps-owned>（含 deleteOrphanPlatformBetsAsync 孤儿清理）",
        ownershipScope: "operation", writerCardinality: "multiple",
        writers: [
          W("polymarket-esports loop（replacePlatformBetsForMatchAsync）", "changmen-polymarket-collector", "verified", ["server/collectors/polymarket-esports/loop.js:66-69", "rds/rds/platform_collector_store.js:1062"]),
          W("predictfun-collector loop（replacePlatformBetsForMatchAsync）", "changmen-predictfun-collector", "verified-runtime-paused", ["server/collectors/predictfun-collector/loop.js:118,127,129", "rds/rds/platform_collector_store.js:1062"]),
          W("sxbet-collector loop（replacePlatformBetsForMatchAsync + deleteOrphanPlatformBetsAsync）", "changmen-sxbet-collector", "verified-runtime-paused", ["server/collectors/sxbet-collector/loop.js:74,84,85", "rds/rds/platform_collector_store.js:1062,1091"]),
        ],
        memoryFirst: "否（Async 直写）",
      },
      {
        operation: "offline-ops-wipe", target: "PF 行（事故脚本 DELETE）",
        ownershipScope: "operation", writerCardinality: "single",
        writers: [W("wipe-pf-esport-matches.mjs（:155 DELETE FROM platform_bets）", "offline-scripts", "verified", ["server/backend/scripts/ops/incidents/wipe-pf-esport-matches.mjs:155"])],
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  live_timers: {
    kind: "table", persistence: "RDS live_timers", multiInstanceAllowed: false,
    doc: "docs/DATA_STORAGE.md:11",
    operations: [
      {
        operation: "replace-per-platform", target: "rows per platform（全量替换）",
        ownershipScope: "table", writerCardinality: "single",
        writers: [W("store.saveLiveTimer → writeLiveTimersAsync (:1119, await)；fire-and-forget 变体 writeLiveTimers (:1108) 基本无活调用方", "changmen-esport", "verified",
          ["server/backend/core/esport-api/router.ts:577", "server/backend/core/esport-api/store.js:340,351-372", "rds/rds/platform_collector_store.js:1108,1119"])],
        memoryFirst: "否（await）；内存 _timers 先更新（store.js:373）",
        readers: ["matcher snapshot compose/io/snapshot.js:117", "启动回灌 server.js:146"],
      },
      {
        operation: "offline-ops-wipe", target: "PF 行（事故脚本 DELETE）",
        ownershipScope: "operation", writerCardinality: "single",
        writers: [W("wipe-pf-esport-matches.mjs（:159 DELETE FROM live_timers）", "offline-scripts", "verified", ["server/backend/scripts/ops/incidents/wipe-pf-esport-matches.mjs:159"])],
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  client_matches: {
    kind: "table", persistence: "RDS client_matches（history 表：migrations/014_history_tables.sql:5）",
    multiInstanceAllowed: false,
    doc: "docs/DATA_STORAGE.md:12（单写路径宣称——见 conflict F-02）",
    operations: [
      {
        operation: "compose-upsert-main", target: "rows（active upsert + ended patch；UPSERT 用 COALESCE 保留 pm_sport 列）",
        ownershipScope: "operation", writerCardinality: "single",
        writers: [
          W("@changmen/matcher composeOnce → writeClientMatchesAsync（client_matches_store.js:280；sync 兜底 writeClientMatches :270）", "changmen-esport", "verified",
            ["server/match/matcher/ops/match_merge_once.js:116", "server/match/matcher/compose/compose_once.js:144", "server/match/matcher/compose/io/write.js:16", "rds/rds/client_matches_store.js:270,280"],
            { mutualExclusion: "进程内 _matchMergeInFlight Promise（match_merge_once.js:115-128）+ write_guard pid 心跳（write_guard.js:41-50，非 DB 锁，不约束本表其他 operation 写者）" }),
        ],
        memoryFirst: "否（Async 直写；无 pool 降级 fire-and-forget :286）",
        archive: "archive_stale.js 默认 client scope = no-op（:117）；ALL scope 才搬 history（:41-51）",
      },
      {
        operation: "compose-id-stub-insert", target: "新行（INSERT stub，合场 id 分配；UI 人工建新场也走它）",
        ownershipScope: "operation", writerCardinality: "multiple",
        writers: [
          W("insertClientMatchStub（matcher_store.js:116 → :48 Rds；compose 内经 identity/ids/client_match_ids.js:127 调用）", "changmen-esport", "verified",
            ["rds/rds/matcher_store.js:48,116", "server/match/identity/ids/client_match_ids.js:127"]),
          W("UI 人工 link 建 stub：ensureClientMatchId（link/index.js:359）", "changmen-esport", "verified", ["server/match/matcher/link/index.js:359"]),
        ],
        note: "Phase 3 发现的遗漏写者（TE-2），Phase 4 已补入",
      },
      {
        operation: "prune-ended-mark", target: "行级 ended_at（UPDATE WHERE start_time < cutoff）",
        ownershipScope: "operation", writerCardinality: "multiple",
        writers: [
          W("markClientMatchesEndedByStartBefore（platform_collector_store.js:908，经 pruneMatchesOlderThanCollectPast :935）— matcher 循环", "changmen-esport", "verified",
            ["rds/rds/platform_collector_store.js:908,935", "server/match/matcher/loop.js:27"]),
          W("同函数 — 独立 composer 循环（默认被 write_guard 拒绝写，但 prune 调用仍在代码路径中）", "changmen-esport (compose loop, guarded)", "verified",
            ["server/match/matcher/compose/loop.js:35"]),
          W("同函数 — predictfun collector 循环", "changmen-predictfun-collector", "verified-runtime-paused", ["server/collectors/predictfun-collector/loop.js:146"]),
          W("同函数 — sxbet collector 循环", "changmen-sxbet-collector", "verified-runtime-paused", ["server/collectors/sxbet-collector/loop.js:90"]),
        ],
        note: "Phase 3 发现的遗漏写者（TE-2），Phase 4 已补入；与 compose 主写者无互斥",
      },
      {
        operation: "update-pm_sport-field", target: "field pm_sport (jsonb)",
        ownershipScope: "field", writerCardinality: "single",
        writers: [W("polymarket-sports daemon updateClientMatchPmSport", "changmen-pm-sports", "verified",
          ["server/collectors/polymarket-sports/index.js:37", "rds/rds/pm_sport_store.js:74"])],
        readers: ["matcher ended_filter compose/shape/ended_filter.js", "ws hub pushPmSportToBrowsers → realtime-hub", "Client_GetMatchs rev（fetchClientMatchesMeta）"],
        docGap: "docs/DATA_STORAGE.md 未单列该 field 写者（missing M-06）",
      },
      {
        operation: "manual-row-ops", target: "行级（matchs patch / 翻锁 / forceEnd / restore / 删行 / merge）",
        ownershipScope: "operation", writerCardinality: "multiple",
        writers: [
          W("patchClientMatchMatchs（matcher_store.js:192；link/index.js:521,751 人工连线）", "changmen-esport", "verified", ["rds/rds/matcher_store.js:192", "server/match/matcher/link/index.js:521,751", "server/match/matcher/ui/api_routes.js"]),
          W("swapClientMatchGbOrientation（matcher_store.js:317）", "changmen-esport", "verified", ["rds/rds/matcher_store.js:317", "server/match/matcher/ui/api_routes.js:210"]),
          W("forceEndClientMatch（matcher_store.js:462；ops/delete_client_match.js:21）", "changmen-esport", "verified", ["rds/rds/matcher_store.js:462", "server/match/matcher/ops/delete_client_match.js"]),
          W("clearClientMatchEndedAt（matcher_store.js:483；ops/restore_client_match.js:30）", "changmen-esport", "verified", ["rds/rds/matcher_store.js:483", "server/match/matcher/ops/restore_client_match.js:30"]),
          W("deleteClientMatchRow（matcher_store.js:557；merge/ops 入口）", "changmen-esport", "verified", ["rds/rds/matcher_store.js:557", "server/match/matcher/ops/merge_client_matches.js:86"]),
        ],
        trigger: "人工/UI 触发，随后通常 matchMergeOnce(afterInFlight) 重跑合场",
      },
      {
        operation: "dead-code-writes", target: "行（无调用方的残留写能力）",
        ownershipScope: "unknown", writerCardinality: "unknown",
        writers: [
          W("saveClientMatches → fire-and-forget writeClientMatches（core/db/store.js:358，全仓无调用方）", "changmen-esport", "dead-code", ["server/backend/core/db/store.js:358"]),
          W("setClientMatchPlatformReverse（matcher_store.js:225，无调用方）", "changmen-esport", "dead-code", ["rds/rds/matcher_store.js:225"]),
          W("archiveClientMatch（matcher_store.js:497，deprecated 别名）", "changmen-esport", "dead-code", ["rds/rds/matcher_store.js:497"]),
        ],
      },
      {
        operation: "offline-ops-writes", target: "行（离线/事故脚本，非运行时路径）",
        ownershipScope: "operation", writerCardinality: "multiple",
        writers: [
          W("wipe-pf-esport-matches.mjs（直接 SQL：matchs 剥 PF + 空 matchs 行标 ended）", "offline-scripts", "verified", ["server/backend/scripts/ops/incidents/wipe-pf-esport-matches.mjs:163-171"]),
          W("archive_stale --all scope（ended 行 DELETE → client_matches_history）", "changmen-esport (scheduled/manual)", "verified", ["rds/archive_stale.js:41-51,89-101,117"]),
        ],
        note: "非生产常驻路径；登记为完整性的边界事实",
      },
    ],
    conflicts: ["F-02"],
    ownershipNote: "禁止建模为 table-level single writer：7 类 operation、writerCardinality 混合（single/multiple/unknown）。Phase 4 重扫（grep 全部 INSERT/UPDATE/DELETE ON client_matches + 全部 store 导出函数）确认本清单穷尽静态 SQL；动态 SQL 拼接不在检测边界内。",
    status: "conflicted", derivation: "audit-code-review-2026-09-19",
  },
  orders: {
    kind: "table", persistence: "RDS orders（migration 001:38）", multiInstanceAllowed: false,
    doc: "docs/DATA_STORAGE.md:18（仅电竞）",
    operations: [
      {
        operation: "upsert", target: "rows keyed (player, orderId)",
        ownershipScope: "table", writerCardinality: "multiple",
        writers: [
          W("order_store.saveOrder（前置 strict 读防覆盖 :191-194）", "changmen-esport", "verified", ["server/backend/core/account/order_store.js:161", "rds/rds/orders_store.js:224"]),
          W("order_store.updateOrderBind / rebindOrderLink", "changmen-esport", "verified", ["server/backend/core/account/order_store.js:1178,1229"]),
          W("PF 集成 pf_server_order", "changmen-esport", "verified", ["server/backend/core/integrations/predictfun/pf_server_order.js:17"]),
          W("admin 删除 deleteOrdersByIds / deletePolymarketSellOrders", "changmen-esport", "verified", ["rds/rds/orders_store.js:1020,1045", "server/backend/core/admin_tools/admin_orders.js:247"]),
          W("ops 迁移脚本", "offline-scripts", "verified", ["server/backend/scripts/ops/"]),
        ],
        memoryFirst: "否（全 await）",
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  football_orders: {
    kind: "table", persistence: "RDS football_orders（migration 040/041；DDL 内联 store :7-46）", multiInstanceAllowed: false,
    doc: "docs/DATA_STORAGE.md:19",
    operations: [
      {
        operation: "upsert", target: "rows keyed (user_id, client_id) ON CONFLICT 覆盖",
        ownershipScope: "table", writerCardinality: "multiple",
        writers: [
          W("football_order_service.saveFootballOrder（入口 football_order_routes.js:30）", "changmen-esport", "verified", ["server/backend/core/football/football_order_service.js:41", "rds/rds/football_orders_store.js:81"]),
          W("结算回写 patchFootballOrderStatus", "changmen-esport", "verified", ["rds/rds/football_orders_store.js:166"]),
        ],
        memoryFirst: "否",
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  platforms_json: {
    kind: "file", persistence: "本地 ESPORT_DATA_DIR/platforms.json（默认 server/backend/storage，paths.js:44-49）",
    multiInstanceAllowed: false,
    doc: "docs/DATA_STORAGE.md:30,79",
    operations: [
      {
        operation: "setPlatform", target: "整个文件（同步 writeJsonFile）",
        ownershipScope: "file", writerCardinality: "single",
        writers: [
          W("platform_sync 启动种子（server.js:92-120）", "changmen-esport", "verified", ["server/backend/server.js:92-120", "server/storage/platform_storage.js:13"]),
          W("API_UpdatePlatform（router.ts:548-554）", "changmen-esport", "verified", ["server/backend/core/esport-api/router.ts:548-554"]),
          W("TF 探针写（router.ts:498）", "changmen-esport", "verified", ["server/backend/core/esport-api/router.ts:498"]),
        ],
        memoryFirst: "否（同步落盘）；文件级无锁，靠单实例冻结保证",
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  esport_hot_cache: {
    kind: "memory", persistence: "仅内存（store.js:54 注释：已替代 matches/bets/live_timers JSON）", multiInstanceAllowed: false,
    doc: "docs/DATA_STORAGE.md:37",
    operations: [
      {
        operation: "hot-snapshot-maintain", target: "_matches/_bets/_timers",
        ownershipScope: "table", writerCardinality: "single",
        writers: [W("esport-api/store.js saveMatches/saveBets/saveLiveTimer + hydrateCollectorHotSnapshot + patchCollectorMatchClientIds", "changmen-esport", "verified",
          ["server/backend/core/esport-api/store.js:204,313,340,512,272"])],
        memoryFirst: "是（纯内存；重启从 RDS 回灌 server.js:144-161）",
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  profiles_players_memory: {
    kind: "memory", persistence: "内存镜像 RDS profiles/players；写穿透 sb.writeProfileAsync + _restoreRow 回滚（core/db/store.js:20-26,100-106）",
    multiInstanceAllowed: false,
    doc: "docs/ACCOUNT_BACKEND.md（players 唯一真相）——与 CLAUDE.md:163,268 冲突（F-01）",
    operations: [
      {
        operation: "write-through", target: "_cache / _accountsCache",
        ownershipScope: "table", writerCardinality: "single",
        writers: [W("core/db/store.js（pullProfilesFromDb:118 / upsertProfile:74 / replaceAccountsForUser:205）", "changmen-esport", "verified",
          ["server/backend/core/db/store.js:12,74,110,118,205,253"])],
        memoryFirst: "否（写穿透+回滚）",
      },
    ],
    conflicts: ["F-01"],
    status: "conflicted", derivation: "audit-code-review-2026-09-19",
  },
  client_matches_memory_cache: {
    kind: "memory", persistence: "内存镜像 RDS client_matches；built_at 签名键 + MATCHES_CACHE_MAX_AGE_MS=90s（core/db/store.js:310-329）",
    multiInstanceAllowed: false,
    doc: "docs/DATA_STORAGE.md:37",
    operations: [
      {
        operation: "cache-maintain", target: "_clientMatches",
        ownershipScope: "table", writerCardinality: "single",
        writers: [W("setClientMatchesFromMatchMerge / _applyClientMatchRows / 人工 patch/remove", "changmen-esport", "verified",
          ["server/backend/core/db/store.js:310,329,408,429,438"])],
        memoryFirst: "是（可重建）",
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  market_index_jsons: {
    kind: "file", persistence: "本地 ESPORT_DATA_DIR/{polymarket,predictfun,sxbet}_market_index.json（同步写）",
    multiInstanceAllowed: true,
    doc: "docs/DATA_STORAGE.md:31（未含 sxbet 专条）",
    operations: [
      {
        operation: "write", target: "每 collector 一个文件",
        ownershipScope: "file", writerCardinality: "single",
        writers: [
          W("polymarket-esports market_index.js", "changmen-polymarket-collector", "verified", ["server/collectors/polymarket-esports/market_index.js", "server/storage/polymarket_market_index.js"]),
          W("predictfun-collector market_index.js", "changmen-predictfun-collector", "verified-runtime-paused", ["server/collectors/predictfun-collector/", "server/storage/predictfun_market_index.js"]),
          W("sxbet-collector market_index.js", "changmen-sxbet-collector", "verified-runtime-paused", ["server/collectors/sxbet-collector/", "server/storage/sxbet_market_index.js"]),
        ],
        readers: ["Client_GetCollectPlatform MarketIndex（router.ts:57-66）", "compose normalize/native_bets.js（PF）"],
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  sport_client_matches: {
    kind: "table", persistence: "RDS sport_client_matches（+history +venue_overrides，migration 033）",
    multiInstanceAllowed: false,
    doc: "docs/DATA_STORAGE.md:14 vs :81 自相矛盾（F-03）",
    operations: [
      {
        operation: "replaceSportClientMatches", target: "rows（ON CONFLICT upsert + 旧行搬 history store :115）",
        ownershipScope: "table", writerCardinality: "single",
        writers: [W("sport_merge.js（由 GetBaseball/Football/Tennis/Basketball 请求触发）", "changmen-esport", "verified",
          ["server/match/matcher/ops/sport_merge.js:534", "rds/rds/sport_client_matches_store.js:49,115,144"])],
        memoryFirst: "否",
      },
    ],
    conflicts: ["F-03"],
    status: "conflicted", derivation: "audit-code-review-2026-09-19",
  },
  value_signals: {
    kind: "table", persistence: "RDS value_signals",
    multiInstanceAllowed: true,
    doc: "无专条文档（missing M-12）",
    operations: [
      {
        operation: "upsert/expire", target: "rows",
        ownershipScope: "table", writerCardinality: "single",
        writers: [W("value-bet engine（scanOnce 循环 upsertSignals/expireStaleSignals）", "value-bet (manual)", "verified",
          ["server/value-bet/value-bet.js", "server/value-bet/db/signal_store.js:17,63,111"])],
        memoryFirst: "否",
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
  default_odds_json: {
    kind: "file", persistence: "本地 ESPORT_DATA_DIR/default_odds.json（writeJsonFileDebounced 5s）",
    multiInstanceAllowed: false,
    doc: "—",
    operations: [
      {
        operation: "debounced-write", target: "整个文件",
        ownershipScope: "file", writerCardinality: "single",
        writers: [W("defaultOddsApi（store.js:62-64 → json_file_store.js:32）", "changmen-esport", "verified",
          ["server/backend/core/esport-api/store.js:62-64", "server/storage/json_file_store.js:32"])],
        memoryFirst: "是（debounce 合并，崩溃可丢 5s 窗口）",
      },
    ],
    status: "verified", derivation: "audit-code-review-2026-09-19",
  },
};

// ---------------------------------------------------------------- superseded facts (TE-1)
// Historical audit facts that Phase 2/4 deliverables have superseded. Never served as
// current truth by the Resolver; preserved as historical evidence.
const superseded = {
  "M-01": {
    claim: "runtime→capability 映射无 registry、无文档等价物（audit §11 Missing Truths M-01）",
    supersededBy: ".ai/architecture/index.json runtimes[].hosts / capabilities[].hostedBy（Phase 2）",
    status: "superseded",
    historicalEvidence: ["docs/ARCHITECTURE_TRUTH_AUDIT.md §11 M-01"],
    note: "历史审计结论；当前真相见 index.json capabilities/runtimes 节",
  },
  "M-02": {
    claim: "capability→state 归属无机器可读表（audit §11 Missing Truths M-02）",
    supersededBy: ".ai/architecture/index.json capabilities[].ownsOperations → resources（Phase 2）",
    status: "superseded",
    historicalEvidence: ["docs/ARCHITECTURE_TRUTH_AUDIT.md §11 M-02"],
  },
  "M-03": {
    claim: "默认启动集/暂停集无机器可读声明（audit §11 Missing Truths M-03）",
    supersededBy: ".ai/architecture/index.json runtimes[].defaultDeployed / pausedByDeployScript（Phase 2，机械解析 deploy-server-remote.sh）",
    status: "superseded",
    historicalEvidence: ["docs/ARCHITECTURE_TRUTH_AUDIT.md §11 M-03"],
  },
  "M-11": {
    claim: "平台清单 9 处副本无全量 drift 检查（audit §11 Missing Truths M-11「平台清单副本 drift 检查缺失」）",
    supersededBy: "npm run check:index-drift（Phase 2 交付；PLATFORM_REGISTRY + PM2_REGISTRY 对账）",
    status: "superseded",
    historicalEvidence: ["docs/ARCHITECTURE_TRUTH_AUDIT.md §11 M-11", "docs/ARCHITECTURE_TRUTH_AUDIT.md §9 R-1"],
    note: "TE-1 实证：该旧结论在 Phase 3 实验中 actively 误导过 baseline 会话；禁止作为当前事实输出。当前遗留问题已改为 7 处 DRIFT 的处置口径问题（§10 待裁决），与「检查是否存在」无关",
  },
};

// ---------------------------------------------------------------- conflicts (first-class)
const C = (id, topic, sources, likelyCanonicalLayer, note) => ({
  id, topic, status: "conflicted", sources,
  likelyCanonicalLayer, likelyCanonicalNote: "evidence-derived judgment, not verified truth",
  humanDecisionRequired: true, resolution: null, derivation: "audit-phase-1", note,
});
const conflicts = {
  "F-01": C("F-01", "账号存储模型（players vs profiles.accounts jsonb）", [
    { layer: "code", says: "players 表为唯一真相；profiles.accounts jsonb 已弃写（028 backfill 后运行时不再读写）", evidence: ["rds/player_account_record.js", "rds/venue_account_key.js", "docs/ACCOUNT_BACKEND.md:15-26"] },
    { layer: "docs", says: "账号 → RDS profiles.accounts jsonb", evidence: ["CLAUDE.md:163", "CLAUDE.md:268"] },
  ], "code", "建议人工修订 CLAUDE.md 两行"),
  "F-02": C("F-02", "client_matches 写者范围（单写者宣称 vs operation/field 级多写者）", [
    { layer: "code", says: "7 类 operation 写者（Phase 4 重扫）：compose 主写/compose stub insert/prune ended/pm_sport 列/UI 人工/死代码/离线 ops；详见 index.json resources.client_matches.operations", evidence: ["rds/rds/client_matches_store.js:270,280", "rds/rds/matcher_store.js:48,116,192,317,462,483,557", "rds/rds/platform_collector_store.js:908,935", "rds/rds/pm_sport_store.js:74", "server/backend/core/db/store.js:358", "server/backend/scripts/ops/incidents/wipe-pf-esport-matches.mjs:163-171", "rds/archive_stale.js:41-51"] },
    { layer: "docs", says: "生产唯一 writer = matchMergeOnce → composeOnce", evidence: ["server/match/matcher/README.md:47"] },
  ], "code", "Phase 4 已把 code 侧 writers 全量结构化（TE-2 FIXED）；文档侧措辞仍待人工裁决"),
  "F-03": C("F-03", "sport_client_matches 读路径（文档内部矛盾）", [
    { layer: "code", says: "backend router 未接入 sport_client_matches 读路径；GetBaseball 等 = M+J 不读写 RDS 赛表", evidence: ["rds/rds/sport_client_matches_store.js", "grep: router 无接入"] },
    { layer: "docs", says: "读方=GetBaseball/FootballMatchs（:14）vs M+J 不读写（:81）", evidence: ["docs/DATA_STORAGE.md:14", "docs/DATA_STORAGE.md:81"] },
  ], "code", ":14 为未标注的目标态"),
  "F-04": C("F-04", "CHANGMEN_LAYOUT.baseball 键指向不存在的根目录 baseball/", [
    { layer: "registry", says: "paths.js:24 键 baseball 存在；全仓零消费者；目录不存在", evidence: ["server/storage/paths.js:24"] },
    { layer: "docs", says: "登记为「棒球代码目录」", evidence: ["docs/PATH_REGISTRY.md:45"] },
  ], "registry", "键为遗留"),
  "F-05": C("F-05", "baseball sharedPackages 数量（2 vs 4）", [
    { layer: "registry", says: "lines/baseball/line.json = 4 个包", evidence: ["lines/baseball/line.json"] },
    { layer: "docs", says: "= 2 个", evidence: ["docs/PATH_REGISTRY.md:102-104"] },
  ], "registry", null),
  "F-06": C("F-06", "sport_catalog.json 接入状态（文档内部张力）", [
    { layer: "checks", says: "sport_catalog_smoke.test.ts 在 npm test 链；listActiveSports() 已导出", evidence: ["scripts/catalog-smoke.mjs", "packages/shared/catalog/sport_catalog.ts"] },
    { layer: "docs", says: "「草案，尚未接入运行时」（:10）vs「阶段 1 已完成」（:195-202）", evidence: ["docs/CATALOG.md:10", "docs/CATALOG.md:195-202"] },
  ], "checks", "「运行时接入」定义需人工澄清"),
  "F-07": C("F-07", "server/backend/scripts 根目录规模（9 个冻结入口 vs 实际 15）", [
    { layer: "code", says: "根目录实际 15 个 js/mjs", evidence: ["server/backend/scripts/"] },
    { layer: "docs", says: "根 9 个冻结入口", evidence: ["docs/SPORTS_PRODUCT_LINES.md:60", "docs/ARCHITECTURE.md:70"] },
  ], "code", null),
  "F-08": C("F-08", "basketball 产品线未登记（5 条 line vs README 4 条）", [
    { layer: "registry", says: "lines/basketball/line.json 存在；lines/ 共 5 条", evidence: ["lines/basketball/line.json"] },
    { layer: "docs", says: "lines/README.md 只列 4 条；CATALOG 草案无 tennis/basketball", evidence: ["lines/README.md:14-19", "docs/CATALOG.md"] },
  ], "registry", null),
  "F-09": C("F-09", "packages/shared 不在根 workspaces glob（lockfile 遗留 link 维持解析）", [
    { layer: "registry", says: "根 package.json workspaces 无 packages/shared；lockfile 有遗留 link 条目", evidence: ["package.json:9-28", "package-lock.json:1067-1070"] },
    { layer: "docs", says: "「npm workspace 成员」", evidence: ["docs/ARCHITECTURE.md:103"] },
  ], "registry", "一行 glob 或文档修正，二选一；fresh npm install 行为需人工验证"),
  "F-10": C("F-10", "paths.js/load_env.js 所属包（@changmen/db vs @changmen/storage）", [
    { layer: "code", says: "两文件实际在 server/storage/（其 package.json exports 含）", evidence: ["server/storage/paths.js", "server/storage/load_env.js", "server/storage/package.json"] },
    { layer: "docs", says: "数据层与路径解析见 @changmen/db（paths.js、load_env.js）", evidence: ["docs/ARCHITECTURE.md:102"] },
  ], "code", null),
  "F-11": C("F-11", "子包清单陈旧（matcher archive/、collectors 4 vs 2、packages 漏 arb-core）", [
    { layer: "code", says: "matcher 顶层无 archive/；collectors 有 4 包；packages/ 有 4 个（含 arb-core）；server/ 有 4 个仅 node_modules 的空壳目录", evidence: ["server/match/matcher/", "server/collectors/", "packages/"] },
    { layer: "docs", says: "ARCHITECTURE:16,34-37,152；server/README:48-50 的旧清单", evidence: ["docs/ARCHITECTURE.md", "server/README.md"] },
  ], "code", null),
  "F-12": C("F-12", "storage 路径表述（storage/legacy/esport vs 默认 server/backend/storage）", [
    { layer: "code", says: "默认 ESPORT_DATA_DIR=STORAGE_DIR=server/backend/storage；代码中无 legacy 路径段", evidence: ["server/storage/paths.js:44-49"] },
    { layer: "docs", says: "storage/legacy/esport/*.json；storage/platforms.json", evidence: ["CLAUDE.md:166", "docs/DATA_STORAGE.md:30"] },
  ], "code", "生产 VPS env 实际值为 UNKNOWN（本审计不读取 VPS .env）"),
  "F-13": C("F-13", "CODEOWNERS 模板路径过时", [
    { layer: "code", says: ".github/CODEOWNERS 不存在；模板中 /changmen/client/chrome-extension/、/changmen/client/platform-adapter/ 均非真实路径", evidence: [".github/", "docs/CODEOWNERS.example"] },
    { layer: "docs", says: "复制模板到 .github/CODEOWNERS", evidence: ["docs/TEAM_BOUNDARIES.md:121-125"] },
  ], "code", null),
  "F-14": C("F-14", "backend 采集 CLI 转发 scripts（17 条）未在 server/README 命令表列出", [
    { layer: "code", says: "backend package.json:18-38 有 17 条 ob:*/ray:*/pb:* 转发", evidence: ["server/backend/package.json"] },
    { layer: "docs", says: "server/README.md:69-79 命令表未列", evidence: ["server/README.md"] },
  ], "code", null),
  "F-15": C("F-15", "esport-freeze 闸门存在但零文档记载", [
    { layer: "code", says: "check-esport-freeze.mjs + esport-freeze.json（22 路径）在 check:venue-adapter 链运行，默认拒绝", evidence: ["packages/venue-adapter/scripts/check-esport-freeze.mjs", "packages/venue-adapter/esport-freeze.json"] },
    { layer: "docs", says: "所有已读文档零记载", evidence: ["docs/（无）"] },
  ], "code", null),
};

// ---------------------------------------------------------------- contracts / sources / lines / rules
const actionsTs = readText("packages/api-contract/src/actions.ts");
function actionArrayOf(name) {
  const i = actionsTs.indexOf(name);
  if (i < 0) return [];
  const seg = actionsTs.slice(i, actionsTs.indexOf("]", i));
  return [...new Set((seg.match(/"[A-Za-z_][A-Za-z0-9_]*"/g) || []).map((x) => x.replace(/"/g, "")))]
    .filter((x) => /^(Client_|API_|Pm_|Pf_|SendMessage)/.test(x));
}
const esportActions = actionArrayOf("ESPORT_ACTIONS");
const coreActions = actionArrayOf("CORE_INTEGRATION_ACTIONS");
const urlsMjs = readText("packages/api-contract/urls.mjs");
const prefixMatch = urlsMjs.match(/ESPORT_PATH_PREFIX\s*=\s*"([^"]+)"/);
const manifest = readJson("packages/venue-adapter/registry/manifest.json");
const freezeJson = readJson("packages/venue-adapter/esport-freeze.json");

const sources = {
  workspaces: { path: "package.json (workspaces)", manages: "workspace 成员清单", canonical: true, machineReadable: true, verification: "npm/turbo 解析（已知缺口 F-09）", status: "verified", derivation: "generated" },
  pm2Manifest: { path: "deploy/ecosystem.config.cjs", manages: "PM2 进程清单（9 app）", canonical: true, machineReadable: true, verification: "无自动校验；deploy bash 消费", consumers: ["PM2", "deploy/scripts/deploy-server-remote.sh"], status: "verified", derivation: "generated" },
  layout: { path: "server/storage/paths.js (CHANGMEN_LAYOUT)", manages: "monorepo 目录布局与 storage 路径", canonical: true, machineReadable: true, verification: "server/storage/paths_smoke.test.mjs（经 scripts/catalog-smoke.mjs）", consumers: ["check-team-boundaries.mjs", "venue-adapter loader", "vite.config.ts", "platform-probes"], conflicts: ["F-04"], status: "verified", derivation: "generated" },
  pathRegistryDoc: { path: "docs/PATH_REGISTRY.md", manages: "CHANGMEN_LAYOUT 的手工文档镜像", canonical: false, machineReadable: false, verification: "无（双登记无同步脚本）", status: "verified-derivative-manual", derivation: "generated" },
  platformManifest: { path: "packages/venue-adapter/registry/manifest.json", manages: `平台能力开关（${manifest.length} 平台）`, canonical: true, machineReadable: true, verification: "DEV 自检 console.warn（非 CI）+ meta.browserSave.test.ts；drift 见 drift.platformRegistry", consumers: ["adapters.ts", "meta.ts", "feeds.js", "backend registry/feeds.js", "gen-platform-icons-css.mjs"], status: "verified", derivation: "generated" },
  catalog: { path: "packages/shared/catalog/*.json", manages: "sport/game/market catalog", canonical: true, machineReadable: true, verification: "market/game/sport_catalog_smoke.test.ts（npm test 链）", status: "verified", derivation: "generated" },
  apiContract: { path: "packages/api-contract/src/actions.ts", manages: `HTTP action 契约（ESPORT_ACTIONS ${esportActions.length}；CORE_INTEGRATION_ACTIONS ${coreActions.length} 为子集）`, canonical: true, machineReadable: true, verification: "urls.test.mjs + action_registry.test.mjs", status: "verified", derivation: "generated" },
  esportFreeze: { path: "packages/venue-adapter/esport-freeze.json", manages: `电竞业务冻结面（${freezeJson.paths.length} 条路径）`, canonical: true, machineReadable: true, verification: "check-esport-freeze.mjs（git-diff gate，ALLOW_ESPORT_TOUCH=1 旁路）", conflicts: ["F-15"], status: "verified-undocumented-in-docs", derivation: "generated" },
  linesManifest: { path: "lines/*/line.json", manages: "产品线锚点 manifest（5 条，basketball 未进 README — F-08）", canonical: "partial（机器可读但零运行时代码消费）", machineReadable: true, verification: "无自动校验", conflicts: ["F-08"], status: "verified", derivation: "generated" },
  ecosystemDocCopies: { path: "lines/esport/line.json pm2Apps + sport_catalog.json pm2Apps", manages: "PM2 进程名的手工镜像副本", canonical: false, machineReadable: true, verification: "无（drift 见 drift.pm2Registry）", status: "verified-duplicate-risk", derivation: "generated" },
};

const contracts = {
  http_actions: {
    provider: "server/backend（handleEsportRequest）", consumer: "client/web（api/client.ts post()）",
    definition: `packages/api-contract/src/actions.ts（ESPORT_ACTIONS ${esportActions.length}；CORE_INTEGRATION_ACTIONS ${coreActions.length} 为子集）`,
    validation: ["packages/api-contract/urls.test.mjs", "server/backend/core/esport-api/action_registry.test.mjs"],
    status: "verified", derivation: "generated",
  },
  http_path_prefix: {
    definition: `ESPORT_PATH_PREFIX=${prefixMatch ? prefixMatch[1] : "UNKNOWN"}`,
    evidence: ["packages/api-contract/urls.mjs", "server/backend/http_routes.js"],
    status: "verified", derivation: "generated",
  },
  ws_realtime_push: {
    provider: "realtime-hub（内嵌 changmen-esport）", consumer: "client/web Socket.IO 客户端",
    definition: "频道 Polymarket:PmSport；path /esport/realtime/socket.io；握手必带 token；内部广播入口 POST /esport/internal/broadcast/pm-sport 仅 loopback",
    evidence: ["server/realtime-hub/channels.js:1,3,6", "server/backend/http_routes.js:365", "server/realtime-hub/internal_http.js:11-17"],
    status: "verified", derivation: "generated",
  },
  ws_forward_relay: {
    provider: "ws_forward（内嵌 engine + 独立 hubs）", consumer: "client/web / chrome-extension",
    definition: "浏览器路径前缀 /esport/ws-forward/*；内嵌默认平台 IA/OB/RAY/PM-USER；PM-MARKET/PREDICTFUN-MARKET 由独立 hub 进程承载",
    evidence: ["server/ws_forward/index.js:22,51-63", "server/backend/server.js:72,85"],
    status: "verified", derivation: "generated",
  },
  http_proxies: {
    provider: "changmen-esport",
    endpoints: ["/esport/http-relay", "/esport/pb/proxy", "/esport/ob/proxy", "/esport/ray/proxy", "/esport/ia/proxy"],
    evidence: ["server/backend/http_routes.js:374-382", "server/backend/proxy/README.md"],
    status: "verified", derivation: "generated",
  },
  adapter_loader_abi: {
    provider: "packages/venue-adapter/loader/adapter_paths.mjs",
    consumer: ["server/backend（requirePlatform）", "server/match/resolver（scrapers）"],
    definition: "解析顺序 GAMEBET_ADAPTER_ROOT → packages/venue-adapter → server/backend/platform_adapter（瘦包，gitignored 派生物）；node 模式 → devtools/platform-probes（瘦包 platform_node）",
    evidence: ["packages/venue-adapter/loader/adapter_paths.mjs", "docs/ARCHITECTURE.md:113-117", "docs/TEAM_BOUNDARIES.md:25-29,97"],
    versioned: false,
    status: "verified-unversioned", derivation: "generated",
  },
  db_table_rw: {
    definition: "表级读/写矩阵的机器可读形式 = 本 index 的 resources 节（audit 派生）；散文原文在 docs/DATA_STORAGE.md:7-22",
    status: "derived", derivation: "audit-code-review-2026-09-19",
  },
};

const linesDir = path.join(ROOT, "lines");
const lines = {};
const linesReadme = readText("lines/README.md");
for (const e of fs.readdirSync(linesDir, { withFileTypes: true })) {
  if (!e.isDirectory() || !fs.existsSync(path.join(linesDir, e.name, "line.json"))) continue;
  const lj = readJson(`lines/${e.name}/line.json`);
  lines[lj.code ?? e.name] = {
    status: lj.status ?? null,
    kind: lj.kind ?? null,
    linePath: lj.linePath ?? null,
    pm2Apps: lj.pm2Apps ?? [],
    actions: lj.actions ?? [],
    registeredInLinesReadme: linesReadme.includes(e.name),
    source: `lines/${e.name}/line.json`,
    evidence: [`lines/${e.name}/line.json`, "lines/README.md"],
    derivation: "generated",
    statusCheck: "verified",
  };
}

const rules = {
  team_boundaries: {
    enforcement: "scripts/check-team-boundaries.mjs（6 组 RULES :20-95）",
    chain: "根 npm test 第 1 环",
    appliesTo: "all-modules",
    doc: "docs/TEAM_BOUNDARIES.md",
    status: "verified", derivation: "generated",
  },
  venue_adapter_imports: {
    enforcement: "packages/venue-adapter/scripts/{sync-package-exports,relativize-internal-imports,list-web-venue-imports}.mjs --check",
    chain: "check:venue-adapter 第 1–3 环",
    appliesTo: "@changmen/venue-adapter, @changmen/web",
    status: "verified", derivation: "generated",
  },
  esport_freeze_gate: {
    enforcement: `packages/venue-adapter/scripts/check-esport-freeze.mjs（git-diff gate，消费 esport-freeze.json ${freezeJson.paths.length} 路径，ALLOW_ESPORT_TOUCH=1 旁路）`,
    chain: "check:venue-adapter 第 4 环",
    appliesTo: "polymarket, predictfun, client-core bridge, web odds/match stores",
    documented: false,
    conflicts: ["F-15"],
    status: "verified-undocumented-in-docs", derivation: "generated",
  },
  client_core_imports: {
    enforcement: "packages/client-core/scripts/{sync-package-exports,relativize-internal-imports,list-consumer-imports}.mjs --check",
    chain: "check:client-core",
    appliesTo: "@changmen/client-core",
    status: "verified", derivation: "generated",
  },
  api_contract_urls: {
    enforcement: "packages/api-contract/urls.test.mjs",
    chain: "根 npm test 第 4 环",
    appliesTo: "http_actions",
    status: "verified", derivation: "generated",
  },
  catalog_smoke: {
    enforcement: "scripts/catalog-smoke.mjs（20 步，含 esport_isolation_audit.smoke.test.mjs）",
    chain: "根 npm test 第 5 环",
    appliesTo: "catalog, layout, storage paths, esport-api",
    status: "verified", derivation: "generated",
  },
  compose_no_merge_import: {
    enforcement: "server/match/matcher/scripts/check-no-merge-import.mjs（防 compose 反向依赖调度侧）",
    chain: "matcher test script",
    appliesTo: "@changmen/matcher compose/",
    status: "verified", derivation: "generated",
  },
  audit_client_sources: {
    enforcement: "server/match/matcher/scripts/audit-client-sources.mjs（DB 与 rebuild 一致性巡检）",
    chain: "手动（npm run audit:client-sources），不在 npm test 链",
    appliesTo: "client_matches",
    status: "verified-manual-only", derivation: "generated",
  },
  index_drift: {
    enforcement: "node .ai/architecture/build-index.mjs --check（本仓库脚本 npm run check:index-drift）",
    chain: "手动/可选",
    appliesTo: "platform registry, pm2 registry",
    status: "verified", derivation: "generated",
  },
  truth_completeness: {
    enforcement: "node .ai/architecture/check-truth-completeness.mjs（npm run check:index-completeness）",
    chain: "手动/可选",
    appliesTo: "resources client_matches, platform_matches, platform_bets, live_timers",
    note: "静态符号级对账；动态 SQL 拼接不在检测边界内（不声称 100% 覆盖）",
    status: "verified", derivation: "generated",
  },
  ci_gating: {
    enforcement: "无：.github/workflows/ 仅 deploy.yml，架构 gate 只在本地/turbo test 链",
    status: "verified-gap", derivation: "generated",
  },
};

// ---------------------------------------------------------------- assemble
export function generateIndex() {
  const drift = computeDrift();
  let snapshot = null;
  if (fs.existsSync(FINGERPRINT_FILE)) {
    try { snapshot = JSON.parse(fs.readFileSync(FINGERPRINT_FILE, "utf8")); } catch { snapshot = null; }
  }
  // freshness annotation on audit-derived entries
  const freshResources = {};
  for (const [k, v] of Object.entries(resources)) freshResources[k] = applyFreshness(JSON.parse(JSON.stringify(v)), snapshot);
  const freshCapabilities = {};
  for (const [k, v] of Object.entries(CAPABILITY_DEFS)) {
    const e = JSON.parse(JSON.stringify(v));
    if (e.derivation === "audit-code-review-2026-09-19") {
      const files = new Set(e.evidence || []);
      const f = computeEvidenceStatus([...files], snapshot);
      Object.assign(e, f);
      if (f.evidenceStatus === "reaudit-required" && e.status === "verified") {
        e.priorStatus = "verified"; e.status = "stale";
        e.statusNote = "evidence changed since last verification; re-audit required";
      }
    }
    freshCapabilities[k] = e;
  }
  return {
    version: 3,
    generatedAt: new Date().toISOString(),
    generatedBy: ".ai/architecture/build-index.mjs",
    note: "Architecture Index（索引，非百科）：每个条目只指向真实 source/evidence，不复制内容。派生数据：每次构建重新生成，禁止人工手改 index.json。",
    meta: {
      evidencePriority: EVIDENCE_PRIORITY,
      statusVocabulary: STATUS_VOCABULARY,
      lifecycle: { active: "当前事实（默认）", superseded: "已被新事实取代；保留为历史证据，Resolver 不得作为当前事实输出", stale: "证据自上次验证后已变化，需重新审计", conflicted: "两层证据冲突，需人工裁决" },
      regenerationPolicy: "build-index.mjs 每次审计/构建重跑；AUDIT_FACTS 类条目 derivation=audit-code-review-2026-09-19，过期须重新取证，不得手改真相",
      conflictPolicy: "conflicts 为一等状态；likelyCanonicalLayer 只是 evidence-derived judgment，不是 verified；humanDecisionRequired=true 的条目禁止自动解决",
      ownershipModel: "resource → operations[] → writers[]；ownershipScope ∈ {table,field,operation,file,unknown}；writerCardinality ∈ {single,multiple,unknown}；禁止把 field/operation 级事实压平成 table-level single writer",
      runtimeCapabilityModel: "runtime.hosts[] ↔ capability.hostedBy[]；runtime ≠ capability；capability.implementedBy[] 指向 module",
      freshnessPolicy: "evidenceStatus ∈ {current,current-partial,unverified,reaudit-required}；由 verified-fingerprints.json（内容哈希，--record-verified 在审计事件时快照）自动计算；reaudit-required 会把 verified 降级为 stale；UNKNOWN > 假装 verified",
    },
    sources,
    modules,
    capabilities: freshCapabilities,
    resources: freshResources,
    contracts,
    runtimes,
    lines,
    rules,
    conflicts,
    superseded,
    drift,
  };
}

function reportDrift(d) {
  const lines = [];
  let pass = 0, drf = 0, unk = 0;
  lines.push(`PLATFORM_REGISTRY`);
  lines.push(`  canonical: ${d.platformRegistry.canonical.path} (${d.platformRegistry.canonical.count} platforms)`);
  for (const c of d.platformRegistry.derived) {
    const stat = c.status === "PASS" ? "PASS " : c.status === "DRIFT" ? "DRIFT" : "UNKNOWN";
    if (c.status === "PASS") pass++; else if (c.status === "DRIFT") drf++; else unk++;
    let detail = "";
    if (c.status === "DRIFT") {
      const bits = [];
      if (c.missing && c.missing.length) bits.push(`missing=[${c.missing.join(",")}]`);
      if (c.extra && c.extra.length) bits.push(`extra=[${c.extra.join(",")}]`);
      detail = " " + bits.join(" ");
    }
    if (c.status === "UNKNOWN") detail = ` (${c.note || "unparseable"})`;
    lines.push(`  ${stat} ${c.path}${c.comparison ? ` [${c.comparison}]` : ""}${detail}${c.note && c.status !== "UNKNOWN" ? ` — ${c.note}` : ""}`);
  }
  lines.push(`PM2_REGISTRY`);
  lines.push(`  canonical: ${d.pm2Registry.canonical.path} (${d.pm2Registry.canonical.ids.length} apps)`);
  for (const c of d.pm2Registry.derived) {
    const stat = c.status === "PASS" ? "PASS " : c.status === "DRIFT" ? "DRIFT" : "UNKNOWN";
    if (c.status === "PASS") pass++; else if (c.status === "DRIFT") drf++; else unk++;
    const detail = c.status === "DRIFT" ? ` missing=[${(c.missing || []).join(",")}] extra=[${(c.extra || []).join(",")}]` : "";
    lines.push(`  ${stat} ${c.path}${detail}${c.note ? ` — ${c.note}` : ""}`);
  }
  lines.push(`SUMMARY: ${pass} PASS, ${drf} DRIFT, ${unk} UNKNOWN (detection only — never auto-fixed)`);
  return { text: lines.join("\n"), driftCount: drf, unknownCount: unk };
}

function recordVerified(index) {
  // audit event: snapshot content hashes of every evidence file referenced by audit-derived entries
  const files = new Set();
  for (const v of Object.values(index.resources)) collectEntryEvidence(v).forEach((f) => files.add(f));
  for (const v of Object.values(index.capabilities)) (v.evidence || []).forEach((f) => files.add(f));
  const hashes = {};
  for (const raw of files) {
    const rel = evidencePath(raw);
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) hashes[rel] = hashContent(fs.readFileSync(abs, "utf8"));
  }
  const snapshot = { version: 1, recordedAt: new Date().toISOString(), recordedBy: "build-index.mjs --record-verified (Phase 4 client_matches writer re-audit)", hashes };
  fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify(snapshot, null, 2) + "\n");
  return snapshot;
}

function main() {
  if (CHECK_MODE) {
    const r = reportDrift(computeDrift());
    console.log(r.text);
    process.exit(r.driftCount > 0 ? 1 : 0);
  }
  const index = generateIndex();
  if (RECORD_MODE) {
    const snap = recordVerified(index);
    console.log(`recorded ${Object.keys(snap.hashes).length} evidence hashes → ${path.relative(ROOT, FINGERPRINT_FILE)}`);
    // re-generate so the fresh snapshot is reflected as current in this run's index
    const refreshed = generateIndex();
    fs.writeFileSync(path.join(ROOT, ".ai/architecture/index.json"), JSON.stringify(refreshed, null, 2) + "\n");
  } else {
    fs.writeFileSync(path.join(ROOT, ".ai/architecture/index.json"), JSON.stringify(index, null, 2) + "\n");
  }
  const finalIndex = JSON.parse(fs.readFileSync(path.join(ROOT, ".ai/architecture/index.json"), "utf8"));
  const staleCount = Object.values(finalIndex.resources).filter((r) => r.status === "stale").length;
  console.log(`wrote .ai/architecture/index.json`);
  console.log(`modules=${Object.keys(modules).length} runtimes=${Object.keys(runtimes).length} resources=${Object.keys(resources).length} capabilities=${Object.keys(finalIndex.capabilities).length} conflicts=${Object.keys(conflicts).length} superseded=${Object.keys(superseded).length} staleEntries=${staleCount} uncoveredPkgDirs=[${uncovered.join(", ")}]`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
