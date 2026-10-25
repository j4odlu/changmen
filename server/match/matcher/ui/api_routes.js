import { fetchPlatformMatchesDebugRows } from "@changmen/db";
import {
  linkPlatformTeams,
  linkPlatformToClientMatch,
  linkPlatformToPlatform,
  previewLinkAlignment,
  previewLinkPlatformAlignment,
  previewLinkPlatformTeams,
  registerTeamPlatformMap,
  setClientMatchPlatformSideOverride,
} from "../link/index.js";
import { clientMatchToHistory } from "../ops/delete_client_match.js";
import { mergeClientMatches, previewMergeClientMatches } from "../ops/merge_client_matches.js";
import { invalidateMatcherRdsSnapshot } from "../ops/rds_snapshot_cache.js";
import { matchMergeOnce } from "../ops/match_merge_once.js";
import { restoreClientMatch } from "../ops/restore_client_match.js";
import { isMatcherProduction } from "../lib/config.js";
import { logMatcherApiErr, logMatcherApiOk, logMatcherApiWarn } from "./matcher_api_log.js";
import {
  fetchMatcherDashboard,
  fetchMatcherHiddenClientMatches,
  getMatcherStatus,
  summarizeMatcherDashboard,
} from "./matcher_data.js";
import { startMatcherProcess, stopMatcherProcess } from "./matcher_process.js";

