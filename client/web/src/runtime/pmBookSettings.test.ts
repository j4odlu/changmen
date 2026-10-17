import { afterEach, expect, test, vi } from "vitest";
import { onPmBookSettingChange, PM_BOOK_KEYS, readPmBookSettings, setPmBookSetting } from "./pmBookSettings";

afterEach(() => { vi.restoreAllMocks(); for (const key of Object.values(PM_BOOK_KEYS)) localStorage.removeItem(key); });
test("missing/invalid preferences remain off; shadow cannot start its dependency", () => {
  localStorage.setItem(PM_BOOK_KEYS.localBook, "true");
  expect(readPmBookSettings()).toEqual({ localBook: false, shadow: false });
  expect(() => setPmBookSetting("shadow", true)).toThrow();
  expect(localStorage.getItem(PM_BOOK_KEYS.localBook)).toBe("true");
});
test("master and consumer stay independent; disabling master retains the consumer preference", () => {
  const listener = vi.fn(), stop = onPmBookSettingChange(listener);
  try {
    setPmBookSetting("localBook", true); setPmBookSetting("shadow", true);
    setPmBookSetting("shadow", false); expect(readPmBookSettings().localBook).toBe(true);
    setPmBookSetting("shadow", true); setPmBookSetting("localBook", false);
    expect(readPmBookSettings()).toEqual({ localBook: false, shadow: true });
    expect(listener).toHaveBeenCalledTimes(5);
    stop(); setPmBookSetting("shadow", false); expect(listener).toHaveBeenCalledTimes(5);
  } finally { stop(); }
});
test("storage write failure is reported and never broadcasts a successful change", () => {
  const listener = vi.fn(), stop = onPmBookSettingChange(listener);
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("denied"); });
  try {
    expect(() => setPmBookSetting("localBook", true)).toThrow("denied");
    expect(listener).not.toHaveBeenCalled(); expect(readPmBookSettings().localBook).toBe(false);
  } finally { stop(); }
});
