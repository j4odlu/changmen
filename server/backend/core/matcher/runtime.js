import { configureMatcherRuntime } from "@changmen/matcher/runtime_ports.js";
import * as dbStore from "../db/store.js";
import * as auth from "./auth.js";

/** Backend composition adapter. Call after the collector store has been constructed. */
export function installBackendMatcherRuntime(store) {
  configureMatcherRuntime({
    getCollectorFullSnapshot: () => store.getCollectorFullSnapshot(),
    getCollectorHotSnapshot: () => store.getCollectorHotSnapshot(),
    patchCollectorMatchClientIds: rows => store.patchCollectorMatchClientIds(rows),
    clientMatchesCommitted: () => dbStore.loadClientMatchesFromDb(),
    removeClientMatch: id => dbStore.removeClientMatchFromMemory(id),
    auth: {
      ...auth,
      resolveMatcherUser: (req, dependencies) => auth.resolveMatcherUser(req, dependencies, {
        getUserByToken: token => store.getUserByToken(token),
      }),
    },
  });
}
