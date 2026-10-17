import type { MarketStreamEvent, MarketStreamState } from "./marketStreamProtocol";

// [changmen 扩展] No retained frames, timers, subscriptions or network handles.
let state: MarketStreamState = Object.freeze({ epoch: 0, source: "official", open: false });
let sequence = 0;
const observers = new Set<(event: MarketStreamEvent) => void>();
function emit(event: MarketStreamEvent): void {
  for (const observer of observers) {
    try { observer(event); } catch { observers.delete(observer); }
  }
}
export function observePmMarketStream(observer: (event: MarketStreamEvent) => void): () => void {
  if (observers.size >= 4) throw new Error("market observer capacity");
  observers.add(observer);
  try { observer(Object.freeze({ type: "state", state })); } catch { observers.delete(observer); }
  return () => { observers.delete(observer); };
}
/** Producer hooks are observational: never call transport/quote code. */
export function notePmStreamConnecting(source: MarketStreamState["source"]): number {
  state = Object.freeze({ epoch: state.epoch + 1, source, open: false }); sequence = 0;
  if (observers.size) emit(Object.freeze({ type: "state", state }));
  return state.epoch;
}
export function notePmStreamOpen(epoch: number, open: boolean): void {
  if (epoch !== state.epoch) return;
  state = Object.freeze({ ...state, open });
  if (observers.size) emit(Object.freeze({ type: "state", state }));
}
export function capturePmStreamTime(): number {
  return observers.size ? performance.timeOrigin + performance.now() : 0;
}
export function notePmStreamFrame(epoch: number, raw: string, wallAt: number, receivedAt: number): void {
  if (!observers.size || epoch !== state.epoch || !state.open || raw === "PONG") return;
  emit(Object.freeze({ type: "frame", epoch, sequence: ++sequence,
    receivedAt, wallAt, raw }));
}
