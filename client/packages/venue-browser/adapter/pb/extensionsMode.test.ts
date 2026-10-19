import { describe, expect, test } from "vitest";
import {
  isPbChangmenExtensions,
  isPbLiveFoOnly,
  isPbPrematchCollectEnabled,
  setPbChangmenExtensions,
} from "./extensionsMode";

describe("pb extensionsMode", () => {
  test("default A8: live fo only, no prematch collect", () => {
    setPbChangmenExtensions(false);
    expect(isPbChangmenExtensions()).toBe(false);
    expect(isPbLiveFoOnly()).toBe(true);
    expect(isPbPrematchCollectEnabled()).toBe(false);
  });

  test("changmen extensions: dual fo + prematch", () => {
    setPbChangmenExtensions(true);
    expect(isPbChangmenExtensions()).toBe(true);
    expect(isPbLiveFoOnly()).toBe(false);
    expect(isPbPrematchCollectEnabled()).toBe(true);
    setPbChangmenExtensions(false);
  });
});
