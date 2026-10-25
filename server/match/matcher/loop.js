import {
  formatArchiveCounts,
  archiveStaleClientMatchRows,
  pruneMatchesOlderThanCollectPast,
} from "@changmen/db";
import { MATCHER_CLIENT_MATCH_ARCHIVE_INTERVAL_MS, MATCHER_INTERVAL_MS } from "./lib/config.js";
import { writeMatcherHeartbeat } from "./lib/heartbeat.js";
import { withMatcherWriteLock } from "./lib/write_guard.js";
import { ensureTeamPlugin, matchMergeOnce } from "./ops/match_merge_once.js";
import "./lib/env.js";

const INTERVAL_MS = MATCHER_INTERVAL_MS;
const ARCHIVE_INTERVAL_MS = MATCHER_CLIENT_MATCH_ARCHIVE_INTERVAL_MS;

let lastArchiveAt = 0;
let archiveInFlight = null;
let loopTimer = null;
let loopRunning = false;

async function maybeArchiveStaleClientMatches() {
  const now = Date.now();
  if (lastArchiveAt && now - lastArchiveAt < ARCHIVE_INTERVAL_MS)
    return;
  if (archiveInFlight)
    return archiveInFlight;
  archiveInFlight = withMatcherWriteLock(async () => {
    try {
      const past = await pruneMatchesOlderThanCollectPast();
      if (past?.platform?.deleted || past?.client?.ended) {
        console.log(
          `[matcher] past prune (>collect past): platform=${past.platform?.deleted || 0}`
          + ` clientEnded=${past.client?.ended || 0}`,
        );
      }
    }
    catch (err) {
      console.warn("[matcher] past prune failed:", err?.message || err);
    }
    const ar = await archiveStaleClientMatchRows();
    lastArchiveAt = Date.now();
    if (ar.rds) {
      console.log(`[matcher] archive client_matches (scope=${ar.scope}): ${formatArchiveCounts(ar.rds)}`);
    }
  }).finally(() => {
    archiveInFlight = null;
  });
  return archiveInFlight;
}

export async function runMatcherOnce() {
  await maybeArchiveStaleClientMatches();
  const result = await matchMergeOnce();
  writeMatcherHeartbeat({
    matchCount: result.matchCount,
    intervalMs: INTERVAL_MS,
    builtAt: result.builtAt,
  });
  const teamNote = result.teamReg?.registered > 0
    ? ` · 自动收录队伍 ${result.teamReg.registered} 条`
    : result.teamReg?.scanned > 0
      ? ` · 队伍扫描 ${result.teamReg.scanned}（无新增）`
      : "";
  const hotParts = Object.entries(result.hotCollector || {})
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  const hotNote = hotParts.length ? ` · hot=${hotParts.join(",")}` : "";
  console.log(
    `[matcher] ${new Date().toISOString()} matchMerge ${result.matchCount} matches${
      teamNote
    }${hotNote}${result.matchIdBackfill?.updated
      ? ` · backfill match_id ${result.matchIdBackfill.updated}`
      : ""}`,
  );
  return result;
}

export async function startMatcherLoop(opts = {}) {
  if (loopRunning) {
    return { ok: false, alreadyRunning: true, pid: process.pid };
  }
  loopRunning = true;
  await ensureTeamPlugin();
  writeMatcherHeartbeat({
    matchCount: null,
    intervalMs: INTERVAL_MS,
    builtAt: null,
  });
  console.log(
    `[matcher] starting embedded loop, interval=${INTERVAL_MS / 1000}s, client_matches archive every ${ARCHIVE_INTERVAL_MS / 1000}s`,
  );

  const tick = async () => {
    try {
      await runMatcherOnce();
    }
    catch (err) {
      console.error("[matcher] error:", err.message);
      if (opts.exitOnFatal)
        throw err;
    }
  };

  try {
    await tick();
  }
  catch (err) {
    loopRunning = false;
    throw err;
  }

  loopTimer = setInterval(() => {
    void tick().catch((err) => {
      console.error("[matcher] fatal tick:", err);
      if (opts.exitOnFatal)
        process.exit(1);
    });
  }, INTERVAL_MS);

  return { ok: true, pid: process.pid, intervalMs: INTERVAL_MS };
}

export function stopMatcherLoop() {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  const wasRunning = loopRunning;
  loopRunning = false;
  return { ok: true, stopped: wasRunning, pid: process.pid };
}

export function getMatcherLoopState() {
  return {
    running: loopRunning,
    pid: loopRunning ? process.pid : null,
    intervalMs: INTERVAL_MS,
  };
}
