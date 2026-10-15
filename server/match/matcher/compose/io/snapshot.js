/**
 * 读取合场输入快照；挂 team plugin；可选 autoRegister。
 *
 * clientRows = 全量（含 home_gb / pm_sport），供 sticky + ended
 * alignClientRows 与 clientRows 来自同一次含 ended 的版本化读取。
 */
import * as db from "@changmen/db";
import { setTeamPlugin } from "@changmen/match-identity/teams/team_key.js";

let _pluginReady = null;
/** @type {string|null} */
let _pluginMapsRevision = null;

export function normalizeMatchesShape(raw) {
  const out = {};
  for (const [provider, block] of Object.entries(raw || {})) {
    if (!block)
      continue;
    if (Array.isArray(block)) {
      out[provider] = {};
      for (const m of block) {
        if (m?.SourceMatchID != null)
          out[provider][String(m.SourceMatchID)] = m;
      }
    }
    else if (typeof block === "object") {
      out[provider] = block;
    }
  }
  return out;
}

export async function ensureTeamPlugin() {
  let revision = null;
  try {
    if (typeof db.fetchTeamMapsRevision === "function")
      revision = await db.fetchTeamMapsRevision();
  }
  catch (err) {
    console.warn("[match-composer] fetchTeamMapsRevision:", err.message);
  }

  if (_pluginReady && revision != null && revision === _pluginMapsRevision)
    return _pluginReady;
  if (_pluginReady && revision == null)
    return _pluginReady;

  if (_pluginReady && revision != null && revision !== _pluginMapsRevision) {
    console.log(
      `[match-composer] team-resolver 映射变更 ${_pluginMapsRevision} → ${revision}，重载`,
    );
  }

  _pluginMapsRevision = revision;
  _pluginReady = (async () => {
    try {
      const { loadAndCreatePlugin } = await import("@changmen/team-resolver/team_db.js");
      const plugin = await loadAndCreatePlugin();
      setTeamPlugin(plugin);
    }
    catch (err) {
      console.warn("[match-composer] team-resolver 加载失败:", err.message);
      _pluginMapsRevision = null;
    }
  })();
  return _pluginReady;
}

export function resetTeamPluginCache() {
  _pluginReady = null;
  _pluginMapsRevision = null;
}

function enrichMatchesRawWithDbBindings(matchesRaw, bindingsByClientId) {
  if (!matchesRaw || !bindingsByClientId?.size)
    return matchesRaw;
  for (const [cmId, bindings] of bindingsByClientId.entries()) {
    const list = Array.isArray(bindings) ? bindings : [];
    for (const b of list) {
      const plat = b.platform || b.Platform;
      const sid = String(b.source_match_id ?? b.SourceMatchID ?? "");
      if (!plat || !sid)
        continue;
      const rows = matchesRaw[plat];
      if (!Array.isArray(rows))
        continue;
      const hit = rows.find(m => String(m.SourceMatchID) === sid);
      if (hit) {
        hit.ClientMatchId = Number(cmId);
        hit.client_match_id = Number(cmId);
        hit.match_id = Number(cmId);
      }
    }
  }
  return matchesRaw;
}

/**
 * @returns {Promise<object>}
 */
export async function loadSnapshot({ registerTeams = true } = {}) {
  await db.initLastWrittenIds?.();

  let matchesRaw = {};
  let bets = {};
  let timers = {};
  /** @type {object[]} 全量：sticky / ended / project existing */
  let clientRows = [];
  /** @type {object[]} align 挂靠专用（可等于 clientRows） */
  let alignClientRows = [];
  let clientMatchSnapshotVersion = null;
  let teamReg = null;
  let nameSync = null;

  if (db.isMatcherStoreReady()) {
    matchesRaw = (await db.fetchPlatformMatches()) || {};
    bets = (await db.fetchPlatformBets()) || {};
    timers = (await db.fetchLiveTimers()) || {};
    const lifecycleSnapshot = await db.fetchClientMatchesAll({ snapshot: true });
    if (!lifecycleSnapshot)
      throw new Error("client_matches lifecycle snapshot unavailable; abort compose");
    clientRows = lifecycleSnapshot.rows;
    alignClientRows = clientRows;
    clientMatchSnapshotVersion = lifecycleSnapshot.version;
  }

  const platformBindingsByClientId = db.isMatcherStoreReady()
    ? await db.fetchAllPlatformMatchBindings()
    : null;
  if (platformBindingsByClientId?.size)
    enrichMatchesRawWithDbBindings(matchesRaw, platformBindingsByClientId);

  if (registerTeams && db.isMatcherStoreReady()) {
    try {
      const { autoRegisterTeams } = await import(
        "../../ops/auto_register_teams.js"
      );
      teamReg = await autoRegisterTeams(matchesRaw);
    }
    catch (err) {
      console.warn("[match-composer] autoRegisterTeams:", err.message);
    }
    try {
      if (typeof db.syncCanonicalTeamNamesFromOb === "function")
        nameSync = await db.syncCanonicalTeamNamesFromOb();
    }
    catch (err) {
      console.warn("[match-composer] syncCanonicalTeamNamesFromOb:", err.message);
    }
    if ((teamReg?.registered > 0) || (nameSync?.updated > 0))
      resetTeamPluginCache();
  }
  await ensureTeamPlugin();

  const matches = normalizeMatchesShape(matchesRaw);
  const platformOverrides = db.isMatcherStoreReady()
    ? await db.fetchClientMatchPlatformOverrides()
    : {};

  return {
    matches,
    matchesRaw,
    bets,
    timers,
    clientRows,
    alignClientRows,
    clientMatchSnapshotVersion,
    clientMatchSnapshotScope: "all",
    platformOverrides,
    platformBindingsByClientId,
    teamReg,
    nameSync,
  };
}
