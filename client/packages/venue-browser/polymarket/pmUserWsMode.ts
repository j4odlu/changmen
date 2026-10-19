import {
  createPmWsSourceModeStore,
  pmWsSourceModeLabel,
  type PmWsSourceMode,
} from "./pmWsSourceMode";

const store = createPmWsSourceModeStore("changmen:pm:user-ws-source-mode");

export type PmUserWsSourceMode = PmWsSourceMode;

export const getPmUserWsSourceMode = store.get;
export const setPmUserWsSourceMode = store.set;
export const cyclePmUserWsSourceMode = store.cycle;
export const resetPmUserWsSourceModeForTests = store.resetForTests;
export function pmUserWsSourceModeLabel(mode: PmUserWsSourceMode = store.get()): string {
  return pmWsSourceModeLabel(mode);
}
