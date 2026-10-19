#!/usr/bin/env node
/**
 * Live OB：用浏览�?home URL（含 token + addr）拉 game/view，验�?odd_type_id 采集过滤�? *
 * Usage:
 *   node devtools/platform-probes/ob/scripts/test_odd_type_collect_live.mjs "<home url>"
 *   OB_HOME_URL="<home url>" node devtools/platform-probes/ob/scripts/test_odd_type_collect_live.mjs
 *
 * Options:
 *   --max-matches N   默认 5
 *   --lang cn|en      默认 URL 里的 lang，否�?cn
 */

import * as Core from "../core.js";
import { obGet, pickGateway } from "../session.js";
import { getGameCodeForPlatformId } from "@changmen/shared/catalog/game_catalog";
import {
  getDefaultMarketCode,
  getPlatformRules,
  obLegacyWinBetName,
  obMatchesOddTypeId,
} from "@changmen/shared/catalog/market_catalog";

const BET_RE = new RegExp(
  "(\\[全场\\].+获胜)|(\\[地图\\d+\\].+获胜)|(.+全局.+获胜)|(.+单局.+获胜)",
);

function parseArgs(argv) {
  const out = { maxMatches: 5, lang: null, withinHours: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--max-matches") {
      out.maxMatches = Number(argv[++i]) || 5;
    } else if (a === "--within-hours") {
      out.withinHours = Number(argv[++i]) || 1;
    } else if (a === "--lang") {
      out.lang = argv[++i] || "cn";
    } else if (!a.startsWith("--") && !out.homeUrl) {
      out.homeUrl = a;
    }
  }
  out.homeUrl = out.homeUrl || process.env.OB_HOME_URL || "";
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function obBlockLabel(block) {
  const round = num(block.round);
  const cn = String(block.cn_name ?? "").replace(/&nbsp;/g, "");
  return `[${round === 0 ? "全场" : `地图${round}`}]-${cn}`;
}

function isObBlockCollectable(block, label, gameCode) {
  if (block.status === 12 || block.visible === 0) return { ok: false, via: "status" };

  const rules = getPlatformRules("OB", getDefaultMarketCode());
  const round = num(block.round);
  const oddTypeId = block.odd_type_id;

  if (gameCode && oddTypeId != null && String(oddTypeId) !== "") {
    const byId = obMatchesOddTypeId(block, rules, gameCode, round);
    if (byId === true) return { ok: true, via: "odd_type_id" };
    if (byId === false) return { ok: false, via: "odd_type_id_mismatch" };
  }

  if (!BET_RE.test(label)) return { ok: false, via: "betRe" };
  if (!obLegacyWinBetName(label)) return { ok: false, via: "legacy" };
  return { ok: true, via: "betName" };
}

function hasMainOdds(block) {
  const odds = Object.values(block.odds || {});
  const names = new Set(odds.map((o) => o.name));
  return names.has("@T1") && names.has("@T2");
}

function stageIdsForBo(bo) {
  const n = num(bo);
  if (n <= 1) return [0];
  return Array.from({ length: n + 1 }, (_, i) => i);
}

async function sessionFromHomeUrl(homeUrl, langOverride) {
  const entry = Core.parseObEntryUrl(homeUrl);
  if (!entry.token) throw new Error("home URL 缺少 token");
  const apis = entry.addr?.api || [];
  if (!apis.length) throw new Error("home URL addr 缺少 api");
  const lang = langOverride || entry.lang || "cn";
  const token = entry.token;
  const gateway = await pickGateway(apis, token, lang);
  return { gateway, token, lang, mqtt: (entry.addr?.mqtt || [])[0] || null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.homeUrl) {
    console.error("用法: node test_odd_type_collect_live.mjs \"<OB home url>\"");
    process.exit(1);
  }

  const session = await sessionFromHomeUrl(args.homeUrl, args.lang);
  console.log("[ob-live-odd] gateway:", session.gateway);
  console.log("[ob-live-odd] mqtt:", session.mqtt || "(�?");
  console.log("[ob-live-odd] token:", `${session.token.slice(0, 6)}�?{session.token.slice(-4)}`);

  const index = await obGet(
    session.gateway,
    "/game/index?game_id=0&flag=1&day=1",
    session.token,
    session.lang,
  );
  if (index.json.status === "false") {
    console.error("[ob-live-odd] game/index 失败:", index.json.data);
    process.exit(1);
  }

  const matches = Core.normalizeGameIndex(index.json);
  const now = Date.now();
  const horizon = now + args.withinHours * 3600 * 1000;
  const upcoming = matches.filter((m) => m.startTime < horizon);
  const sample = upcoming.slice(0, args.maxMatches);

  console.log("[ob-live-odd] matches:", {
    total: matches.length,
    within1h: upcoming.length,
    sampling: sample.length,
  });

  let totalBlocks = 0;
  let collected = 0;
  let viaOddType = 0;
  let viaBetName = 0;
  let rejectedPistol = 0;
  const failures = [];

  for (const m of sample) {
    const gameCode = getGameCodeForPlatformId("OB", m.gameId) || null;
    const stages = stageIdsForBo(m.bo);
    const matchCollected = [];

    for (const stageId of stages) {
      await new Promise((r) => setTimeout(r, 400));
      let view;
      try {
        view = await obGet(
          session.gateway,
          `/game/view?match_id=${m.matchId}&stage_id=${stageId}`,
          session.token,
          session.lang,
        );
      } catch (err) {
        failures.push({ matchId: m.matchId, stageId, error: err.message });
        continue;
      }
      if (view.json.status !== "true" || !Array.isArray(view.json.data)) continue;

      for (const block of view.json.data) {
        totalBlocks += 1;
        const label = obBlockLabel(block);
        const verdict = isObBlockCollectable(block, label, gameCode);
        const pistolLike = /手枪局|第\d+回合/.test(label);

        if (!verdict.ok) {
          if (pistolLike && verdict.via === "odd_type_id_mismatch") rejectedPistol += 1;
          continue;
        }
        if (!hasMainOdds(block)) continue;

        collected += 1;
        if (verdict.via === "odd_type_id") viaOddType += 1;
        else viaBetName += 1;

        matchCollected.push({
          map: num(block.round),
          betName: label,
          odd_type_id: String(block.odd_type_id ?? ""),
          via: verdict.via,
        });
      }
    }

    console.log("\n---", m.home.name, "vs", m.away.name, "---");
    console.log({
      matchId: m.matchId,
      gameId: m.gameId,
      gameCode,
      bo: m.bo,
      collected: matchCollected.length,
    });
    for (const row of matchCollected) {
      console.log("  �?, row);
    }
  }

  console.log("\n[ob-live-odd] SUMMARY");
  console.log({
    blocksScanned: totalBlocks,
    saveBetRows: collected,
    via_odd_type_id: viaOddType,
    via_betName: viaBetName,
    pistolRejectedByOddType: rejectedPistol,
    fetchErrors: failures.length,
  });

  if (failures.length) {
    console.log("[ob-live-odd] errors:", failures.slice(0, 3));
  }

  if (collected === 0 && totalBlocks > 0) {
    console.error("[ob-live-odd] FAIL: 有盘口但无一行通过采集过滤");
    process.exit(1);
  }
  if (totalBlocks === 0) {
    console.warn("[ob-live-odd] WARN: 未拉到任�?game/view block（可能无赛程�?);
  } else {
    console.log("[ob-live-odd] PASS");
  }
}

main().catch((err) => {
  console.error("[ob-live-odd] FAIL", err.message);
  process.exit(1);
});
