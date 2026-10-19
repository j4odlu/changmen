#!/usr/bin/env node

import { login, obGet } from "../session.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cnDate(ts) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts * 1000));
}

async function probe(session, label, path) {
  await sleep(600);
  try {
    const r = await obGet(session.gateway, path, session.token, session.lang);
    const data = r.json.data || [];
    const dates = [...new Set(data.map((m) => cnDate(m.start_time)))].sort();
    console.log(`${label}\tcount=${data.length}\tdates=${dates.join("|")}`);
    return data;
  } catch (e) {
    console.log(`${label}\tERR\t${e.message.slice(0, 80)}`);
    return [];
  }
}

async function main() {
  const session = await login();
  const nowCn = cnDate(Math.floor(Date.now() / 1000));
  console.log("CN today:", nowCn);
  console.log("---");

  const cases = [
    ["flag=0 全部赛程", "/game/index?game_id=0&flag=0&day=0"],
    ["flag=1 day=0", "/game/index?game_id=0&flag=1&day=0"],
    ["flag=1 day=1 今日(A8默认)", "/game/index?game_id=0&flag=1&day=1"],
    ["flag=2 day=0", "/game/index?game_id=0&flag=2&day=0"],
    ["flag=2 day=1", "/game/index?game_id=0&flag=2&day=1"],
    ["flag=2 day=2", "/game/index?game_id=0&flag=2&day=2"],
    ["flag=2 day=3", "/game/index?game_id=0&flag=2&day=3"],
    ["flag=3 day=1", "/game/index?game_id=0&flag=3&day=1"],
    ["flag=4 day=1", "/game/index?game_id=0&flag=4&day=1"],
    ["flag=4 day=2", "/game/index?game_id=0&flag=4&day=2"],
    ["flag=5 day=0", "/game/index?game_id=0&flag=5&day=0"],
  ];

  for (const [label, path] of cases) {
    await probe(session, label, path);
  }

  const today = await obGet(
    session.gateway,
    "/game/index?game_id=0&flag=1&day=1",
    session.token,
    session.lang,
  );
  const rows = today.json.data || [];
  const byLive = {};
  const byStatus = {};
  for (const m of rows) {
    byLive[m.is_live] = (byLive[m.is_live] || 0) + 1;
    byStatus[m.status] = (byStatus[m.status] || 0) + 1;
  }
  console.log("---");
  console.log("flag=1 is_live:", JSON.stringify(byLive));
  console.log("flag=1 status:", JSON.stringify(byStatus));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
