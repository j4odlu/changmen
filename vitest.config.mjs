import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      ".claude/worktrees/**",
      // Generated release checkouts are evidence artifacts, not this workspace's source tests.
      "output/**",
    ],
  },
});
