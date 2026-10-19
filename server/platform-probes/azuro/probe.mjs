/** One-off Azuro API probe — delete after integration */
const GQL = "https://thegraph-1.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-data-feed-polygon";
const API = "https://api.onchainfeed.org/api/v1/public";

async function gql(query, variables) {
  const r = await fetch(GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

async function apiGet(path) {
  const r = await fetch(`${API}${path}`);
  return r.json();
}

const gamesQuery = `
query EsportsGames($slug: String!) {
  games(
    first: 3
    where: {
      sport_: { slug: $slug }
      state_in: [Prematch, Live]
      activeConditionsCount_gt: 0
    }
    orderBy: startsAt
    orderDirection: asc
  ) {
    id
    gameId
    title
    startsAt
    state
    sport { name slug }
    league { name }
    participants { name sortOrder }
    activeConditionsCount
  }
}`;

const conditionsQuery = `
query GameConditions($gameId: ID!) {
  game(id: $gameId) {
    id
    title
    conditions(where: { state: Active }, first: 5) {
      id
      conditionId
      title
      state
      isPrematchEnabled
      isLiveEnabled
      outcomes {
        id
        outcomeId
        title
        currentOdds
      }
    }
  }
}`;

for (const slug of ["cs2", "lol", "dota-2"]) {
  const res = await gql(gamesQuery, { slug });
  console.log(`\n=== ${slug} games ===`);
  console.log(JSON.stringify(res.data?.games ?? res.errors, null, 2));
  const game = res.data?.games?.[0];
  if (game) {
    const cond = await gql(conditionsQuery, { gameId: game.id });
    console.log(`\n=== conditions for ${game.title} ===`);
    console.log(JSON.stringify(cond.data?.game?.conditions ?? cond.errors, null, 2));
  }
}

const backend = await apiGet(
  "/market-manager/games-by-filters?environment=PolygonUSDT&gameState=Prematch&orderBy=startsAt&orderDirection=asc&sportId=1061&page=1&perPage=10",
);
console.log("\n=== backend CS2 prematch ===");
console.log(JSON.stringify(backend, null, 2).slice(0, 4000));
