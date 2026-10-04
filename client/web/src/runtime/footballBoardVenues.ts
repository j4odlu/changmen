export const FOOTBALL_VENUE_TABS = [
  { key: "all", label: "全部" },
  { key: "OB", label: "OB" },
  { key: "Polymarket", label: "PM" },
  { key: "RAY", label: "RAY" },
] as const;

export type FootballVenueTab = (typeof FOOTBALL_VENUE_TABS)[number]["key"];

export function footballMatchInVenue(
  match: { providers?: Record<string, string | number> },
  venue: FootballVenueTab,
): boolean {
  return venue === "all" || String(match.providers?.[venue] ?? "").trim() !== "";
}

export function footballMatchVenue(
  match: { providers?: Record<string, string | number> },
): FootballVenueTab {
  return FOOTBALL_VENUE_TABS.find(tab => tab.key !== "all" && footballMatchInVenue(match, tab.key))?.key ?? "all";
}
