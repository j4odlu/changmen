-- [changmen 扩展] RAY 足球自动跟单共享跨设备执行权。
BEGIN;
ALTER TABLE pod_bet_executions DROP CONSTRAINT IF EXISTS pod_bet_executions_venue_check;
ALTER TABLE pod_bet_executions ADD CONSTRAINT pod_bet_executions_venue_check
  CHECK (venue IN ('OB', 'Polymarket', 'RAY'));
COMMIT;
