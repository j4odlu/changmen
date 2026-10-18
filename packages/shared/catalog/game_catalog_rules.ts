import gameCatalog from "./game_catalog.json" with { type: "json" };

interface CollectionSettings {
  order?: number;
  sportKeys?: string[];
  fallbackSeriesIds?: string[];
  textPattern?: string;
  textMatchOrder?: number;
}

interface PlatformSettings {
  aliases?: string[];
  caseInsensitiveAliases?: boolean;
  collection?: CollectionSettings;
}

interface ConfiguredGame {
  code: string;
  sport?: string;
  platforms?: Partial<Record<string, string>>;
  platformSettings?: Partial<Record<string, PlatformSettings>>;
}

const games: ConfiguredGame[] = gameCatalog.games;

/** Shared alias lookup; each venue retains its configured case sensitivity. */
export function getConfiguredGameAlias(platform: string, id: string): string | null {
  for (const game of games) {
    const settings = game.platformSettings?.[platform];
    const key = settings?.caseInsensitiveAliases ? id.toLowerCase() : id;
    if (settings?.aliases?.includes(key))
      return game.code;
  }
  return null;
}

/** Static collector scope; AGGREGATE_GAME_CODES continues to affect the existing server helpers only. */
function collectionGames(platform: string) {
  return games
    .filter(game => (game.sport ?? "esport") === "esport" && game.platforms?.[platform])
    .map(game => ({
      code: game.code,
      id: game.platforms![platform]!,
      settings: game.platformSettings?.[platform]?.collection,
    }))
    .sort((a, b) => (a.settings?.order ?? Infinity) - (b.settings?.order ?? Infinity));
}

export function getConfiguredPlatformGameIds(platform: string): string[] {
  return collectionGames(platform).map(game => game.id);
}

export function getConfiguredPlatformDiscovery(platform: string) {
  const rows = collectionGames(platform);
  return {
    sportKeys: [...new Set(rows.flatMap(row => row.settings?.sportKeys ?? [row.id]))],
    fallbackSeriesIds: [...new Set(rows.flatMap(row => row.settings?.fallbackSeriesIds ?? []))],
  };
}

const textMatchers = new Map<string, Array<{ code: string; pattern: RegExp }>>();

/** Patterns and precedence live beside venue IDs in game_catalog.json. */
export function matchConfiguredPlatformGameText(platform: string, text: string): string | null {
  let matchers = textMatchers.get(platform);
  if (!matchers) {
    matchers = collectionGames(platform)
      .sort((a, b) => (a.settings?.textMatchOrder ?? Infinity) - (b.settings?.textMatchOrder ?? Infinity))
      .filter(row => row.settings?.textPattern)
      .map(row => ({ code: row.code, pattern: new RegExp(row.settings!.textPattern!, "i") }));
    textMatchers.set(platform, matchers);
  }
  return matchers.find(row => row.pattern.test(text))?.code ?? null;
}
