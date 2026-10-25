/** Synthetic official team metadata for legacy fixtures; explicit missing/invalid metadata is preserved. */
export function withOfficialTeams(market) {
  const event = market.events?.[0];
  if (!event || Object.hasOwn(event, "teams")) return market;
  let outcomes;
  try { outcomes = typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : market.outcomes; }
  catch { return market; }
  if (!Array.isArray(outcomes) || outcomes.length !== 2) return market;
  return { ...market, events: [{ ...event, teams: [
    { id: 101, name: outcomes[0], ordering: "home" },
    { id: 102, name: outcomes[1], ordering: "away" },
  ] }, ...market.events.slice(1)] };
}
