import { describe, expect, test } from "vitest";
import { isPbAllowedSourceGameId } from "./gameFilter";

describe("isPbAllowedSourceGameId", () => {
  const catalogGames = ["cs2", "king-of-glory", "valorant", "league-of-legends", "dota-2"];

  test("exact match like A8 e.games.includes", () => {
    expect(isPbAllowedSourceGameId("cs2", catalogGames)).toBe(true);
    expect(isPbAllowedSourceGameId("valorant", catalogGames)).toBe(true);
    expect(isPbAllowedSourceGameId("unknown-game", catalogGames)).toBe(false);
  });

  test("accepts euro/odds cs-go when platform games list has catalog cs2", () => {
    expect(isPbAllowedSourceGameId("cs-go", catalogGames)).toBe(true);
    expect(isPbAllowedSourceGameId("cs", catalogGames)).toBe(true);
    expect(isPbAllowedSourceGameId("counter-strike", catalogGames)).toBe(true);
  });

  test("accepts kog / kings-of-glory aliases for king-of-glory", () => {
    expect(isPbAllowedSourceGameId("kog", catalogGames)).toBe(true);
    expect(isPbAllowedSourceGameId("kings-of-glory", catalogGames)).toBe(true);
  });

  test("empty platform games rejects all", () => {
    expect(isPbAllowedSourceGameId("cs-go", [])).toBe(false);
  });
});
