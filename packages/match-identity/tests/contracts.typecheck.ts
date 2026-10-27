import {
  assignMatchIds,
  canonicalMatchKeyByIdOnly,
  ensureClientMatchId,
  pickCanonicalPlatformRow,
  resolveClientMatchIds,
  setTeamPlugin,
} from "@changmen/match-identity";
import { normalizeTeam } from "@changmen/match-identity/teams/team_key.js";
import { stableBetId } from "@changmen/match-identity/teams/match_utils.js";
import type { ClientMatchIdentityAdapter, TeamPlugin } from "@changmen/match-identity/types";

const plugin: TeamPlugin = {
  lookupById: (_platform, id) => id,
  lookupByName: (_game, name) => name,
  lookupCanonicalName: id => id,
  saveMapping: (_id, _platform, _platformId, _name, _game) => {},
};
setTeamPlugin(plugin);
setTeamPlugin((_game, name) => name);
setTeamPlugin(null);

// Partial host capabilities suffice for the operations that use them.
const adapter: ClientMatchIdentityAdapter = {
  fetchClientMatchIndex: async () => [{ id: 1, matchs: { OB: "ob1" } }],
  insertClientMatchStub: async (_key, _stub) => 1,
  findClientMatchIdByMergeKey: async () => null,
};
void ensureClientMatchId(adapter, "match:name:3:a:b");
void ensureClientMatchId({
  insertClientMatchStub: adapter.insertClientMatchStub,
  findClientMatchIdByMergeKey: adapter.findClientMatchIdByMergeKey,
}, "match:name:3:a:b");

const row = { MergeKey: "match:name:3:a:b", Matchs: { OB: "ob1" }, Title: "A vs B", Bets: [{ Map: 0, Name: "full" }] };
const assigned = assignMatchIds(row, 1);
const title: string = assigned.Title;
const betId: number = assigned.Bets[0]!.ID;
const betName: string = assigned.Bets[0]!.Name;
const replaced = assignMatchIds({ ID: "old", Bets: [{ ID: "old-bet", MatchID: "old-match", Map: 0, Name: "full" }] }, 1);
const replacedId: number = replaced.ID;
const replacedBetId: number = replaced.Bets[0]!.ID;
const replacedName: string = replaced.Bets[0]!.Name;
void [replacedId, replacedBetId, replacedName];
void resolveClientMatchIds(adapter, [row]).then(rows => {
  const title: string = rows[0]!.Title;
  const id: number = rows[0]!.ID;
  void [title, id];
});
const key = canonicalMatchKeyByIdOnly(3, "A", "B", "cs2", { provider: "OB", homeId: "a", awayId: "b" });
const name: string = normalizeTeam("A Gaming");
const picked = pickCanonicalPlatformRow([{ platform: "OB", home: 1, away: 2, detail: "kept" }]);
if (picked) {
  const normalizedHome: string = picked.home;
  const platform: string | undefined = picked.platform;
  const detail: string = picked.detail;
  // @ts-expect-error The returned home name is normalized to a string.
  const numericHome: number = picked.home;
  void [normalizedHome, platform, detail, numericHome];
}
const customPlatform = pickCanonicalPlatformRow([{ venue: "OB", home: "A", away: "B" }], "venue");
const customVenue: string | undefined = customPlatform?.platform;
void customVenue;
const stable: number = stableBetId(1, 0);
void [key, name, stable, title, betId, betName];

// Public contracts must reject invalid plugins, source IDs and host results.
// @ts-expect-error Team lookup functions return an ID, never an object.
setTeamPlugin({ lookupById: () => ({ id: 1 }) });
// @ts-expect-error A merge key is a string.
void ensureClientMatchId(adapter, 42);
// @ts-expect-error Source match IDs cannot be arbitrary objects.
void resolveClientMatchIds(adapter, [{ Matchs: { OB: {} } }]);
// @ts-expect-error Inserted client match IDs must be numeric.
const invalid: ClientMatchIdentityAdapter = { ...adapter, insertClientMatchStub: async () => "1" };
void invalid;
