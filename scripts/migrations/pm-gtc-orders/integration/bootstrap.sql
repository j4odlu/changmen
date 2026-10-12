-- [changmen 扩展] 测试专用最小基表，orders 对齐 001_baseline.sql + changmen_bet 扩展。
-- 只允许全新专用库；阶段二 DDL 另由测试入口读取原文件执行，不能复制后改弱。
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='8s';
SET LOCAL search_path=public,pg_catalog;
DO $$ BEGIN
  IF current_database()<>'changmen_orders_phase2_test_v1' OR current_user<>'changmen_orders_phase2_test'
    OR inet_server_addr() IS NULL OR inet_server_addr() NOT IN ('127.0.0.1'::inet,'::1'::inet)
    OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
      IS DISTINCT FROM 'changmen:pm-gtc-orders:phase2:disposable:v1'
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'disposable test database identity mismatch';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace)
    OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'test bootstrap requires empty public schema; provision a fresh test database';
  END IF;
END $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.orders (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_id bigint NOT NULL, order_id text NOT NULL, link bigint, provider text,
  match text, bet text, item text, odds double precision NOT NULL DEFAULT 0,
  bet_money double precision NOT NULL DEFAULT 0, money double precision NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'None', create_at bigint NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}', changmen_bet boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX orders_user_order ON public.orders(user_id,order_id,player_id);
CREATE TABLE public.pm_gtc_executions(
  id uuid PRIMARY KEY,owner uuid NOT NULL,wallet_key text NOT NULL,
  active boolean NOT NULL DEFAULT true,record jsonb NOT NULL,updated_at bigint NOT NULL
);
CREATE INDEX pm_gtc_wallet_active ON public.pm_gtc_executions(wallet_key) WHERE active;
CREATE INDEX pm_gtc_owner ON public.pm_gtc_executions(owner);
CREATE FUNCTION public.assert_pm_gtc_phase2_test_database() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF current_database()<>'changmen_orders_phase2_test_v1' OR current_user<>'changmen_orders_phase2_test'
    OR inet_server_addr() IS NULL OR inet_server_addr() NOT IN ('127.0.0.1'::inet,'::1'::inet)
    OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
      IS DISTINCT FROM 'changmen:pm-gtc-orders:phase2:disposable:v1' THEN
    RAISE EXCEPTION 'disposable test database identity mismatch';
  END IF;
END $$;
COMMIT;
