import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["../../scripts/testing/offline-env.mjs"],
    exclude: [...configDefaults.exclude,
      "core/account/user_login_meta.test.mjs", "core/account/user_presence.test.mjs"],
  },
});
