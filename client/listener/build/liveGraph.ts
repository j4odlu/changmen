import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { repoRoot } from "./paths.mjs";
const forbidden = [
  "client/web/src/stores/betting/a8/runA8ArbRound.ts",
];
export function liveGraph(): Plugin {
  return {
    name: "listener-live-isolated-entry",
    generateBundle() {
      const modules = [...this.getModuleIds()].filter(id => !id.startsWith("\0") && !id.includes("node_modules"))
        .map(id => id.split("?")[0]!).filter(id => fs.existsSync(id) && fs.statSync(id).isFile());
      const unique = [...new Set(modules)].map(id => ({
        path: path.relative(repoRoot, id).replaceAll("\\", "/"),
        sha256: createHash("sha256").update(fs.readFileSync(id)).digest("hex"),
      }));
      for (const item of unique) if (forbidden.includes(item.path) || item.path.startsWith("server/")) this.error(`Forbidden legacy runtime: ${item.path}`);
      const required = ["client/web/src/main.ts", "client/web/src/App.vue", "client/web/src/router/index.ts", "client/web/src/stores/matchStore.ts", "client/web/src/stores/match/mainBetLoop.ts",
        "client/web/src/stores/betting/runArbBetRound.ts", "client/web/src/stores/betting/autoBet/phases/prepareArbAttempt.ts",
        "client/web/src/stores/betting/autoBet/phases/checkArbLegs.ts", "client/web/src/runtime/appSession.ts"];
      for (const expected of required) if (!unique.some(item => item.path === expected)) this.error(`Missing shared original behavior: ${expected}`);
      this.emitFile({ type: "asset", fileName: "isolation-manifest.json", source: JSON.stringify({
        stage: "listener-integrated", trading: "user-config", accounts: "existing-session", forbidden, required, modules: unique,
      }, null, 2) });
    },
  };
}
