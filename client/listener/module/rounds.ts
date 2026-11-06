import type { A8ArbRoundContext } from "../../web/src/stores/betting/a8/runA8ArbRound";
interface ListenerHost {
  serialize: (run: () => Promise<void>) => Promise<void>;
  scan: (setMessage: (message: string) => void) => Promise<void>;
}
let active: ListenerHost | undefined;
export function registerListenerHost(host: ListenerHost): () => void {
  active = host;
  return () => { if (active === host) active = undefined; };
}
/** The original host still owns its tick, state updates, finally, delay and rescheduling. */
export function runListenerMaintenance(run: () => Promise<void>): Promise<void> {
  return active ? active.serialize(run) : run();
}
/** Only the market source of the original bind/arb/makeup chain changes. */
export async function runA8ArbRound(context: A8ArbRoundContext): Promise<void> {
  await active?.scan(context.setMessage);
}
