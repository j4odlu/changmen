import {
  createPmWsSourceModeStore,
  pmWsSourceModeLabel,
  type PmWsSourceMode,
} from "./pmWsSourceMode";

const store = createPmWsSourceModeStore("changmen:pm:market-ws-source-mode");

export type PmMarketWsSourceMode = PmWsSourceMode;

export const getPmMarketWsSourceMode = store.get;
export const setPmMarketWsSourceMode = store.set;
export const cyclePmMarketWsSourceMode = store.cycle;
export const resetPmMarketWsSourceModeForTests = store.resetForTests;
export function pmMarketWsSourceModeLabel(mode: PmMarketWsSourceMode = store.get()): string {
  return pmWsSourceModeLabel(mode);
}
