-- [changmen 扩展] 显式增量脚本；不得在应用启动/交易调用中执行。
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS financial_ready boolean NOT NULL DEFAULT true;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS execution_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pm_order_mode text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pm_order_snapshot jsonb;
ALTER TABLE public.orders ADD CONSTRAINT pm_orders_minimal_mode CHECK (
  (pm_order_mode IS NULL OR (provider='Polymarket' AND pm_order_mode IN ('FOK','GTC'))) IS TRUE);
ALTER TABLE public.orders ADD CONSTRAINT pm_orders_minimal_pending CHECK (
  (financial_ready OR (provider='Polymarket' AND pm_order_mode='GTC' AND execution_id IS NOT NULL
    AND pm_order_snapshot IS NOT NULL AND pm_order_snapshot->>'version'='1'
    AND pm_order_snapshot->>'executionId'=execution_id::text
    AND pm_order_snapshot->>'submit'='accepted')) IS TRUE);
CREATE OR REPLACE VIEW public.orders_financial AS SELECT * FROM public.orders WHERE financial_ready;
CREATE FUNCTION public.validate_pm_orders_minimal_v1() RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE expected_view text;
BEGIN
  SELECT 'SELECT'||string_agg(quote_ident(attname),',' ORDER BY attnum)||'FROMordersWHEREfinancial_ready;'
    INTO expected_view FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attnum>0 AND NOT attisdropped;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.orders'::regclass
    AND NOT attisdropped AND ((attname='financial_ready' AND atttypid='boolean'::regtype AND attnotnull)
      OR (attname='execution_id' AND atttypid='uuid'::regtype AND NOT attnotnull)
      OR (attname='pm_order_mode' AND atttypid='text'::regtype AND NOT attnotnull)
      OR (attname='pm_order_snapshot' AND atttypid='jsonb'::regtype AND NOT attnotnull))) <> 4
    OR EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE a.attrelid='public.orders'::regclass AND a.attname IN ('execution_id','pm_order_mode','pm_order_snapshot'))
    OR regexp_replace(pg_get_viewdef('public.orders_financial'::regclass,true),'\s','','g') IS DISTINCT FROM expected_view
    OR (SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d JOIN pg_attribute a
      ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE a.attrelid='public.orders'::regclass AND a.attname='financial_ready') IS DISTINCT FROM 'true'
    OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='pm_orders_minimal_mode')
      IS DISTINCT FROM $mode$CHECK ((((pm_order_mode IS NULL) OR ((provider = 'Polymarket'::text) AND (pm_order_mode = ANY (ARRAY['FOK'::text, 'GTC'::text])))) IS TRUE))$mode$
    OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='pm_orders_minimal_pending')
      IS DISTINCT FROM $pending$CHECK (((financial_ready OR ((provider = 'Polymarket'::text) AND (pm_order_mode = 'GTC'::text) AND (execution_id IS NOT NULL) AND (pm_order_snapshot IS NOT NULL) AND ((pm_order_snapshot ->> 'version'::text) = '1'::text) AND ((pm_order_snapshot ->> 'executionId'::text) = (execution_id)::text) AND ((pm_order_snapshot ->> 'submit'::text) = 'accepted'::text))) IS TRUE))$pending$
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass
      AND conname IN ('pm_orders_minimal_mode','pm_orders_minimal_pending') AND convalidated)<>2 THEN
    RAISE EXCEPTION 'PM minimal orders schema mismatch';
  END IF;
  RETURN true;
END $$;
SELECT public.validate_pm_orders_minimal_v1();
COMMIT;
