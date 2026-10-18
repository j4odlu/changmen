-- 足球订单结算字段（与电竞 orders.Status / Money 同语义，物理隔离）

BEGIN;

ALTER TABLE football_orders
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'None';

ALTER TABLE football_orders
  ADD COLUMN IF NOT EXISTS profit double precision NOT NULL DEFAULT 0;

COMMIT;
