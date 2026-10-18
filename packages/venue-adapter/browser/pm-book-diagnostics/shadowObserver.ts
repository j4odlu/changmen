/** [changmen 扩展] 无副作用的可选观察插槽；返回值永远不进入预检决策。 */
export interface ShadowAttempt {
  tokenId: string; gateway: string; tick: boolean; proxied: boolean; role: string;
  linkId?: number; attemptId?: string; executionId?: string; leg: string;
  simulation?: import("./executionMath").SimulationInput;
}
type Finish = (http: unknown, failed: boolean) => void;
type Observer = (attempt: Readonly<ShadowAttempt>) => Finish | undefined;
let observer: Observer | undefined;
export function registerWsBookShadowObserver(next: Observer): () => void {
  observer = next;
  return () => { if (observer === next) observer = undefined; };
}
export function beginWsBookShadow(attempt: ShadowAttempt): Finish {
  let finish: Finish | undefined;
  try { finish = observer?.(Object.freeze(attempt)); } catch { /* diagnostics cannot reject */ }
  return (http, failed) => { try { finish?.(http, failed); } catch { /* preserve HTTP result */ } };
}
