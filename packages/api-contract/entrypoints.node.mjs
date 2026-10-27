import assert from "node:assert/strict";
import { test } from "node:test";
import * as contract from "@changmen/api-contract";
import * as actions from "@changmen/api-contract/actions";
import * as schemas from "@changmen/api-contract/schemas";
import * as actionSource from "./src/actions.ts";
import * as schemaSource from "./src/schemas.ts";

test("native Node root and action subpath share the canonical TS constants", () => {
  assert.equal(actions.ESPORT_ACTIONS, actionSource.ESPORT_ACTIONS);
  assert.equal(contract.ESPORT_ACTIONS, actions.ESPORT_ACTIONS);
  assert.equal(contract.CORE_INTEGRATION_ACTIONS, actions.CORE_INTEGRATION_ACTIONS);
  for (const action of actions.CORE_INTEGRATION_ACTIONS) {
    assert(contract.ESPORT_ACTIONS.includes(action), action);
  }
});

test("native Node schema subpath exposes the canonical TS validators", () => {
  assert.equal(schemas, schemaSource);
  const request = { provider: "OB", matchId: "1", bets: "[]", matchResult: "finished" };
  assert.equal(schemas.SaveBetRequest.parse(request).matchResult, "finished");
});
