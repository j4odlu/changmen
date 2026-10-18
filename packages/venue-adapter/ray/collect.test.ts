import { beforeEach, describe, expect, test, vi } from "vitest";
import { handleRayRealtimeMessage } from "./collect";
import { RAY_A8_COLLECT } from "./a8Collect";

const isVenueOdds = vi.hoisted(() => vi.fn());
const saveVenueOdds = vi.hoisted(() => vi.fn());

vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({
  isVenueOdds,
  saveVenueOdds,
}));

describe("handleRayRealtimeMessage", () => {
  test("catalog-derived collector scope retains the original five games and order", () => {
    expect(RAY_A8_COLLECT.games).toEqual(["70", "151", "140", "74", "37197927"]);
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("saves known RAY odds updates and ignores unknown rows", () => {
    isVenueOdds.mockImplementation((platform: string, id: string) =>
      platform === "RAY" && id === "known",
    );

    handleRayRealtimeMessage(
      {
        source: "odds",
        odds: [
          { id: "known", odds: 1.92, status: 1 },
          { id: "unknown", odds: 2.1, status: 1 },
          { id: "", odds: 3.2, status: 2 },
        ],
      },
      12345,
    );

    expect(saveVenueOdds).toHaveBeenCalledOnce();
    expect(saveVenueOdds).toHaveBeenCalledWith(
      "RAY",
      {
        id: "known",
        odds: 1.92,
        isLock: false,
        time: 12345,
      },
      "mqtt",
    );
  });

  test("ignores non-odds messages", () => {
    handleRayRealtimeMessage({ source: "match", match: { id: "m1" } }, 12345);

    expect(isVenueOdds).not.toHaveBeenCalled();
    expect(saveVenueOdds).not.toHaveBeenCalled();
  });
});
