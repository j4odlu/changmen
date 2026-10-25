import type { GammaEvent, GammaTeam, PlatformTeam } from "./types.ts";

function nameKey(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u4E00-\u9FFF]+/g, "");
}

function officialId(value: unknown): string {
  const id = String(value ?? "").trim();
  return /^[1-9]\d*$/.test(id) ? id : "";
}

/** Keep outcome/token order; event ordering describes the current sporting home/away designation. */
export function resolvePolymarketMatchTeams(
  event: GammaEvent | null, gameId: string, names: [string, string],
): [PlatformTeam, PlatformTeam] | null {
  const team = (identity: GammaTeam): PlatformTeam => ({
    Type: "Polymarket", TeamID: officialId(identity.id),
    Name: String(identity.name ?? "").trim(), GameID: gameId, Logo: "",
  });
  // Incomplete responses must not overwrite an existing official identity with an empty ID.
  if (!Array.isArray(event?.teams) || event.teams.length !== 2)
    return null;
  const identities = event.teams;
  if (identities.some(t => !t || !officialId(t.id) || !String(t.name ?? "").trim())
    || officialId(identities[0].id) === officialId(identities[1].id))
    return null;
  const matches = names.map(name => identities.map((t, i) => ({ t, i }))
    .filter(({ t }) => [t.name, t.alias].some(label => !!nameKey(label) && nameKey(label) === nameKey(name)))
    .map(({ i }) => i));
  if (matches.some(hits => hits.length > 1))
    return null;
  let [first, second] = matches.map(hits => hits[0]);
  if (first == null && second == null)
    return null;
  // A unique opposite team anchors renamed/abbreviated names (e.g. Korfez Basket / Manisa BB).
  first ??= 1 - second!;
  second ??= 1 - first;
  if (first === second)
    return null;
  return [team(identities[first]), team(identities[second])];
}
