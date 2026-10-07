import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports, test/no-import-node-test -- Collector tests run with node --test.
import test from "node:test";
import { pollLinkedGammaSportStates } from "./gamma_poll.js";
import { createPmSportStateWriter } from "./sport_state.js";

test("Gamma poll fills linked matches and persists source through the shared writer", async () => {
  const writes = [];
  const options = {
    list: async () => [{ source_match_id: "pm-1", match_id: 1, home: "PM home", away: "PM away" }],
    fetchEvent: async id => ({ id, gameId: 10, live: false, ended: false, score: "0-0|0-0|Bo5", period: "0/5" }),
    apply: createPmSportStateWriter(async () => null),
  };
  const write = async (id, snap) => { writes.push([id, snap]); return true; };
  assert.equal(await pollLinkedGammaSportStates(write, options), 1);
  assert.equal(writes[0][0], 1);
  assert.equal(writes[0][1].status, "not_started");
  assert.equal(writes[0][1].source, "gamma");
  assert.equal(writes[0][1].eventId, "pm-1");
  assert.equal(writes[0][1].homeTeam, "PM home");
  assert.equal(await pollLinkedGammaSportStates(write, options), 0);
});

test("a delayed Gamma HTTP response cannot overwrite WS received during the request", async () => {
  let release;
  let began;
  const started = new Promise((r) => { began = r; });
  const response = new Promise((r) => { release = r; });
  const writes = [];
  const apply = createPmSportStateWriter(async () => null);
  const write = async (_, snap) => { writes.push(snap); return true; };
  const poll = pollLinkedGammaSportStates(write, {
    list: async () => [{ source_match_id: "pm-1", match_id: 1 }],
    fetchEvent: () => { began(); return response; },
    apply,
  });
  await started;
  assert.equal(await apply(1, { gameId: 10, live: true, status: "running" }, "ws", write), true);
  release({ gameId: 10, live: false, ended: false });
  assert.equal(await poll, 0);
  assert.deepEqual(writes.map(s => s.source), ["ws"]);
});

test("missing Gamma status fields do not produce a fabricated not_started state", async () => {
  let calls = 0;
  assert.equal(await pollLinkedGammaSportStates(async () => { calls++; return true; }, {
    list: async () => [{ source_match_id: "pm-1", match_id: 1 }],
    fetchEvent: async () => ({ id: "pm-1", gameId: 10 }),
    apply: createPmSportStateWriter(async () => null),
  }), 0);
  assert.equal(calls, 0);
});

test("an unavailable Gamma event does not block other linked matches", async () => {
  const writes = [];
  assert.equal(await pollLinkedGammaSportStates(async (id) => { writes.push(id); return true; }, {
    list: async () => [{ source_match_id: "missing", match_id: 1 }, { source_match_id: "ok", match_id: 2 }],
    fetchEvent: async id => id === "missing" ? null : { id, ended: true },
    apply: createPmSportStateWriter(async () => null),
  }), 1);
  assert.deepEqual(writes, [2]);
});
