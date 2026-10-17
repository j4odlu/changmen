/** [changmen 扩展] Browser/site-local observation preferences; no trading or feed ownership. */
export const PM_BOOK_KEYS = {
  localBook: "changmen:pm:local-book",
  shadow: "changmen:pm:ws-book-shadow",
} as const;
export type PmBookSetting = keyof typeof PM_BOOK_KEYS;
const listeners = new Set<(key: string) => void>();

export function readPmBookSettings(): Record<PmBookSetting, boolean> {
  try {
    return { localBook: localStorage.getItem(PM_BOOK_KEYS.localBook) === "1",
      shadow: localStorage.getItem(PM_BOOK_KEYS.shadow) === "1" };
  }
  catch { return { localBook: false, shadow: false }; }
}

export function setPmBookSetting(setting: PmBookSetting, enabled: boolean): void {
  if (setting === "shadow" && enabled && !readPmBookSettings().localBook)
    throw new Error("请先开启本地订单簿");
  const key = PM_BOOK_KEYS[setting];
  if (enabled) localStorage.setItem(key, "1");
  else localStorage.removeItem(key);
  // Native storage events only reach other documents. Notify this tab after a successful write.
  for (const listener of listeners) { try { listener(key); } catch { /* optional observer */ } }
}

export function onPmBookSettingChange(listener: (key: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
