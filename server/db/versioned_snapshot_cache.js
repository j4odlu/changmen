/** A version belongs to the rows read with it. Invalidation fences in-flight reads. */
export function createVersionedSnapshotCache({ readMeta, readSnapshot, maxAgeMs = 90_000, now = Date.now }) {
  let current = null, loadedAt = 0, generation = 0, flight = null;
  const copy = value => value == null ? null : structuredClone(value);
  async function refresh() {
    for (;;) {
      const started = generation;
      const meta = await readMeta();
      if (started !== generation) continue;
      if (current && meta?.version && current.version === meta.version && now() - loadedAt < maxAgeMs)
        return current;
      const snapshot = await readSnapshot();
      if (started !== generation) continue;
      if (!snapshot) return current;
      if (!Array.isArray(snapshot.rows) || !snapshot.version)
        throw new Error("Invalid client match snapshot");
      current = copy(snapshot);
      loadedAt = now();
      return current;
    }
  }
  function load() {
    const started = generation;
    if (!flight) flight = refresh().finally(() => { flight = null; });
    // Also fence the gap between refresh completion and delivery to its callers.
    return flight.then(value => started === generation ? copy(value) : load());
  }
  return {
    load,
    invalidate() { generation++; current = null; loadedAt = 0; },
    peek: () => copy(current),
    stats: () => ({ version: current?.version || "", loadedAt, generation, count: current?.rows.length || 0 }),
  };
}
