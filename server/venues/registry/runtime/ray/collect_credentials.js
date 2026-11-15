/** A8 控制台 bQe 采集凭证（写死，与 gamebet_frontend/console/index.js 一致） */
import { getConfiguredPlatformGameIds } from "@changmen/shared/catalog/game_catalog";

export const RAY_A8_COLLECT = {
  gateway: "https://cfinfo.365raylinks.com",
  token:
    "Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhcHBfa2V5IjoiY2QyNzZmZTQ5YmEyZTQ1YiIsImRhdGEiOnsidXNlcl9uYW1lIjoiaHVhMTk5NDMxIiwibG9iYnlfdXJsIjoiLyMvbG9naW4vIiwiaWF0IjoiNjM4NTQwNjkyOTkifX0.Y1k61j-43efe0UonN4mfpVMLvaSlFZihGeLCxYV4tKM",
  betName: "^获胜者$",
  games: getConfiguredPlatformGameIds("RAY"),
};

export function getRayA8CollectCredentials() {
  return {
    gateway: RAY_A8_COLLECT.gateway,
    token: RAY_A8_COLLECT.token,
    betName: RAY_A8_COLLECT.betName,
    games: [...RAY_A8_COLLECT.games],
    provider: "RAY",
  };
}
