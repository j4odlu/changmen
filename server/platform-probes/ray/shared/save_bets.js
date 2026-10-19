import { rayMatchStage } from "./match_stage.js";

/** ESM（探针 verify_save_bets 等）；浏览器 canonical 见 platform-adapter/ray/shared/save_bets.ts */
function isRayOddCollectable(p, betRe) {
  const group = String(p.group_name ?? "");
  return p.status !== 4 && betRe.test(group);
}

export function groupRayOddsToSaveBets(result, betRe, platform = "RAY") {
  const teams = result?.team ?? [];
  const homeTeam = teams.find((t) => t.pos === 1);
  const awayTeam = teams.find((t) => t.pos === 2);
  if (!homeTeam || !awayTeam) return [];

  const rows = [];
  for (const p of result?.odds ?? []) {
    if (!isRayOddCollectable(p, betRe)) continue;

    const group = String(p.group_name ?? "");
    const oddsId = String(p.odds_id ?? "");
    const groupId = String(p.odds_group_id ?? "");
    const stage = rayMatchStage(p.match_stage);
    const prefix = stage === 0 ? "[全场]" : `[地图${stage}]`;

    const isHome = String(p.team_id) === String(homeTeam.team_id);
    const isAway = String(p.team_id) === String(awayTeam.team_id);

    let row = rows.find((v) => v.SourceBetID === groupId);
    if (row) {
      if (isHome) {
        row.SourceHomeID = oddsId;
        row.HomeName = String(p.name ?? "");
        row.HomeOdds = Number(p.odds) || 0;
      } else if (isAway) {
        row.SourceAwayID = oddsId;
        row.AwayName = String(p.name ?? "");
        row.AwayOdds = Number(p.odds) || 0;
      }
      continue;
    }

    rows.push({
      Type: platform,
      SourceMatchID: result.id,
      SourceBetID: groupId,
      Map: stage,
      BetName: `${prefix} ${group}`,
      SourceHomeID: isHome ? oddsId : "",
      HomeName: isHome ? String(p.name ?? "") : "",
      HomeOdds: isHome ? Number(p.odds) || 0 : 0,
      SourceAwayID: isAway ? oddsId : "",
      AwayName: isAway ? String(p.name ?? "") : "",
      AwayOdds: isAway ? Number(p.odds) || 0 : 0,
      Status: p.status === 1 ? "Normal" : "Locked",
    });
  }

  return rows.sort((a, b) => (a.Map ?? 0) - (b.Map ?? 0));
}
