-- [changmen 扩展] 阶段一一致性快照模板；本轮没有连接数据库或执行本文件。
-- 三张表必须来自同一只读 REPEATABLE READ 事务，不可拼接不同时间/不同用户的导出。
-- psql 使用 -X -q -t -A -v ON_ERROR_STOP=1，将唯一 JSON 行保存为本地文件。
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'complete', true,
  'snapshot', jsonb_build_object(
    'isolation', 'repeatable-read',
    'token', txid_current_snapshot()::text,
    'tables', jsonb_build_array('orders', 'pm_gtc_executions', 'profiles')
  ),
  'profiles', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id) ORDER BY p.id) FROM profiles p), '[]'::jsonb),
  'executions', COALESCE((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object('updated_at', e.updated_at::text) ORDER BY e.id)
    FROM pm_gtc_executions e), '[]'::jsonb),
  'orders', COALESCE((SELECT jsonb_agg(to_jsonb(o) || jsonb_build_object('id', o.id::text, 'player_id', o.player_id::text) ORDER BY o.id)
    FROM orders o), '[]'::jsonb)
);
COMMIT;
