import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [{
    name: "rds-test-strip-hashbang",
    enforce: "pre",
    transform(code) {
      // Vitest wraps imported CLI scripts in a function, where a hashbang is invalid.
      // Preserve the newline so stack traces retain the original source line numbers.
      if (code.startsWith("#!")) return { code: code.replace(/^#![^\r\n]*/, ""), map: null };
    },
  }],
  test: {
    setupFiles: ["../scripts/testing/offline-env.mjs"],
    exclude: [...configDefaults.exclude, "*.smoke.test.mjs"],
  },
});
