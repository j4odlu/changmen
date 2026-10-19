import catalog from "./ray_game_ids.json" with { type: "json" };

export function getGameRecord(gameId) {
  return catalog.games[String(gameId)] || null;
}

export function getGameName(gameId) {
  const rec = getGameRecord(gameId);
  if (rec?.name) return rec.name;
  return `未知(${gameId})`;
}

export function getGameCode(gameId) {
  return getGameRecord(gameId)?.code || "unknown";
}

export function listKnownGames() {
  return Object.entries(catalog.games).map(([id, g]) => ({
    gameId: id,
    ...g,
  }));
}

export { catalog };
