-- POD 自动下注执行权：跨标签页、跨设备幂等；先占位再调用场馆。
CREATE TABLE IF NOT EXISTS pod_bet_executions (
  id               bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  alert_id         text NOT NULL,
  venue            text NOT NULL,
  player_id        bigint NOT NULL,
  lease_token      uuid NOT NULL,
  state            text NOT NULL DEFAULT 'reserved',
  venue_order_id   text NOT NULL DEFAULT '',
  message          text NOT NULL DEFAULT '',
  -- 兼容早期试运行表；0 表示不自动过期。安全策略是未知结果永久禁止自动重试。
  lease_until      bigint NOT NULL DEFAULT 0,
  created_at       bigint NOT NULL,
  updated_at       bigint NOT NULL,
  CHECK (venue IN ('OB', 'Polymarket')),
  CHECK (state IN ('reserved', 'accepted', 'failed', 'unknown')),
  UNIQUE (user_id, alert_id, venue, player_id)
);

-- 兼容运行时曾提前建出的试运行表。
ALTER TABLE pod_bet_executions
  ALTER COLUMN lease_until SET DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pod_bet_executions'::regclass
      AND conname = 'pod_bet_executions_venue_check'
  ) THEN
    ALTER TABLE pod_bet_executions
      ADD CONSTRAINT pod_bet_executions_venue_check
      CHECK (venue IN ('OB', 'Polymarket'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pod_bet_executions'::regclass
      AND conname = 'pod_bet_executions_state_check'
  ) THEN
    ALTER TABLE pod_bet_executions
      ADD CONSTRAINT pod_bet_executions_state_check
      CHECK (state IN ('reserved', 'accepted', 'failed', 'unknown'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pod_bet_executions_token_uidx
  ON pod_bet_executions (lease_token);

CREATE INDEX IF NOT EXISTS pod_bet_executions_user_updated_idx
  ON pod_bet_executions (user_id, updated_at DESC);
