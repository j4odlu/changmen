import { PLATFORMS } from "./platforms";

/**
 * 这些馆的 `checkBet` 不是报价查询，而是往**真实下单端点**打的探测单：
 * OB `POST /game/bet` a=1（等场馆回 Minimum），TF `POST /single-bet/` odds=-0.05。
 * 同一注单连打两次 = 重复提交，场馆会拒（OB 回「请勿重复提交」）。
 *
 * 编排层因此不得对它们「临下单再预检」，只能沿用预检那一次的冻价 POST（A8 freeze-and-POST）；
 * 冻价是否还能成交由场馆 POST 裁决（OB 回 `Odds error`）。
 * 报价型 checkBet（RAY `/v2/odds`、IM/IMT GetBetInfo 等）不受此限制，可重复调用。
 */
const CHECK_BET_PROBES_BET_ENDPOINT: ReadonlySet<string> = new Set([
  PLATFORMS.OB,
  PLATFORMS.TF,
]);

export function venueCheckBetProbesBetEndpoint(provider: unknown): boolean {
  return CHECK_BET_PROBES_BET_ENDPOINT.has(String(provider ?? "").trim().toUpperCase());
}
