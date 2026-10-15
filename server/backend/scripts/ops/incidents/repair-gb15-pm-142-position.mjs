/**
 * [changmen 扩展] 2026-10-15：仅修复 id=36667683 的已核实外部全卖仓位。
 * 默认 dry-run；--execute 原子更新，写前保留完整备份。不会发起交易。
 * 这不是自动官网卖出归因；有多笔买入/卖出或已有减仓时拒绝猜配。
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { ensurePgPoolReady } from "@changmen/db";
import { Currency, getExchange } from "@changmen/shared/currency";
import { resolvePolymarketSettlement } from "../../../core/integrations/polymarket/settlement.js";

const execute = process.argv.includes("--execute");
const id = "36667683";
const orderId = "0xa261ea11e2ca274c08bf23dc3091ab5d32be57555db93b4c20b1eefc31acb593";
const condition = "0xf2100079b1360cfb3ffe88642455ff3ad6596c029f8c54962985aca7283280dc";
const token = "57232858937149583352927277805092640185006103000471324975696067551168118876742";
const buyTx = "0xd6910b1dd66eb670eb1b42e3c0797fbf41fdfb7470dcc0c61b234687e70c5713";
const sellTx = "0xb479f180ecceff47ba3c68a3a879666ea322432f21d18707a6ce6b2d327e00c1";
const round4 = n => Math.round(n * 10000) / 10000;
async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert(res.ok, `Public API HTTP ${res.status}`);
  return res.json();
}
async function activity(wallet, side) {
  const params = new URLSearchParams({ user: wallet, type: "TRADE", side, limit: "1000",
    start: "1792062900", end: "1792065040", sort_by: "TIMESTAMP", sort_direction: "ASC" });
  const body = await json(`https://data-api.polymarket.com/v2/activity?${params}`);
  assert(Array.isArray(body.data) && body.pagination?.has_more === false && body.pagination?.next_cursor === null,
    "Incomplete activity; refusing partial attribution");
  return body.data.filter(r => r.condition_id === condition && r.token_id === token);
}

const pool = await ensurePgPoolReady();
assert(pool, "Database unavailable");
const c = await pool.connect();
try {
  const initial = (await c.query("SELECT * FROM orders WHERE id=$1", [id])).rows[0];
  assert(initial?.order_id === orderId && String(initial.player_id) === "215", "Order identity mismatch");
  const existingSell = initial.raw?.positionEvents?.sells?.find(e => e.id === `external:${sellTx}`);
  if (existingSell) {
    assert(initial.raw.pmSellState === "closed" && initial.raw.pmAttributedSellShares === 142
      && initial.raw.pmStakeUsdc === 0 && Math.abs(initial.money - 732.02056) < 0.0001
      && Math.abs(initial.raw.pmSellProceeds - 141.85091) < 0.00001, "Previously repaired position changed");
    console.log(JSON.stringify({ id, alreadyRepaired: true, status: initial.status, money: initial.money,
      state: initial.raw.pmSellState }));
  }
  else {
    // 钱包只从这笔原始提交日志取，不使用操作者浏览器或其他账号凭证。
    const logs = await c.query(`SELECT data FROM user_logs WHERE user_id=$1
      AND create_at BETWEEN 1792063000000 AND 1792063040000
      AND title LIKE '%下注 =>%' AND data::text LIKE $2`, [initial.user_id, `%${orderId}%`]);
    const makers = new Set(logs.rows.map(({ data }) => {
      const d = typeof data === "string" ? JSON.parse(data) : data;
      const o = d.result?.request?.order;
      assert(o?.tokenId === token, "Submission token mismatch");
      return String(o.maker).toLowerCase();
    }));
    assert(makers.size === 1, "Submission wallet must be unambiguous");
    const wallet = [...makers][0];
    assert(/^0x[0-9a-f]{40}$/.test(wallet));
    const [buys, sells, markets, clob] = await Promise.all([
      activity(wallet, "BUY"), activity(wallet, "SELL"),
      json(`https://gamma-api.polymarket.com/markets?condition_ids=${condition}`),
      json(`https://clob.polymarket.com/markets/${condition}`),
    ]);
    assert(buys.length === 1 && sells.length === 1, "Ambiguous activity; no FIFO inference allowed");
    const buy = buys[0], sell = sells[0];
    assert(buy.transaction_hash === buyTx && sell.transaction_hash === sellTx);
    assert(buy.size === 142 && sell.size === 142 && buy.timestamp < sell.timestamp);
    assert(Number.isFinite(buy.usdc_size) && Number.isFinite(sell.usdc_size) && sell.usdc_size > 0);
    const market = markets.find(m => m.conditionId === condition);
    assert(market, "Market missing");
    const result = resolvePolymarketSettlement({ ...market, tokens: clob.tokens });
    assert(result?.winningAssetId === token, "Expected winning token not confirmed by current policy");

    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='3s'");
    const row = (await c.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id])).rows[0];
    assert(row?.order_id === orderId && row.user_id === initial.user_id && String(row.player_id) === "215");
    assert(row.raw.pmConditionId === condition && row.raw.pmTokenId === token && row.raw.pmShares === 142);
    assert(!(Number(row.raw.pmAttributedSellShares) > 0) && !["partial", "closed"].includes(row.raw.pmSellState), "Sell progress changed");
    assert(Math.abs(Number(row.raw.pmStakeUsdc) - buy.usdc_size) < 0.0001, "Stored cost differs from official buy");
    const siblings = await c.query(`SELECT id FROM orders WHERE user_id=$1 AND player_id=215
      AND raw->>'pmTokenId'=$2 AND COALESCE(raw->>'pmSide','buy')='buy'
      AND COALESCE((raw->>'pmShares')::float8,0)>0`, [row.user_id, token]);
    assert(siblings.rows.length === 1 && siblings.rows[0].id === id, "Multiple stored buys; no allocation allowed");
    const pnl = round4(sell.usdc_size - Number(row.raw.pmStakeUsdc));
    const fx = getExchange(Currency.USDT);
    const money = pnl * fx;
    // 与正常已全卖仓位一致：财务 status=none，展示根据 closed + money 显示盈利。
    const raw = { ...row.raw, status: "none", money, reward: sell.usdc_size * fx,
      pmMatchResult: "win", pmSellState: "closed", pmAttributedSellShares: 142,
      pmStakeUsdc: 0, pmSellProceeds: sell.usdc_size, pmRealizedPnlUsdc: pnl,
      positionEvents: { ...row.raw.positionEvents, sells: [...(row.raw.positionEvents?.sells ?? []), {
        id: `external:${sellTx}`, at: sell.timestamp * 1000, shares: 142,
        price: sell.price, proceeds: sell.usdc_size, pnl, origin: "external", status: "filled",
      }] },
      externalCloseRepair: { at: Date.now(), buyTx, sellTx, source: "Polymarket Data API v2", settlementKind: result.kind },
    };
    const evidence = { execute, before: row, after: { status: "None", money, raw }, buy, sell,
      market: { conditionId: condition, outcomePrices: market.outcomePrices, tokens: clob.tokens } };
    await mkdir("output/pm-142-settlement", { recursive: true });
    const path = `output/pm-142-settlement/${execute ? "before-execute" : "dry-run"}-${Date.now()}.json`;
    await writeFile(path, JSON.stringify(evidence, null, 2), { flag: "wx" });
    if (execute) {
      const changed = await c.query("UPDATE orders SET status='None', money=$2, raw=$3::jsonb WHERE id=$1 RETURNING id,status,money", [id, money, JSON.stringify(raw)]);
      assert(changed.rowCount === 1);
      await c.query("COMMIT");
    }
    else await c.query("ROLLBACK");
    console.log(JSON.stringify({ execute, id, from: row.status, to: "None", sellState: "closed",
      proceedsUsdc: sell.usdc_size, realizedPnlUsdc: pnl, moneyCny: money, evidence: path }));
  }
}
catch (error) {
  await c.query("ROLLBACK");
  throw error;
}
finally { c.release(); await pool.end(); }
