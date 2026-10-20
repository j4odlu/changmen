/**
 * Legacy compatibility constants for old diagnostic/tests.
 * Current RDS semantics: ended_at IS NULL = visible (Client_GetMatchs);
 * ended_at set = ended (identity retained). History table is cold storage only.
 */

export const CLIENT_MATCH_LIST_HIDDEN = -1;

export const CLIENT_MATCH_LIST_DEFAULT = 0;

/** @param {number|null|undefined} listStatus */
export function isClientMatchListVisible(listStatus) {
  return Number(listStatus) !== CLIENT_MATCH_LIST_HIDDEN;
}
