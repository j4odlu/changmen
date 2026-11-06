import original from "../../client/web/vite.config.ts";
import { settlementTests } from "./prediction-settlement-policy.mjs";

// Keep the actual frontend aliases, Vue plugins and setup. Replace include;
// merging arrays would accidentally append the complete frontend suite.
export default async env => {
  const config = await (typeof original === "function" ? original(env) : original);
  return {
    ...config,
    test: {
      ...config.test,
      include: settlementTests.browserAndDisplay.map(file => "../../" + file),
      passWithNoTests: false,
    },
  };
};
