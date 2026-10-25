/**
 * 合同：sticky / ended 必须用全量 clientRows（含 gb / pm_sport），
 * align 才用 ForAlign 瘦行。
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveOrientationLock } from "../compose/sides/orientation_lock.js";
import { buildPmSportByClientId, isClientMatchEnded } from "../compose/shape/ended_filter.js";
import {
  GB_K27,
  GB_NIP,
  installPlugin,
  pmOb,
  pmRay,
} from "./fixtures.mjs";

describe("snapshot row contract", () => {
  it("sticky needs home_gb_team_id on existingRow (full fetch)", () => {
    installPlugin();
    const matches = { OB: { ob1: pmOb }, RAY: { ray1: pmRay } };
    const row = {
      Matchs: { OB: "ob1", RAY: "ray1" },
      Title: "K27 vs NiP",
    };
    // 全量行：能 sticky 脏锁
    const withGb = resolveOrientationLock(row, matches, {
      id: 1,
      home_gb_team_id: GB_K27,
      away_gb_team_id: GB_NIP,
    }, { stickyOrientation: true });
    assert.equal(withGb.lockSource, "existing");
    assert.equal(row.HomeGbTeamId, GB_K27);

    // 瘦 Align 行：无 gb → 只能走锚点 upgrade/新锁
    const row2 = {
      Matchs: { OB: "ob1", RAY: "ray1" },
      Title: "K27 vs NiP",
    };
    const lean = resolveOrientationLock(row2, matches, {
      id: 1,
      merge_key: "x",
      matchs: { OB: "ob1" },
      // 无 home_gb_team_id
    }, { stickyOrientation: true });
    assert.notEqual(lean.lockSource, "existing");
    assert.equal(row2.HomeGbTeamId, GB_NIP);
  });

  it("PM completion uses the full snapshot and matching identity regardless of OB live status", () => {
    const now = Date.now();
    const row = {
      ID: 9,
      StartTime: now - 60_000,
      Round: 0,
      Matchs: { Polymarket: "pm1", OB: "ob1" },
      Bets: [{
        Map: 1,
        Sources: { OB: { Status: "Locked" }, Polymarket: { Status: "Locked" } },
      }],
    };
    const matchesLive = {
      Polymarket: { pm1: { SourceMatchID: "pm1" } },
      OB: { ob1: { SourceMatchID: "ob1", IsLive: 2 } },
    };
    const matchesEnded = {
      Polymarket: { pm1: { SourceMatchID: "pm1" } },
      OB: { ob1: { SourceMatchID: "ob1", IsLive: 1 } },
    };
    const byPm = buildPmSportByClientId([{
      id: 9,
      pm_sport: { slug: "pm1", status: "finished", ended: true },
    }]);
    // PM 终态优先于 OB 仍进行中的状态。
    assert.equal(
      isClientMatchEnded(row, matchesLive, {}, now, byPm.get(9)),
      true,
    );
    // OB 也结束时，结论相同。
    assert.equal(
      isClientMatchEnded(row, matchesEnded, {}, now, byPm.get(9)),
      true,
    );
    // 瘦行无 pm_sport → 双 link 不归档
    assert.equal(
      isClientMatchEnded(row, matchesEnded, {}, now, null),
      false,
    );
  });
});
