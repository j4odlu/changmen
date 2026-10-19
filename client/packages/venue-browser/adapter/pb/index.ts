import type { PlatformAdapter } from "../contract";
import { pbProvider } from "./bet";
import { startPbCollector } from "./collect";

export { pbProvider, startPbCollector };
export * from "./auth";
export * from "./bet";
export * from "./collect";
export * from "./tabId";
export * from "./liveCredential";
export {
  countPbWsShadowBySource,
  getPbWsShadow,
  getPbWsShadowRevision,
  listPbWsShadowIdsBySource,
  rememberPbRotEvent,
  replacePbWsShadowFromBoard,
  upsertPbWsShadowFromParsedMatch,
  resolvePbWsShadow,
  savePbWsShadow,
  seedPbWsShadowFromHttp,
  subscribePbWsShadow,
} from "./wsShadowOdds";
export {
  getPbAccountPageHosts,
  pbHostsFromAccounts,
  pbHostFromUrl,
  setPbAccountPageHosts,
} from "./accountHosts";
export {
  getPbWsPageDetect,
  isPbWsShadowUiAllowed,
  setPbWsShadowUiAllowed,
  startPbWsStatusPoll,
} from "./wsStatusPoll";
export {
  isPbChangmenExtensions,
  isPbLiveFoOnly,
  isPbPrematchCollectEnabled,
  setPbChangmenExtensions,
  setPbLiveFoOnly,
} from "./extensionsMode";

export const pbAdapter: PlatformAdapter = {
  id: "PB",
  collector: startPbCollector,
  provider: pbProvider,
};
