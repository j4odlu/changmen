import assert from "node:assert/strict";

/** [changmen 扩展] 只还原用户明确要求的异常比赛禁投条件；原始固定基线和正常比赛业务全文保护不变。 */
export function restoreRayMatchRiskSource(file, source) {
  const sharedImport = 'import { isRayMatchRiskClosed, RAY_MATCH_RISK_MESSAGE } from "@changmen/venue-adapter/ray";\n';
  const hooks = {
    "packages/venue-adapter/ray/index.ts": ['export { isRayMatchRiskClosed, RAY_MATCH_RISK_MESSAGE } from "./rayMatchRisk";\n'],
    "client/web/src/stores/betting/autoBet/executeArbBet.ts": [sharedImport,
      '  if (isRayMatchRiskClosed(params.match)) { params.setMessage(RAY_MATCH_RISK_MESSAGE); return; }\n',
      '    if (isRayMatchRiskClosed(params.match)) {\n      observationOutcome = "blocked";\n      params.setMessage(RAY_MATCH_RISK_MESSAGE);\n      releaseSingleLeg9999Reservation(params.match.id, params.bet.round, readyValue);\n      reservationReleased = true;\n      syncActiveBetFail(params.bet.id, RAY_MATCH_RISK_MESSAGE, "预检");\n      attempt.trace?.finish("fail", RAY_MATCH_RISK_MESSAGE);\n      recordArbAttemptMetric({ ...base, phaseMs: phaseMsMap, stop: "skip_check" });\n      return;\n    }\n\n',
    ],
    "client/web/src/stores/betting/execution/manual.ts": [sharedImport,
      '  if (isRayMatchRiskClosed(context.match)) { context.setMessage(RAY_MATCH_RISK_MESSAGE); return; }\n',
    ],
    "client/web/src/orderModes/fok/manual.ts": [sharedImport,
      '  if (isRayMatchRiskClosed(match)) { setMessage(RAY_MATCH_RISK_MESSAGE); return; }\n',
    ],
    "client/web/src/stores/betting/placeValueBet.ts": ['import { isRayMatchRiskClosed } from "@changmen/venue-adapter/ray";\n',
      'isRayMatchRiskClosed(match) || ',
    ],
    "client/web/src/stores/betting/a8/runA8ArbRound.ts": ['import { isRayMatchRiskClosed } from "@changmen/venue-adapter/ray";\n',
      '    if (isRayMatchRiskClosed(match)) continue;\n',
    ],
    "client/web/src/extensions/valueBet/valueBetAutoBet.ts": ['import { isRayMatchRiskClosed } from "@changmen/venue-adapter/ray";\n',
      '    if (isRayMatchRiskClosed(match)) continue;\n',
    ],
  }[file];
  if (!hooks) return source;
  source = source.replaceAll("\r\n", "\n");
  if (hooks.every(hook => !source.includes(hook))) {
    assert(!/isRayMatchRiskClosed|RAY_MATCH_RISK_MESSAGE|rayMatchRisk/.test(source), `${file}: unregistered RAY abnormal-match guard`);
    return source;
  }
  for (const hook of hooks) {
    assert.equal(source.split(hook).length, 2, `${file}: exact RAY abnormal-match guard`);
    source = source.replace(hook, "");
  }
  return source;
}
