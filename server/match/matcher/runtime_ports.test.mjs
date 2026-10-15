import { afterEach, expect, it, vi } from "vitest";
import { collectorRuntime, configureMatcherRuntime, isEmbeddedMatcher,
  publishCommittedClientMatches, setEmbeddedMatcher } from "./runtime_ports.js";
afterEach(() => { configureMatcherRuntime(); setEmbeddedMatcher(false); });
it("standalone computation has no implicit backend collector or publication side effects", async () => {
  expect(collectorRuntime.getCollectorHotSnapshot()).toBeUndefined();
  expect(collectorRuntime.getCollectorFullSnapshot()).toBeUndefined();
  await expect(publishCommittedClientMatches()).resolves.toBeUndefined();
  expect(isEmbeddedMatcher()).toBe(false);
});
it("calls explicitly installed collector and commit ports", async () => {
  const publish = vi.fn(); const patch = vi.fn();
  configureMatcherRuntime({ getCollectorFullSnapshot: () => ({ hasMatches: true }),
    clientMatchesCommitted: publish, patchCollectorMatchClientIds: patch });
  setEmbeddedMatcher(true);
  expect(isEmbeddedMatcher()).toBe(true);
  expect(collectorRuntime.getCollectorFullSnapshot()).toEqual({ hasMatches: true });
  const rows = [{ ID: 1 }]; collectorRuntime.patchCollectorMatchClientIds(rows);
  await publishCommittedClientMatches();
  expect(patch).toHaveBeenCalledWith(rows); expect(publish).toHaveBeenCalledOnce();
});
