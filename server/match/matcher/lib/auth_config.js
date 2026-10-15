/** 仅开发显式开启；须 NODE_ENV=development|test，生产或未设置 NODE_ENV 时永远无效 */
export function isMatcherSkipAuthEnabled() {
  if (String(process.env.MATCHER_SKIP_AUTH || "").trim() !== "1")
    return false;
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  return nodeEnv === "development" || nodeEnv === "test";
}
