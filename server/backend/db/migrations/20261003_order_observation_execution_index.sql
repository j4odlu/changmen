-- [changmen 扩展] 仅优化旁路执行编号查询；不改业务表或业务状态。
CREATE INDEX IF NOT EXISTS order_observations_user_execution
  ON order_observations (user_id, (event->>'executionId'));
