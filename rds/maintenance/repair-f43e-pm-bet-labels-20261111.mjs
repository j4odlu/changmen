/** [changmen 扩展] f43e 近期 PM 原生盘口名回填；默认只读，证据来自官方 CLOB，不进入运行/部署。 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ACCOUNT = 292;
export const SINCE = Date.parse("2026-11-08T00:00:00+08:00");
const directory = fileURLToPath(new URL("../../output/pm-native-label-repair-20261111/", import.meta.url));
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lower = value => String(value ?? "").trim().toLowerCase();

export function officialBetLabels(evidence) {
  const labels = new Map();
  for (const { source, market } of evidence) {
    const condition = lower(market?.condition_id);
    assert(/^0x[0-9a-f]{64}$/.test(condition), "Invalid official condition");
    assert.equal(source, `https://clob.polymarket.com/markets/${condition}`);
    const question = String(market.question ?? "");
    assert(/^(?:Dota 2|Counter-Strike|CS2|LoL|League of Legends|Valorant): /i.test(question), "Unreviewed sport");
    const map = / - (?:Map|Game) ([1-9]\d*) Winner$/i.exec(question);
    assert(map || (/\bvs\.? .+\(BO[1-9]\d*\) - /i.test(question)
      && !/\b(?:total|handicap|spread|over|under|kills)\b/i.test(question)), "Unrecognised native market");
    const bet = map ? `地图${map[1]}` : "全场";
    assert(Array.isArray(market.tokens) && market.tokens.length === 2, "Expected binary market");
    const tokens = market.tokens.map(token => token.token_id);
    assert(tokens.every(token => typeof token === "string" && /^\d+$/.test(token)) && new Set(tokens).size === 2);
    for (const token of tokens) {
      const key = JSON.stringify([condition, token]);
      assert(!labels.has(key) || labels.get(key) === bet, "Conflicting official metadata");
      labels.set(key, bet);
    }
  }
  return labels;
}

export function planBetLabelRepair(rows, evidence, until) {
  assert(Number.isSafeInteger(until) && until > SINCE);
  const labels = officialBetLabels(evidence), patches = [];
  for (const row of rows) {
    assert.equal(row.provider, "Polymarket"); assert.equal(Number(row.player_id), ACCOUNT);
    assert(Number(row.create_at) >= SINCE && Number(row.create_at) < until, "Order outside reviewed dates");
    const raw = row.raw || {}, condition = lower(raw.pmConditionId), token = String(raw.pmTokenId ?? "");
    let bet = labels.get(JSON.stringify([condition, token]));
    if (!bet) {
      // 缺场馆身份的历史提交失败不是可确认的原生盘口；不能从合场快照反推。
      assert(!condition && !token && row.status === "Reject" && !(Number(raw.pmShares) > 0)
        && /^pm-rej-292-\d+-api_failed$/.test(row.order_id), `Missing official evidence for ${row.id}`);
      const composed = String(raw.clientMarket?.betName || row.bet || "").replace(/^changmen 盘口：/, "").trim();
      assert(composed && composed !== "盘口待核实", `Missing changmen label for ${row.id}`);
      bet = `changmen 盘口：${composed}`;
    }
    const nextRaw = { ...raw };
    for (const name of ["bet", "Bet"]) if (Object.hasOwn(nextRaw, name)) nextRaw[name] = bet;
    if (row.bet !== bet || JSON.stringify(raw) !== JSON.stringify(nextRaw))
      patches.push({ id: row.id, bet, raw: nextRaw, previousBet: row.bet });
  }
  const fingerprint = digest(patches.map(patch => ({ id: patch.id, bet: patch.bet, previousBet: patch.previousBet,
    condition: patch.raw.pmConditionId, token: patch.raw.pmTokenId })));
  return { inspected: rows.length, patches, fingerprint };
}

export async function repairBetLabels(client, evidence, { until, apply = false, expectedFingerprint, saveBackup } = {}) {
  await client.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='15s'");
    const { rows: accounts } = await client.query(`SELECT id,owner_user_id,provider,player_name FROM players WHERE id=$1${apply ? " FOR SHARE" : ""}`, [ACCOUNT]);
    assert.equal(accounts.length, 1); const account = accounts[0];
    assert.equal(account.provider, "Polymarket"); assert.equal(account.player_name.toLowerCase(), "f43e");
    const select = "SELECT * FROM orders WHERE player_id=$1 AND user_id=$2 AND provider='Polymarket' AND create_at >= $3 AND create_at < $4 ORDER BY id";
    const params = [ACCOUNT, account.owner_user_id, SINCE, until];
    const { rows } = await client.query(select + (apply ? " FOR UPDATE" : ""), params);
    assert(rows.length > 0, "No orders in reviewed scope");
    const plan = planBetLabelRepair(rows, evidence, until);
    let backup = null;
    if (apply && plan.patches.length) {
      assert.equal(plan.fingerprint, expectedFingerprint, "Preview changed; review again before applying");
      assert.equal(typeof saveBackup, "function", "Durable backup required");
      backup = await saveBackup({ account, since: SINCE, until, rows, evidence, plan });
      assert(backup, "Backup path missing");
      for (const patch of plan.patches) {
        const result = await client.query("UPDATE orders SET bet=$2,raw=$3::jsonb WHERE id=$1 AND player_id=$4 AND user_id=$5",
          [patch.id, patch.bet, JSON.stringify(patch.raw), ACCOUNT, account.owner_user_id]);
        assert.equal(result.rowCount, 1);
      }
      const after = (await client.query(select, params)).rows;
      const patches = new Map(plan.patches.map(patch => [String(patch.id), patch]));
      assert.deepEqual(after, rows.map(row => {
        const patch = patches.get(String(row.id));
        return patch ? { ...row, bet: patch.bet, raw: patch.raw } : row;
      }), "Non-label order fields changed");
      assert.equal(planBetLabelRepair(after, evidence, until).patches.length, 0, "Labels still need repair");
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { applied: apply, accountId: ACCOUNT, since: SINCE, until, inspected: plan.inspected,
      changed: plan.patches.length, fingerprint: plan.fingerprint, backup,
      changes: plan.patches.map(({ id, bet, previousBet }) => ({ id, previousBet, bet })) };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); assert(args.every(arg => arg === "--apply"));
  const apply = args.includes("--apply");
  const evidence = JSON.parse((await readFile(path.join(directory, "official-markets.json"), "utf8")).replace(/^\uFEFF/, ""));
  const preview = apply ? JSON.parse(await readFile(path.join(directory, "preview.json"), "utf8")) : null;
  const { loadChangmenEnv } = await import("@changmen/storage/load_env"); loadChangmenEnv();
  const { ensurePgPoolReady } = await import("@changmen/db"); const pool = await ensurePgPoolReady(), client = await pool.connect();
  try {
    const result = await repairBetLabels(client, evidence, { until: preview?.until ?? Date.now(), apply,
      expectedFingerprint: preview?.fingerprint, saveBackup: async data => {
        const file = path.join(directory, `backup-${Date.now()}.json`);
        await writeFile(file, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
        assert.equal(digest(JSON.parse(await readFile(file, "utf8"))), digest(data), "Backup readback failed");
        return file;
      } });
    await writeFile(path.join(directory, apply ? `applied-${Date.now()}.json` : "preview.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
  } finally { client.release(); await pool.end(); }
}
