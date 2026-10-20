-- [changmen 扩展] 旁路事件独立于 orders/user_logs；不修改任何业务状态。
BEGIN;
CREATE TABLE IF NOT EXISTS order_observations (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  link_id bigint NOT NULL,
  attempt_id text,
  queue_id text,
  occurred_at bigint NOT NULL,
  received_at bigint NOT NULL,
  event jsonb NOT NULL,
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS order_observations_user_link ON order_observations (user_id, link_id, received_at, event_id);
CREATE INDEX IF NOT EXISTS order_observations_user_attempt ON order_observations (user_id, attempt_id);
CREATE INDEX IF NOT EXISTS order_observations_user_queue ON order_observations (user_id, queue_id);
CREATE INDEX IF NOT EXISTS order_observations_user_order ON order_observations (user_id, (event->>'provider'), (event->>'accountId'), (event->>'orderId'));
COMMIT;
