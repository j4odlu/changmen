"use strict";

const SPORT_SLUG_TO_CODE = {
  "dota-2": "dota2",
  "counter-strike": "cs2",
  "league-of-legends": "lol",
  "kings-of-glory": "kog",
  valorant: "valorant",
};

const STAKE_GRAPHQL = `query SportIndex($sport: String!, $groups: [String!]!, $type: SportSearchEnum = popular) {
  slugSport(sport: $sport, type: $type) {
    firstTournament {
      fixtureList {
        id
        slug
        status
        data {
          startTime
          competitors { extId iconPath }
          teams { qualifier name }
        }
        groups {
          name
          templates {
            markets {
              id
              name
              status
              outcomes { id active odds }
            }
          }
        }
      }
    }
  }
}`;

function parseMapFromMarketName(name) {
  if (name === "比赛获胜者 - Two 路线") return 0;
  const m = /地图(\d)获胜者 - Two 路线/.exec(String(name || ""));
  return m ? Number(m[1]) : undefined;
}

function normalizeGraphqlSport(sportSlug, payload) {
  const gameCode = SPORT_SLUG_TO_CODE[sportSlug] || sportSlug;
  const matches = [];
  const tournaments = payload?.data?.slugSport?.firstTournament;
  const tournamentArr = Array.isArray(tournaments) ? tournaments : tournaments ? [tournaments] : [];
  const list = tournamentArr.flatMap((t) => t?.fixtureList || []);
  const horizon = Date.now() + 3600 * 1000;

  for (const fixture of list) {
    if (!["live", "active"].includes(fixture.status)) continue;
    const startTime = new Date(fixture.data.startTime).getTime();
    if (startTime > horizon) continue;
    const homeTeam = fixture.data.teams.find((t) => t.qualifier === "home");
    const awayTeam = fixture.data.teams.find((t) => t.qualifier === "away");
    if (!homeTeam?.name || !awayTeam?.name) continue;
    const comps = fixture.data.competitors || [];
    if (comps.length !== 2) continue;
    const homeId = comps[0]?.extId?.split(":").pop();
    const awayId = comps[1]?.extId?.split(":").pop();
    if (!homeId || !awayId) continue;

    const stages = [];
    for (const group of fixture.groups || []) {
      if (group.name !== "maps" && group.name !== "winner") continue;
      for (const template of group.templates || []) {
        for (const market of template.markets || []) {
          if ((market.outcomes || []).length !== 2) continue;
          const stageId = parseMapFromMarketName(market.name);
          if (stageId === undefined) continue;
          const locked = market.status !== "active";
          const homeOutcome = market.outcomes[0];
          const awayOutcome = market.outcomes[1];
          stages.push({
            stageId,
            label: stageId === 0 ? "全场" : `地图${stageId}`,
            winMarketId: market.id,
            winHomeId: homeOutcome.id,
            winAwayId: awayOutcome.id,
            winHome: !locked && homeOutcome.active ? Number(homeOutcome.odds) : null,
            winAway: !locked && awayOutcome.active ? Number(awayOutcome.odds) : null,
            winLocked: locked,
            betName: market.name,
          });
        }
      }
    }

    matches.push({
      matchId: String(fixture.id),
      gameId: sportSlug,
      gameCode,
      gameName: gameCode,
      bo: 0,
      startTime,
      isLive: true,
      leagueName: "",
      home: { id: homeId, name: homeTeam.name },
      away: { id: awayId, name: awayTeam.name },
      stages,
    });
  }

  return matches;
}

module.exports = {
  STAKE_GRAPHQL,
  SPORT_SLUG_TO_CODE,
  parseMapFromMarketName,
  normalizeGraphqlSport,
};
