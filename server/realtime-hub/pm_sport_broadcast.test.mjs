import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports, test/no-import-node-test -- Hub tests run with node --test.
import test from "node:test";
import { broadcastPmSportUpdate, buildPmSportPushPayload } from "./pm_sport_broadcast.js";

const gamma = { source: "gamma", status: "not_started", updatedAt: 1 };
const ws = { source: "ws", status: "running", updatedAt: 2, mapScore: { home: 1, away: 0 } };
const row = snapshot => ({ matchs: { Polymarket: "event-1" }, pm_sport: snapshot });
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("late Gamma notification broadcasts the persisted WS state with title orientation", async () => {
  const payload = await buildPmSportPushPayload(1, gamma, async () => ({ ...row(ws), reverse: ["Polymarket"] }));
  assert.equal(payload.PmSport.source, "ws");
  assert.equal(payload.PmSport.status, "running");
  assert.deepEqual(payload.PmSport.mapScore, { home: 0, away: 1 });
});

test("a slow old broadcast query cannot finish after the new broadcast", async () => {
  const started = deferred();
  const finish = deferred();
  const emitted = [];
  const emit = (_, payload) => emitted.push(payload.PmSport.source);
  const old = broadcastPmSportUpdate(emit, 1, gamma, async () => {
    started.resolve();
    await finish.promise;
    return row(gamma);
  });
  await started.promise;
  const next = broadcastPmSportUpdate(emit, 1, ws, async () => row(ws));
  finish.resolve();
  await Promise.all([old, next]);
  assert.deepEqual(emitted, ["gamma", "ws"]);
});

test("broadcast read failure does not block later updates or other matches", async () => {
  const emitted = [];
  const emit = (_, payload) => emitted.push(payload.ClientMatchID);
  await assert.rejects(broadcastPmSportUpdate(emit, 1, gamma, async () => { throw new Error("DB unavailable"); }), /DB unavailable/);
  assert.equal(await broadcastPmSportUpdate(emit, 1, ws, async () => row(ws)), true);
  assert.equal(await broadcastPmSportUpdate(emit, 2, ws, async () => row(ws)), true);
  assert.deepEqual(emitted, [1, 2]);
});

test("missing matches and matches without PM are not broadcast", async () => {
  assert.equal(await buildPmSportPushPayload(1, gamma, async () => null), null);
  assert.equal(await buildPmSportPushPayload(1, gamma, async () => ({ matchs: {} })), null);
});
