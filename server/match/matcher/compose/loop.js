import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatArchiveCounts,
  archiveStaleClientMatchRows,
  pruneMatchesOlderThanCollectPast,
} from "@changmen/db";
import {
  COMPOSER_INTERVAL_MS,
  COMPOSER_ARCHIVE_INTERVAL_MS,
  isComposerWriteEnabled,
  isComposerForceReanchor,
} from "../lib/config.js";
import "../lib/env_composer.js";
import { writeComposerHeartbeat } from "../lib/heartbeat.js";
import { assertComposerMayWrite, withMatcherWriteLock } from "../lib/write_guard.js";
import { composeOnce } from "./compose_once.js";

let timer = null;
let running = false;
let tickInFlight = null;
let lastArchiveAt = 0;
let archiveInFlight = null;

async function maybeArchiveStaleClientMatches() {
  if (!isComposerWriteEnabled())
    return;
  const now = Date.now();
  if (lastArchiveAt && now - lastArchiveAt < COMPOSER_ARCHIVE_INTERVAL_MS)
    return;
  if (archiveInFlight)
    return archiveInFlight;
  archiveInFlight = withMatcherWriteLock(async () => {
    try {
      const past = await pruneMatchesOlderThanCollectPast();
      if (past?.platform?.deleted || past?.client?.ended) {
        console.log(
          `[match-composer] past prune (>collect past): platform=${past.platform?.deleted || 0}`
          + ` clientEnded=${past.client?.ended || 0}`,
        );
      }
    }
    catch (err) {
      console.warn("[match-composer] past prune failed:", err?.message || err);
    }
    const ar = await archiveStaleClientMatchRows();
    lastArchiveAt = Date.now();
    if (ar.rds) {
      console.log(
        `[match-composer] archive client_matches (scope=${ar.scope}): ${formatArchiveCounts(ar.rds)}`,
      );
    }
  }).finally(() => {
    archiveInFlight = null;
  });
  return archiveInFlight;
}

export async function runComposerOnce() {
  // WRITE 开启时先过互斥：禁止「合场被拒、archive 已改库」
  const write = isComposerWriteEnabled();
  if (write) {
    const guard = assertComposerMayWrite();
    if (!guard.ok)
      throw new Error(`[match-composer] ${guard.reason}`);
  }
  await maybeArchiveStaleClientMatches();
  const result = await composeOnce({ write });
  writeComposerHeartbeat({
    matchCount: result.matchCount,
    intervalMs: COMPOSER_INTERVAL_MS,
    builtAt: result.builtAt,
    wrote: result.wrote,
  });
  const writeNote = result.wrote ? "WRITE" : "dry-run";
  console.log(
    `[match-composer] ${new Date().toISOString()} ${writeNote} matches=${result.matchCount}`
    + ` locked=${result.projectStats.locked} unlocked=${result.projectStats.unlocked}`
    + ` omits=${result.projectStats.omitEvents}`
    + ` reanchored=${result.projectStats.reanchored || 0}`
    + ` ended=${result.endedCount || 0}`
    + ` align=${result.alignStats?.alignedById || 0}/${result.alignStats?.alignedByName || 0}`,
  );
  return result;
}

export async function startComposerLoop() {
  if (running)
    return { ok: false, alreadyRunning: true };
  running = true;
  console.log(
    `[match-composer] loop interval=${COMPOSER_INTERVAL_MS / 1000}s`
    + ` write=${isComposerWriteEnabled() ? "ON" : "OFF (set MATCH_COMPOSER_WRITE=1)"}`
    + ` reanchor=${isComposerForceReanchor() ? "ON" : "OFF"}`,
  );
  console.log(
    "[match-composer] 生产唯一写路径是 esport 内嵌 composer；"
    + "独立 loop 保持 MATCH_COMPOSER_WRITE=0。",
  );

  const tick = async () => {
    if (tickInFlight) {
      console.warn("[match-composer] skip tick: previous still in-flight");
      return tickInFlight;
    }
    tickInFlight = (async () => {
      try {
        await runComposerOnce();
      }
      catch (err) {
        console.error("[match-composer] tick failed:", err);
      }
    })().finally(() => {
      tickInFlight = null;
    });
    return tickInFlight;
  };

  await tick();
  timer = setInterval(tick, COMPOSER_INTERVAL_MS);
  return { ok: true, pid: process.pid, timer, intervalMs: COMPOSER_INTERVAL_MS };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  startComposerLoop().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
