const VENUE_GAMES: Record<string, readonly string[]> = {
  OB: [
    "257578064923863",
    "257561197207055",
    "271192272576750",
    "257154660915053",
    "257289795134339",
  ],
  RAY: ["140", "74", "37197927", "70", "151"],
  PB: ["cs2", "king-of-glory", "valorant", "league-of-legends", "dota-2"],
  TF: ["1", "14", "24", "3", "2"],
  IA: ["3", "16", "43", "1", "2"],
  IMT: ["43"],
  SABA: ["43"],
  Stake: ["counter-strike", "kings-of-glory", "valorant", "league-of-legends", "dota-2"],
  Dex: ["csgo", "king-of-glory", "valorant", "lol", "dota2"],
  Polymarket: ["cs2", "kog", "valorant", "lol", "dota2"],
  IM: ["47", "48", "65", "45", "46"],
  XBet: ["43"],
};

export function getStaticVenueGames(provider: string): string[] {
  return [...(VENUE_GAMES[provider] ?? [])];
}
