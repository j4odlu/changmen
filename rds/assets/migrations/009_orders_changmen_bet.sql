-- orders.changmen_bet：SaveOrder 时由 user_logs 判定是否为 changmen 主动下注（非 A8 被动 sync）
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/009_orders_changmen_bet.sql

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS changmen_bet boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS orders_user_changmen_bet
  ON orders (user_id, changmen_bet)
  WHERE changmen_bet = true;

COMMIT;
