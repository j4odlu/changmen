import { getPmMarketWsSourceMode, setPmMarketWsSourceMode, type PmMarketWsSourceMode } from "./pmMarketWsMode";
import { setPmUserWsSourceMode } from "./pmUserWsMode";

const PM_ROUTING_PREFERENCE_KEY = "changmen:pm:routing-preference";

export type PmRoutingPreference = "auto" | "official" | "relay";

const ORDER: PmRoutingPreference[] = ["auto", "official", "relay"];

function normalize(value: unknown): PmRoutingPreference {
  return value === "official" || value === "relay" ? value : "auto";
}

export function getPmRoutingPreference(): PmRoutingPreference {
  try {
    return normalize(globalThis.localStorage?.getItem(PM_ROUTING_PREFERENCE_KEY));
  }
  catch {
    return "auto";
  }
}

export function setPmRoutingPreference(pref: PmRoutingPreference): PmRoutingPreference {
  const next = normalize(pref);
  try {
    if (next === "auto")
      globalThis.localStorage?.removeItem(PM_ROUTING_PREFERENCE_KEY);
    else
      globalThis.localStorage?.setItem(PM_ROUTING_PREFERENCE_KEY, next);
  }
  catch {
    /* ignore */
  }
  return next;
}

export function clearPmRoutingPreference(): void {
  setPmRoutingPreference("auto");
}

export function resetPmRoutingPreferenceForTests(): void {
  clearPmRoutingPreference();
}

export function pmRoutingPreferenceLabel(pref: PmRoutingPreference = getPmRoutingPreference()): string {
  if (pref === "official")
    return "强制官方";
  if (pref === "relay")
    return "强制 relay";
  return "自动";
}

export function sourceModeForPmRoutingPreference(pref: PmRoutingPreference): PmMarketWsSourceMode | null {
  if (pref === "official")
    return "official";
  if (pref === "relay")
    return "changmen";
  return null;
}

export function applyPmRoutingPreference(pref: PmRoutingPreference): PmMarketWsSourceMode | null {
  const mode = sourceModeForPmRoutingPreference(pref);
  if (!mode)
    return null;
  setPmMarketWsSourceMode(mode);
  setPmUserWsSourceMode(mode);
  return mode;
}

export function cyclePmRoutingPreference(): PmRoutingPreference {
  const current = getPmRoutingPreference();
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? "auto";
  setPmRoutingPreference(next);
  return next;
}

export function sourceModeToPmRoutingPreference(mode: PmMarketWsSourceMode = getPmMarketWsSourceMode()): PmRoutingPreference {
  return mode === "official" ? "official" : "relay";
}
