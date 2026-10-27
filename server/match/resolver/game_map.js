/**
 * 内部 gameCode → 各数据源 slug 映射
 * gameCode 与 packages/shared/catalog/game_catalog*.json 对齐（电竞 + 体育经 game_catalog.ts 合并）
 */
export const GAME_MAP = {
  cs2: {
    pandascore: "cs-go",
    pandascoreEndpoint: "csgo",
    label: "CS2",
  },
  lol: {
    pandascore: "league-of-legends",
    pandascoreEndpoint: "lol",
    label: "League of Legends",
  },
  dota2: {
    pandascore: "dota-2",
    pandascoreEndpoint: "dota2",
    label: "Dota 2",
  },
  valorant: {
    pandascore: "valorant",
    pandascoreEndpoint: "valorant",
    label: "Valorant",
  },
  kog: {
    pandascore: null,
    pandascoreEndpoint: null,
    label: "Honor of Kings",
  },
};

export function getPandascoreSlug(gameCode) {
  return GAME_MAP[gameCode]?.pandascore ?? null;
}

export function getPandascoreEndpoint(gameCode) {
  return GAME_MAP[gameCode]?.pandascoreEndpoint ?? null;
}

export function getSupportedGameCodes() {
  return Object.keys(GAME_MAP);
}
