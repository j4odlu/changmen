/** Host integration. Matcher never imports backend internals; absent auth fails closed. */
let embedded = false;
let ports = {};
export function configureMatcherRuntime(next = {}) { ports = { ...next }; }
export function setEmbeddedMatcher(enabled = true) { embedded = !!enabled; }
export function isEmbeddedMatcher() { return embedded; }
export const collectorRuntime = {
  getCollectorFullSnapshot: () => ports.getCollectorFullSnapshot?.(),
  getCollectorHotSnapshot: () => ports.getCollectorHotSnapshot?.(),
  patchCollectorMatchClientIds: rows => ports.patchCollectorMatchClientIds?.(rows),
};
export async function publishCommittedClientMatches() {
  await ports.clientMatchesCommitted?.();
}
export function removeClientMatchFromMemory(id) { ports.removeClientMatch?.(id); }
export function matcherAuthPort() {
  if (!ports.auth) throw new Error("Matcher host authentication is not configured");
  return ports.auth;
}
