-- [changmen 扩展] 只增加 7 列；不回填，不建索引/视图/函数/触发器，不切换读写或撤旧表。
-- NOWAIT 获取不到表锁立即失败，避免迁移排队阻塞线上请求；失败必须回滚。
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';
SET LOCAL idle_in_transaction_session_timeout = '10s';
LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE NOWAIT;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS execution_kind text,
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS execution_wallet_key text,
  ADD COLUMN IF NOT EXISTS execution_active boolean,
  ADD COLUMN IF NOT EXISTS execution_record jsonb,
  ADD COLUMN IF NOT EXISTS execution_updated_at bigint,
  ADD COLUMN IF NOT EXISTS financial_ready boolean NOT NULL DEFAULT true;
COMMIT;
