#!/usr/bin/env node

/**
 * 扫描 OB game/view 盘口 status / visible / suspended 组合分布。
 */

import * as Core from "../core.js";
import { login, obGet, fetchGameView } from "../session.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const out = { matchLimit: 8, stages: [0] };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--matches") out.matchLimit = Number(val);
    if (key === "--stages") out.stages = val.split(",").map(Number);
  }
  return out;
}

function comboKey(mk) {
  return `${mk.status}|${mk.visible}|${mk.suspended}|${mk.settleCount ?? 0}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const session = await login();

  const index = await obGet(
    session.gateway,
    "/game/index?game_id=0&flag=1&day=1",
    session.token,
    session.lang,
  );
  const matches = (index.json.data || []).slice(0, args.matchLimit);

  const combos = new Map();
  let marketTotal = 0;
  let openTotal = 0;
  const samples = [];

  for (const m of matches) {
    const matchId = String(m.id);
    for (const stageId of args.stages) {
      await sleep(400);
      const { markets } = await fetchGameView(session, matchId, stageId);
      for (const mk of markets) {
        marketTotal += 1;
        if (!mk.locked) openTotal += 1;
        const key = comboKey(mk);
        combos.set(key, (combos.get(key) || 0) + 1);
        if (samples.length < 12) {
          samples.push({
            matchId,
            stageId,
            marketId: mk.marketId,
            name: mk.marketName,
            status: mk.status,
            visible: mk.visible,
            suspended: mk.suspended,
            settleCount: mk.settleCount,
            locked: mk.locked,
            label: mk.marketStatus?.label,
          });
        }
      }
    }
  }

  const rows = [...combos.entries()]
    .map(([key, count]) => {
      const [status, visible, suspended, settleCount] = key.split("|").map(Number);
      const desc = Core.describeMarketStatus({ status, visible, suspended, settle_count: settleCount });
      return { key, count, ...desc, status, visible, suspended, settleCount };
    })
    .sort((a, b) => b.count - a.count);

  console.log(
    JSON.stringify(
      {
        probedAt: new Date().toISOString(),
        matchCount: matches.length,
        stages: args.stages,
        marketTotal,
        openTotal,
        lockedTotal: marketTotal - openTotal,
        combos: rows,
        samples,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
