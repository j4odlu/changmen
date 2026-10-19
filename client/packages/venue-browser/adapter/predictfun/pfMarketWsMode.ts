import {
  createPfWsSourceModeStore,
  pfWsSourceModeLabel,
  type PfWsSourceMode,
} from "./pfWsSourceMode";

const store = createPfWsSourceModeStore("changmen:pf:market-ws-source-mode");

export type PfMarketWsSourceMode = PfWsSourceMode;

export const getPfMarketWsSourceMode = store.get;
export const setPfMarketWsSourceMode = store.set;
export const cyclePfMarketWsSourceMode = store.cycle;
export const resetPfMarketWsSourceModeForTests = store.resetForTests;

export function pfMarketWsSourceModeLabel(mode: PfMarketWsSourceMode = store.get()): string {
  return pfWsSourceModeLabel(mode);
}
