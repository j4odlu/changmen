/** Explicit current wire fixture; callers choose decimal assets instead of relying on legacy inference. */
export const gammaV1 = (ids: readonly string[], fields: Record<string, unknown> = {}) => ({
  version: "v1", clobTokenIds: JSON.stringify(ids), ...fields,
});
