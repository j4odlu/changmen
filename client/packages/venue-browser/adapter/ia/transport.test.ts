import { describe, expect, test, vi } from "vitest";
import type { CollectPlatformInfo } from "@changmen/api-contract";
import { IA_PLUGIN_REQUIRED_MSG, iaCollectGet } from "./transport";

vi.mock("@changmen/client-core/chrome-plugin/bridge", () => ({
  hasA8PluginRuntime: () => false,
  a8PluginGet: vi.fn(),
  a8PluginPost: vi.fn(),
}));

const platform: CollectPlatformInfo = {
  Gateway: "https://pc.ilustre-analytics.org",
  Token: "",
  BetName: "([全场].+获胜$)|([地图\\d].+获胜者$)",
};

describe("ia transport plugin gate", () => {
  test("iaCollectGet without plugin throws", async () => {
    await expect(
      iaCollectGet(platform, "/api/game/game/gameListPageSplit/"),
    ).rejects.toThrow(IA_PLUGIN_REQUIRED_MSG);
  });
});
