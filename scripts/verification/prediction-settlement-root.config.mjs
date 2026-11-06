import original from "../../vitest.config.mjs";
import { settlementTests } from "./prediction-settlement-policy.mjs";

export default {
  ...original,
  test: { ...original.test, include: settlementTests.rulesAndPersistence, passWithNoTests: false },
};
