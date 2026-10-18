-- 足球 POD 跟单订单（与电竞 orders 物理隔离；禁止混入 Client_SaveOrder）

BEGIN;

CREATE TABLE IF NOT EXISTS football_orders (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  player_id       bigint,
  venue           text NOT NULL DEFAULT 'OB',
  venue_order_id  text NOT NULL DEFAULT '',
  client_id       text NOT NULL,
  home            text NOT NULL DEFAULT '',
  away            text NOT NULL DEFAULT '',
  side_label      text NOT NULL DEFAULT '',
  market_label    text NOT NULL DEFAULT '',
  odds            double precision NOT NULL DEFAULT 0,
  stake           double precision NOT NULL DEFAULT 0,
  oid             text NOT NULL DEFAULT '',
  ob_mid          text NOT NULL DEFAULT '',
  auto            boolean NOT NULL DEFAULT false,
  account_name    text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'None',
  profit          double precision NOT NULL DEFAULT 0,
  placed_at       bigint NOT NULL,
  created_at      bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS football_orders_user_client_uidx
  ON football_orders (user_id, client_id);

CREATE UNIQUE INDEX IF NOT EXISTS football_orders_user_venue_oid_uidx
  ON football_orders (user_id, venue, venue_order_id)
  WHERE venue_order_id <> '';

CREATE INDEX IF NOT EXISTS football_orders_placed_at_desc
  ON football_orders (placed_at DESC);

CREATE INDEX IF NOT EXISTS football_orders_user_placed
  ON football_orders (user_id, placed_at DESC);

COMMIT;
