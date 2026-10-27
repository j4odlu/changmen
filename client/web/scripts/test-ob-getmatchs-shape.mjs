#!/usr/bin/env node
/**
 * OB saveMatch/saveBets → Client_GetMatchs 形态校验（对照 TJ01 Sources.OB 字段）
 *
 * 离线：用 composer 原生盘口投影合成一条 OB 行，不依赖 live OB。
 * 可选：ESPORT_TEST_BASE=http://127.0.0.1:3456 登录后拉 Client_GetMatchs 抽样 OB 行。
 *
 * 用法：node scripts/test-ob-getmatchs-shape.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assert,
  esportPost,
  loginEsport,
  resolveEsportBase,
} from "./ob-test-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { nativeSourcesByMap } = await import("../../../server/match/matcher/compose/normalize/native_bets.ts");

const TJ01_PATH = path.resolve(__dirname, "../../../TJ01.JSON");

const OB_SOURCE_KEYS = ["Type", "BetID", "HomeID", "HomeOdds", "AwayID", "AwayOdds"];
const BET_ROW_KEYS = ["ID", "MatchID", "Map", "Name", "HomeID", "HomeName", "AwayID", "AwayName", "Status", "Sources"];
const MATCH_ROW_KEYS = ["ID", "Title", "StartTime", "Game", "GameID", "Matchs", "Bets"];

function validateObSource(src, label) {
  assert(src && typeof src === "object", `${label}: Sources.OB 缺失`);
  for (const k of OB_SOURCE_KEYS) {
    assert(k in src, `${label}: Sources.OB 缺字段 ${k}`);
  }
  assert(src.Type === "OB", `${label}: Sources.OB.Type 应为 OB`);
  assert(String(src.BetID).length > 0, `${label}: BetID 为空`);
  assert(String(src.HomeID).length > 0, `${label}: HomeID 为空`);
  assert(String(src.AwayID).length > 0, `${label}: AwayID 为空`);
}

function validateBetRow(bet, label) {
  for (const k of BET_ROW_KEYS) {
    assert(k in bet, `${label}: Bets 行缺字段 ${k}`);
  }
  validateObSource(bet.Sources?.OB, label);
}

function validateMatchRow(row, label, { requireId = true } = {}) {
  const keys = requireId ? MATCH_ROW_KEYS : MATCH_ROW_KEYS.filter(k => k !== "ID");
  for (const k of keys) {
    assert(k in row, `${label}: 赛事行缺字段 ${k}`);
  }
  assert(row.Matchs?.OB, `${label}: Matchs.OB 缺失`);
  assert(Array.isArray(row.Bets) && row.Bets.length > 0, `${label}: Bets 为空`);
  for (const bet of row.Bets) validateBetRow(bet, `${label} Map${bet.Map}`);
}

function buildSyntheticObPipeline() {
  const sourceMatchId = "5388646815758798";
  const startTime = Date.now() + 20 * 60 * 1000;
  const match = {
    Type: "OB",
    SourceMatchID: sourceMatchId,
    SourceGameID: "271192272576750",
    StartTime: startTime,
    BO: 3,
    Home: "G2 Esports",
    HomeID: "1001",
    Away: "NRG",
    AwayID: "1002",
    Teams: [],
  };
  const bets = [
    {
      Type: "OB",
      SourceMatchID: sourceMatchId,
      Map: 0,
      SourceBetID: "5388705885691005",
      OddTypeID: "271248710253353",
      BetName: "[全场]-全局-获胜",
      SourceHomeID: "5388705885692156",
      HomeName: "G2 Esports",
      HomeOdds: 1.622,
      SourceAwayID: "5388705885692157",
      AwayName: "NRG",
      AwayOdds: 2.234,
      Status: "Normal",
    },
    {
      Type: "OB",
      SourceMatchID: sourceMatchId,
      Map: 1,
      SourceBetID: "5388710877426817",
      OddTypeID: "8033515352779661",
      BetName: "[地图1]-单局-获胜",
      SourceHomeID: "5388710877427935",
      HomeName: "G2 Esports",
      HomeOdds: 1.07,
      SourceAwayID: "5388710877427936",
      AwayName: "NRG",
      AwayOdds: 7.736,
      Status: "Normal",
    },
  ];
  const betsStore = { [`OB:${sourceMatchId}`]: { provider: "OB", matchId: sourceMatchId, bets } };
  const sourcesByMap = nativeSourcesByMap("OB", sourceMatchId, betsStore, "valorant");
  const obRow = {
    Title: `${match.Home} vs ${match.Away}`,
    StartTime: match.StartTime,
    Game: { code: "valorant" },
    GameID: match.SourceGameID,
    Matchs: { OB: sourceMatchId },
    Bets: [...sourcesByMap.entries()].map(([map, source]) => {
      const raw = bets.find(b => Number(b.Map) === map);
      return {
        ID: 0,
        MatchID: 0,
        Map: map,
        Name: raw?.BetName || "",
        HomeID: source.HomeID,
        HomeName: match.Home,
        AwayID: source.AwayID,
        AwayName: match.Away,
        Status: source.Status,
        Sources: { OB: source },
      };
    }),
  };
  validateMatchRow(obRow, "synthetic", { requireId: false });

  for (const inp of bets) {
    const row = obRow.Bets.find(b => b.Map === inp.Map);
    assert(row, `Map ${inp.Map} 未出现在 Bets`);
    const ob = row.Sources.OB;
    assert(ob.BetID === String(inp.SourceBetID), `Map${inp.Map} BetID 不一致`);
    assert(ob.HomeID === String(inp.SourceHomeID), `Map${inp.Map} HomeID 不一致`);
    assert(ob.AwayID === String(inp.SourceAwayID), `Map${inp.Map} AwayID 不一致`);
  }
  console.log("[ob-getmatchs] 离线合成 PASS", {
    title: obRow.Title,
    matchsOb: obRow.Matchs.OB,
    betMaps: obRow.Bets.map(b => b.Map),
  });
  return { match, bets, obRow };
}

function validateTj01Sample() {
  if (!fs.existsSync(TJ01_PATH)) {
    console.log("[ob-getmatchs] 跳过 TJ01（文件不存在）");
    return;
  }
  const tj = JSON.parse(fs.readFileSync(TJ01_PATH, "utf8"));
  const row = tj.info?.[0];
  assert(row, "TJ01 info[0] 缺失");
  validateMatchRow(row, "TJ01[0]");
  const obBet = row.Bets.find(b => b.Sources?.OB);
  assert(obBet, "TJ01 无 Sources.OB 样例");
  console.log("[ob-getmatchs] TJ01 样例行 PASS", {
    title: row.Title,
    obBetId: obBet.Sources.OB.BetID,
    map: obBet.Map,
  });
}

async function validateLiveGetMatchs() {
  const base = resolveEsportBase();
  if (!base || process.env.ESPORT_TEST_SKIP_LIVE === "1") {
    console.log("[ob-getmatchs] 跳过 live Client_GetMatchs（未设 ESPORT_TEST_BASE 或 ESPORT_TEST_SKIP_LIVE=1）");
    return;
  }
  let token;
  let userName;
  try {
    ({ token, userName } = await loginEsport(base));
  }
  catch (e) {
    console.log("[ob-getmatchs] 跳过 live Client_GetMatchs（登录失败，需 RDS 有效账号）:", e.message);
    return;
  }

  const { json: data } = await esportPost(
    base,
    "Client_GetMatchs",
    {},
    { token, query: `?user=${encodeURIComponent(userName)}` },
  );
  assert(data.success === 1 && Array.isArray(data.info), "GetMatchs 失败");
  const obRows = data.info.filter(r => r.Matchs?.OB);
  if (!obRows.length) {
    console.log("[ob-getmatchs] live: 无 OB 行（需 CollectConfig 开 OB 且已采集）");
    return;
  }
  validateMatchRow(obRows[0], "live[0]");
  console.log("[ob-getmatchs] live Client_GetMatchs PASS", {
    obRows: obRows.length,
    sample: obRows[0].Title,
  });
}

async function main() {
  buildSyntheticObPipeline();
  validateTj01Sample();
  await validateLiveGetMatchs();
  console.log("[ob-getmatchs] ALL PASS");
}

main().catch((e) => {
  console.error("[ob-getmatchs] FAIL", e.message);
  process.exit(1);
});