function registerMatcherApiRoutes(app) {
  app.get("/api/link-preview", async (req, res) => {
    try {
      const result = await previewLinkAlignment({
        platform: req.query.platform,
        sourceMatchId: req.query.sourceMatchId,
        clientMatchId: req.query.clientMatchId,
      });
      res.json(result);
    }
    catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/link-platform-preview", async (req, res) => {
    try {
      const result = await previewLinkPlatformAlignment({
        platform: req.query.platform,
        sourceMatchId: req.query.sourceMatchId,
        targetPlatform: req.query.targetPlatform,
        targetMatchId: req.query.targetMatchId,
      });
      res.json(result);
    }
    catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/link-match", async (req, res) => {
    try {
      const { platform, sourceMatchId, clientMatchId, reversed } = req.body || {};
      const result = await linkPlatformToClientMatch({
        platform,
        sourceMatchId,
        clientMatchId,
        reversed: typeof reversed === "boolean" ? reversed : undefined,
      });
      logMatcherApiOk("/api/link-match", result);
      res.json(result);
    }
    catch (err) {
      logMatcherApiErr("/api/link-match", err);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/link-platform-match", async (req, res) => {
    try {
      const { platform, sourceMatchId, targetPlatform, targetMatchId, reversed } = req.body || {};
      const result = await linkPlatformToPlatform({
        platform,
        sourceMatchId,
        targetPlatform,
        targetMatchId,
        reversed: typeof reversed === "boolean" ? reversed : undefined,
      });
      logMatcherApiOk("/api/link-platform-match", result);
      res.json(result);
    }
    catch (err) {
      logMatcherApiErr("/api/link-platform-match", err);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/link-team-preview", async (req, res) => {
    try {
      const result = await previewLinkPlatformTeams({
        a: {
          platform: req.query.platformA,
          platformId: req.query.platformIdA,
          platformName: req.query.platformNameA,
          gameCode: req.query.gameCode,
        },
        b: {
          platform: req.query.platformB,
          platformId: req.query.platformIdB,
          platformName: req.query.platformNameB,
          gameCode: req.query.gameCode,
        },
      });
      res.json(result);
    }
    catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/link-team", async (req, res) => {
    try {
      const { a, b } = req.body || {};
      const result = await linkPlatformTeams({ a, b });
      logMatcherApiOk("/api/link-team", result);
      res.json(result);
    }
    catch (err) {
      logMatcherApiErr("/api/link-team", err);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/register-team-map", async (req, res) => {
    try {
      const body = req.body || {};
      const platformId = body.venueId ?? body.platformId;
      const platformName = body.venueName ?? body.platformName;
      const platform = body.venue ?? body.platform;
      const { gameCode } = body;
      const result = await registerTeamPlatformMap({
        platform,
        platformId,
        platformName,
        gameCode,
      });
      logMatcherApiOk("/api/register-team-map", result);
      res.json(result);
    }
    catch (err) {
      const label = err.code === "already_registered" ? "skip" : "error";
      if (label === "skip")
        logMatcherApiWarn("/api/register-team-map", err, "skip");
      else logMatcherApiErr("/api/register-team-map", err);
      res.status(err.code === "already_registered" ? 409 : 400).json({
        ok: false,
        error: err.message,
        code: err.code || "register_failed",
      });
    }
  });

  app.delete("/api/client-match/:id", async (req, res) => {
    try {
      const result = await clientMatchToHistory(req.params.id);
      logMatcherApiOk("/api/client-match", result);
      res.json(result);
    }
    catch (err) {
      logMatcherApiErr("/api/client-match", err);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/client-match/:id/restore", async (req, res) => {
    try {
      const result = await restoreClientMatch(req.params.id);
      logMatcherApiOk("/api/client-match/restore", result);
      res.json(result);
    }
    catch (err) {
      logMatcherApiErr("/api/client-match/restore", err);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/client-match/:id/reverse", async (req, res) => {
    try {
      const { platform, reversed } = req.body || {};
      const update = await setClientMatchPlatformSideOverride({
        clientMatchId: req.params.id,
        platform,
        reversed: !!reversed,
      });
      invalidateMatcherRdsSnapshot(["clientMatches", "platformMatches"]);
      const matchMerge = await matchMergeOnce({ afterInFlight: true });
      const body = {
        ok: true,
        ...update,
        matchMerge: { matchCount: matchMerge?.matchCount ?? null },
      };
      logMatcherApiOk("/api/client-match/reverse", body);
      res.json(body);
    }
    catch (err) {
      logMatcherApiErr("/api/client-match/reverse", err);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/merge-preview", async (req, res) => {
    try {
      const result = await previewMergeClientMatches({
        sourceClientMatchId: req.query.sourceClientMatchId,
        targetClientMatchId: req.query.targetClientMatchId,
      });
      res.json(result);
    }
    catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/merge-client-matches", async (req, res) => {
    try {
      const { sourceClientMatchId, targetClientMatchId } = req.body || {};
      const result = await mergeClientMatches({
        sourceClientMatchId,
        targetClientMatchId,
      });
      res.json(result);
    }
    catch (err) {
      console.error("[matcher] /api/merge-client-matches error:", err.message);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/data", async (req, res) => {
    try {
      res.json(await fetchMatcherDashboard());
    }
    catch (err) {
      console.error("[matcher] /api/data error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hidden-client-matches", async (req, res) => {
    try {
      res.json(await fetchMatcherHiddenClientMatches({
        startFrom: req.query.startFrom,
        startTo: req.query.startTo,
      }));
    }
    catch (err) {
      console.error("[matcher] /api/hidden-client-matches error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/matcher-status", async (req, res) => {
    try {
      res.json(await getMatcherStatus());
    }
    catch (err) {
      res.status(500).json({ running: false, error: err.message });
    }
  });

  app.post("/api/matcher/start", async (req, res) => {
    try {
      const result = await startMatcherProcess();
      if (!result.ok)
        return res.status(409).json(result);
      res.json(result);
    }
    catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/matcher/stop", async (req, res) => {
    if (isMatcherProduction()) {
      return res.status(403).json({
        ok: false,
        error: "生产环境禁止停止内嵌合并循环，请重启 changmen-esport",
      });
    }
    try {
      const result = await stopMatcherProcess();
      if (!result.ok)
        return res.status(409).json(result);
      res.json(result);
    }
    catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  async function handleMatchMergeRoute(req, res, routeLabel) {
    try {
      const result = await matchMergeOnce({ afterInFlight: true });
      const logLines = [`赛事合并完成 · client_matches ${result.matchCount} 场`];
      if (result.teamReg?.registered > 0) {
        logLines.push(`自动收录队伍 ${result.teamReg.registered} 条`);
      }
      const { alignedById = 0, alignedByName = 0 } = result.alignStats || {};
      if (alignedById || alignedByName) {
        logLines.push(`未匹配对齐 · ID ${alignedById} · 队名+时间 ${alignedByName}`);
      }
      if (result.matchIdBackfill?.updated) {
        logLines.push(`回写 match_id ${result.matchIdBackfill.updated} 条`);
      }
      const body = {
        ok: true,
        matchMerge: result,
        summary: logLines[0],
        logLines,
      };
      logMatcherApiOk(routeLabel, body);
      res.json(body);
    }
    catch (err) {
      logMatcherApiErr(routeLabel, err);
      res.status(500).json({ ok: false, error: err.message });
    }
  }

  app.post("/api/match-merge", (req, res) => handleMatchMergeRoute(req, res, "/api/match-merge"));

  /** @deprecated 使用 POST /api/match-merge */
  app.post("/api/rebuild", (req, res) => handleMatchMergeRoute(req, res, "/api/rebuild"));

  app.get("/api/debug", async (req, res) => {
    try {
      const [dashboard, rdsRows] = await Promise.all([
        fetchMatcherDashboard(),
        fetchPlatformMatchesDebugRows(),
      ]);
      const rdsByPlatform = {};
      for (const r of rdsRows || []) {
        if (!rdsByPlatform[r.platform])
          rdsByPlatform[r.platform] = { count: 0, sample: [] };
        rdsByPlatform[r.platform].count++;
        if (rdsByPlatform[r.platform].sample.length < 2) {
          rdsByPlatform[r.platform].sample.push({ home: r.home, away: r.away, start_time: r.start_time });
        }
      }
      res.json({
        ok: true,
        dashboard: summarizeMatcherDashboard(dashboard),
        rds: {
          total: (rdsRows || []).length,
          byPlatform: rdsByPlatform,
        },
      });
    }
    catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });
}

export { registerMatcherApiRoutes };
