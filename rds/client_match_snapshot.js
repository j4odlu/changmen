import { fetchClientMatches, fetchClientMatchesMeta } from "./rds/client_matches_store.js";
import { createVersionedSnapshotCache } from "./versioned_snapshot_cache.js";

// Shared by backend and embedded matcher; standalone matcher owns its process-local instance.
const cache = createVersionedSnapshotCache({
  readMeta: fetchClientMatchesMeta,
  readSnapshot: () => fetchClientMatches({ snapshot: true }),
});
export const loadClientMatchSnapshot = () => cache.load();
export const invalidateClientMatchSnapshot = () => cache.invalidate();
export const peekClientMatchSnapshot = () => cache.peek();
export const getClientMatchSnapshotStats = () => cache.stats();
