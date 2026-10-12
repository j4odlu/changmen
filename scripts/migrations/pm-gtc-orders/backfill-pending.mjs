// [changmen 扩展] 缺财务原单回填。独立工具，不接入业务入口，不读取凭证或修改旧源。
import { CONTROL_COLUMNS, jsonHash, planGtcOrdersMerge } from './plan.mjs';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const same = (a, b) => jsonHash(a) === jsonHash(b);
const business = row => Object.fromEntries(Object.entries(row).filter(([key]) => !CONTROL_COLUMNS.includes(key)));
const controlOf = row => Object.fromEntries(CONTROL_COLUMNS.map(key => [key,
  key === 'execution_updated_at' ? String(row[key]) : row[key]]));
const targetSql = `SELECT * FROM public.orders WHERE user_id=$1 AND player_id=$2
  AND lower(order_id)=lower($3) ORDER BY id FOR UPDATE NOWAIT`;

export const INSERT_PENDING_SQL = `INSERT INTO public.orders (
  user_id,player_id,order_id,link,provider,match,bet,item,odds,bet_money,money,status,create_at,raw,
  execution_kind,execution_id,execution_wallet_key,execution_active,execution_record,execution_updated_at,financial_ready
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,false) RETURNING *`;

/** Caller owns an idle dedicated client and has verified ALL active consumers.
 * One bounded transaction, no notification or command execution. A newly arrived
 * financial order is attached without changing its original fields. Busy work,
 * changed sources and ambiguous identities fail; there is no automatic retry.
 */
export async function backfillPendingControl(client, operation, { consumersCompatible = false } = {}) {
  if (!consumersCompatible) fail('CONSUMERS_NOT_COMPATIBLE');
  if (operation?.action !== 'insert-pending' || !operation.sourceHash || !operation.row || !operation.control)
    fail('INVALID_PENDING_OPERATION');
  try {
    await client.query("BEGIN; SET LOCAL lock_timeout='250ms'; SET LOCAL statement_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='2s'");
    const valid = (await client.query('SELECT public.validate_orders_execution_schema_v1() AS valid')).rows[0]?.valid;
    if (valid !== true) fail('SCHEMA_NOT_COMPATIBLE');
    const locked = (await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [operation.executionId])).rows[0];
    if (!locked?.acquired) fail('EXECUTION_BUSY');
    const source = (await client.query('SELECT * FROM public.pm_gtc_executions WHERE id=$1 FOR UPDATE NOWAIT', [operation.executionId])).rows[0];
    if (!source || jsonHash(source) !== operation.sourceHash) fail('SOURCE_CHANGED');
    const profiles = (await client.query('SELECT id FROM public.profiles WHERE id=$1 FOR KEY SHARE NOWAIT', [source.owner])).rows;
    const checked = planGtcOrdersMerge({ schemaVersion: 1, complete: true,
      snapshot: { isolation: 'repeatable-read', token: 'locked-source', tables: ['orders', 'pm_gtc_executions', 'profiles'] },
      profiles, executions: [source], orders: [] });
    if (!checked.preflightPassed) fail('INVALID_SOURCE');
    const expected = checked.operations[0];
    if (!same(operation.row, expected.row) || !same(operation.control, expected.control)) fail('PENDING_PAYLOAD_CHANGED');
    const key = [source.owner, String(source.record.plan.playerId), source.record.plan.orderHash];
    const peers = (await client.query(`SELECT id FROM public.pm_gtc_executions WHERE owner=$1
      AND record->'plan'->>'playerId'=$2 AND lower(record->'plan'->>'orderHash')=lower($3)`, key)).rows;
    if (peers.length !== 1 || peers[0].id !== source.id) fail('MULTIPLE_EXECUTIONS_FOR_ORIGINAL');
    let targets = (await client.query(targetSql, key)).rows;
    if (!targets.length) {
      // A missing row cannot be protected by FOR UPDATE. Ordinary writers do not
      // share the GTC advisory lock, and their unique key is case sensitive.
      // Acquire only for this insert, never queue behind an active orders writer.
      // Re-read AFTER acquiring it to close both exact-id and case-variant gaps.
      await client.query('LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE NOWAIT');
      targets = (await client.query(targetSql, key)).rows;
    }
    if (targets.length > 1) fail('AMBIGUOUS_CASE_FOLDED_ORIGINAL');
    const bound = (await client.query('SELECT id FROM public.orders WHERE execution_id=$1', [source.id])).rows;
    if (bound.some(row => String(row.id) !== String(targets[0]?.id))) fail('EXECUTION_BOUND_TO_DIFFERENT_ORDER');
    let after; let action; let oldFieldsHash = null;
    const before = targets[0];
    if (before) {
      if (before.provider !== 'Polymarket' || String(before.raw?.pmSide ?? 'buy').toLowerCase() === 'sell'
        || (before.raw?.pmGtcExecutionId != null && String(before.raw.pmGtcExecutionId).toLowerCase() !== source.id))
        fail('TARGET_IDENTITY_CONFLICT');
      if (CONTROL_COLUMNS.some(key => before[key] != null)) {
        if (!same(controlOf(before), controlOf(expected.control))) fail('TARGET_CONTROL_CHANGED');
        after = before; action = 'noop';
      } else {
        if (before.financial_ready !== true) fail('TARGET_READINESS_CONFLICT');
        const c = expected.control;
        after = (await client.query(`UPDATE public.orders SET execution_kind=$2,execution_id=$3,
          execution_wallet_key=$4,execution_active=$5,execution_record=$6,execution_updated_at=$7
          WHERE id=$1 AND financial_ready AND execution_id IS NULL RETURNING *`,
        [before.id, c.execution_kind, c.execution_id, c.execution_wallet_key, c.execution_active, c.execution_record, c.execution_updated_at])).rows[0];
        if (!after || !same(business(before), business(after))) fail('BUSINESS_FIELDS_CHANGED');
        action = 'attach-arrived';
      }
      oldFieldsHash = jsonHash(business(before));
    } else {
      const row = expected.row;
      const columns = ['user_id', 'player_id', 'order_id', 'link', 'provider', 'match', 'bet', 'item',
        'odds', 'bet_money', 'money', 'status', 'create_at', 'raw', ...CONTROL_COLUMNS];
      after = (await client.query(INSERT_PENDING_SQL, columns.map(key => row[key]))).rows[0];
      if (!after || after.financial_ready !== false) fail('PENDING_INSERT_FAILED');
      // PostgreSQL bigint values are strings; compare every inserted business field.
      for (const key of columns.filter(key => !CONTROL_COLUMNS.includes(key))) {
        const normalize = value => ['player_id', 'link', 'create_at'].includes(key) && value != null ? String(value) : value;
        if (!same(normalize(after[key]), normalize(row[key]))) fail('PENDING_FIELDS_CHANGED');
      }
      if (after.changmen_bet !== false) fail('PENDING_FINANCIAL_FLAG_CHANGED');
      action = 'insert-pending';
    }
    if (!same(controlOf(after), controlOf(expected.control))) fail('CONTROL_COPY_MISMATCH');
    const sourceAfter = (await client.query('SELECT * FROM public.pm_gtc_executions WHERE id=$1', [source.id])).rows[0];
    if (!sourceAfter || jsonHash(sourceAfter) !== operation.sourceHash) fail('SOURCE_CHANGED_DURING_COPY');
    await client.query('COMMIT');
    return { executionId: source.id, targetId: String(after.id), action, financialReady: after.financial_ready,
      sourceHash: operation.sourceHash, controlRecordHash: jsonHash(source.record), oldFieldsHash };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}
