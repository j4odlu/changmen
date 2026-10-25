import { expect, it } from "vitest";
import { resolveUiGame } from "./game_ui.js";

it("classifies RAY and PM basketball for matcher venue rows", () => {
  expect(resolveUiGame("RAY", 1072082)).toEqual({ code: "basketball", name: "篮球" });
  expect(resolveUiGame("RAY", 70)).toEqual({ code: "lol", name: "英雄联盟" });
  expect(resolveUiGame("RAY", 140)).toEqual({ code: "cs2", name: "CS:GO" });
  expect(resolveUiGame("Polymarket", "basketball")).toEqual({ code: "basketball", name: "篮球" });
});
