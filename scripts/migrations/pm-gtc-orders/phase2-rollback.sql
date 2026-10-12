-- [changmen 扩展] 只回退空扩展 schema；有任意控制/非财务行立即拒绝，不能 CASCADE。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public, pg_catalog;
SELECT pg_advisory_xact_lock(hashtextextended('pm-gtc-orders-schema-v1',0));
LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE NOT financial_ready OR execution_kind IS NOT NULL
    OR execution_id IS NOT NULL OR execution_wallet_key IS NOT NULL OR execution_active IS NOT NULL
    OR execution_record IS NOT NULL OR execution_updated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'orders execution data exists; empty-schema rollback forbidden';
  END IF;
END $$;
DROP FUNCTION public.validate_orders_execution_schema_v1();
DROP VIEW public.orders_financial;
DROP TRIGGER orders_execution_delete_v1 ON public.orders;
DROP FUNCTION public.protect_orders_execution_delete_v1();
ALTER TABLE public.orders DROP CONSTRAINT orders_execution_record_v1;
DROP FUNCTION public.orders_execution_record_valid_v1(text,uuid,text,boolean,jsonb,bigint,uuid,bigint,text,text,boolean,jsonb);
DROP INDEX public.orders_execution_id_v1;
DROP INDEX public.orders_execution_hash_v1;
DROP INDEX public.orders_execution_wallet_active_v1;
DROP INDEX public.orders_execution_owner_recent_v1;
ALTER TABLE public.orders DROP COLUMN execution_kind, DROP COLUMN execution_id,
  DROP COLUMN execution_wallet_key, DROP COLUMN execution_active, DROP COLUMN execution_record,
  DROP COLUMN execution_updated_at, DROP COLUMN financial_ready;
COMMIT;
