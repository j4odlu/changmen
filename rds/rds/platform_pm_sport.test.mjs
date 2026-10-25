import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./common.js", () => ({ getPgPool: () => ({ query: mocks.query }) }));
import { fetchPlatformPmSports, writePlatformPmSports } from "./platform_pm_sport.js";
beforeEach(() => vi.clearAllMocks());

it("reads by exact PM identity and handles pre-collector rollout without inventing state", async () => {
  mocks.query.mockResolvedValue({ rows: [{ source_match_id: "123", pm_sport: { eventId: "123", status: "running" } }] });
  expect((await fetchPlatformPmSports(["123", "123"])).get("123").status).toBe("running");
  expect(mocks.query.mock.calls[0][1]).toEqual([["123"]]);
  expect(mocks.query.mock.calls[0][0]).toContain("platform = 'Polymarket'");
  mocks.query.mockRejectedValue(Object.assign(new Error("missing column"), { code: "42703" }));
  expect((await fetchPlatformPmSports(["123"])).size).toBe(0);
  mocks.query.mockRejectedValue(new Error("connection lost"));
  await expect(fetchPlatformPmSports(["123"])).rejects.toThrow("connection lost");
});

it("deduplicates an event batch with WS priority and writes no matching identities", async () => {
  mocks.query.mockResolvedValue({ rowCount: 1 });
  const ws = { eventId: "123", source: "ws", status: "running", updatedAt: 10 };
  const gamma = { eventId: "123", source: "gamma", status: "not_started", updatedAt: 20 };
  expect(await writePlatformPmSports([gamma, ws, gamma, { eventId: "invalid" }])).toBe(1);
  const [sql, args] = mocks.query.mock.calls[0];
  expect(JSON.parse(args[0])).toEqual([ws]);
  expect(sql).toContain("pm.source_match_id = incoming.snapshot->>'eventId'");
  expect(sql).toContain("UPDATE platform_matches pm SET pm_sport = incoming.snapshot");
  expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE) client_matches|SET match_id/i);
  expect(sql).toContain("IS DISTINCT FROM 'ws'");
  expect(sql).toContain("pm.pm_sport->>'updatedAt'");
  mocks.query.mockClear();
  expect(await writePlatformPmSports([])).toBe(0);
  expect(mocks.query).not.toHaveBeenCalled();
});
