import { defineConfig, mergeConfig } from "vitest/config";
import liveConfig from "./vite.live.config";
export default mergeConfig(liveConfig, defineConfig({ test: {
  include: [
    "../web/src/api/auth.cookie.test.ts",
    "../web/src/lib/sessionRefresh.cookieOnly.test.ts",
    "../web/src/stores/betting/autoBet/executeArbBet.test.ts",
    "../web/src/stores/betting/autoBet/phases/prepareArbAttempt*.test.ts",
    "../web/src/stores/betting/autoBet/phases/checkArbLegs*.test.ts",
    "../web/src/stores/betting/autoBet/phases/placeArbLegs.test.ts",
    "../web/src/orderModes/gtc/fokIsolation.test.ts",
    "../web/src/orderModes/gtc/manual.test.ts",
    "../web/src/stores/account/gtcOrderSync.test.ts",
    "../web/src/runtime/sessionWalletLifecycle.test.ts",
    "../web/src/stores/match/mainBetLoop.test.ts",
    "../web/src/stores/betting/runArbBetRound.test.ts",
  ],
  setupFiles: ["../web/src/test/vitestSetupCore.ts"],
} }));
