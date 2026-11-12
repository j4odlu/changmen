import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { useUserStore } from "@/stores/userStore";
import { captureArbExecutionSelection } from "./selection";

vi.mock("@/stores/userStore", async () => {
  const { defineStore } = await import("pinia");
  return { useUserStore: defineStore("execution-selection-test", {
    state: () => ({ extensionPrefs: { arbExecutionMode: "normal" as "normal" | "lowOddsSingle" | "obSingle" } }),
  }) };
});

beforeEach(() => setActivePinia(createPinia()));

it.each(["normal", "lowOddsSingle", "obSingle"] as const)("freezes %s for the current attempt", mode => {
  const user = useUserStore();
  user.extensionPrefs.arbExecutionMode = mode;
  const selection = captureArbExecutionSelection();
  user.extensionPrefs.arbExecutionMode = "normal";
  expect(selection.executionMode).toBe(mode === "normal" ? undefined : mode);
  expect(Object.isFrozen(selection)).toBe(true);
});
