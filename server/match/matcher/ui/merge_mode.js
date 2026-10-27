import { isPlatformMatchRowFullyIdMapped, resolvePlatformMatchTeamId } from "@changmen/db";
import { classifyMergeBasis, PROVIDER_PRIORITY, setTeamPlugin } from "@changmen/match-identity";
import { resolvePlatformTeamId } from "@changmen/shared/catalog/pb_team_platform_id";

let _pluginPromise = null;

export function resetMatcherUiTeamPlugin() {
  _pluginPromise = null;
}

export function getTeamPlugin() {
  if (!_pluginPromise) {
    _pluginPromise = (async () => {
      try {
        const { loadAndCreatePlugin } = await import("@changmen/team-resolver/team_db.js");
        const plugin = await loadAndCreatePlugin();
        setTeamPlugin(plugin);
        return plugin;
      }
      catch (err) {
        console.warn("[matcher] team-resolver unavailable:", err.message);
        setTeamPlugin(null);
        return null;
      }
    })();
  }
  return _pluginPromise;
}

function linkedPlatformRows(cm, byPlatform) {
  const rows = [];
  for (const [plat, srcId] of Object.entries(cm.matchs || {})) {
    const row = (byPlatform[plat] || []).find(m => String(m.source_match_id) === String(srcId));
    if (row)
      rows.push(row);
  }
  return rows;
}

function classifyViaPlugin(rows) {
  return rows.map(row =>
    classifyMergeBasis(String(row.home || ""), String(row.away || ""), row.game?.code, {
      provider: row.platform,
      homeId: resolvePlatformTeamId(
        row.platform,
        row.home_id,
        row.source_game_id,
        row.game?.code,
      ),
      awayId: resolvePlatformTeamId(
        row.platform,
        row.away_id,
        row.source_game_id,
        row.game?.code,
      ),
    }),
  );
}

function clientMatchHasLockedGbTeams(cm) {
  const h = Number(cm?.home_gb_team_id);
  const a = Number(cm?.away_gb_team_id);
  return Number.isFinite(h) && h > 0 && Number.isFinite(a) && a > 0;
}

function rowsHavePlatformTeamIds(rows) {
  return rows.every((row) => {
    const gc = row.game?.code;
    return !!resolvePlatformMatchTeamId(row, "home", gc)
      && !!resolvePlatformMatchTeamId(row, "away", gc);
  });
}

export function classifyClientMatchMergeMode(cm, byPlatform, teamMaps = null) {
  const rows = linkedPlatformRows(cm, byPlatform);
  const locked = clientMatchHasLockedGbTeams(cm);

  // 无 live 平台行：以 client_matches 自有锁/标题为准，勿把僵尸行标成「队名已匹配」
  if (!rows.length) {
    if (locked)
      return { mode: "id", label: "平台 ID", platforms: 0, refPlat: null };
    return { mode: "unknown", label: "未知", platforms: 0, refPlat: null };
  }

  const refPlat = [...rows].sort(
    (a, b) => (PROVIDER_PRIORITY[b.platform] || 0) - (PROVIDER_PRIORITY[a.platform] || 0),
  )[0].platform;

  const idByTeamMaps = teamMaps
    ? rows.every(row => isPlatformMatchRowFullyIdMapped(row, teamMaps))
    : classifyViaPlugin(rows).every(m => m === "id");

  const idByLockedGb = locked
    && rows.length >= 2
    && rowsHavePlatformTeamIds(rows);

  const mode = (idByTeamMaps || idByLockedGb) ? "id" : "name";

  return {
    mode,
    label: mode === "id" ? "平台 ID" : "队名",
    platforms: rows.length,
    refPlat,
  };
}

export async function enrichClientMatchesMergeMode(clientMatches, byPlatform, teamMaps = null) {
  if (!teamMaps)
    await getTeamPlugin();
  return (clientMatches || []).map(cm => ({
    ...cm,
    merge_mode: classifyClientMatchMergeMode(cm, byPlatform, teamMaps),
  }));
}
