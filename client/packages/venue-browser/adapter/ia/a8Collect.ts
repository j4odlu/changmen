/**
 * A8 `wQe` / `CQe`：IA 采集默认对象（gateway 写死，token 为空字符串）。
 * 与 `@changmen/platform-probes/ia/collect_credentials.js` 同步。
 *
 * HTTP 走 `pc.`：apex `ilustre-analytics.org` 当前无 A/AAAA，扩展代发会 NAME_NOT_RESOLVED。
 * 官网页本身就是 `pc.ilustre-analytics.org`（CNAME → wcdnga）。
 */
export const IA_A8_COLLECT = {
  gateway: "https://pc.ilustre-analytics.org",
  token: "",
  betName: "([全场].+获胜$)|([地图\\d].+获胜者$)",
  games: ["1", "2", "3", "16", "43"],
} as const;

/** A8 `wQe` 内联 `t` → HTTP / WS 共用 */
export function iaCollectPlatform() {
  return {
    Gateway: IA_A8_COLLECT.gateway,
    Token: IA_A8_COLLECT.token,
    BetName: IA_A8_COLLECT.betName,
    Games: [...IA_A8_COLLECT.games] as string[],
  };
}
