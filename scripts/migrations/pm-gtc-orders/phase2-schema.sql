-- [changmen 扩展] 独立人工审查的阶段二 DDL。未加入启动/部署自动迁移链。
-- 本脚本没有回填、控制源切换或旧表删除；执行须另行授权并先完成 PostgreSQL 演练。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public, pg_catalog;
SELECT pg_advisory_xact_lock(hashtextextended('pm-gtc-orders-schema-v1',0));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS execution_kind text,
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS execution_wallet_key text,
  ADD COLUMN IF NOT EXISTS execution_active boolean,
  ADD COLUMN IF NOT EXISTS execution_record jsonb,
  ADD COLUMN IF NOT EXISTS execution_updated_at bigint,
  ADD COLUMN IF NOT EXISTS financial_ready boolean NOT NULL DEFAULT true;

-- 所有控制字段为空，或完整而且与旧 record 身份一致。IS TRUE 拒绝 NULL 漏洞。
CREATE OR REPLACE FUNCTION public.orders_execution_record_valid_v1(
  kind text, eid uuid, wallet text, active boolean, record jsonb, updated bigint,
  owner uuid, player bigint, oid text, venue text, ready boolean, legacy jsonb
) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (
    (kind IS NULL AND eid IS NULL AND wallet IS NULL AND active IS NULL
      AND record IS NULL AND updated IS NULL AND ready)
    OR (kind='pm-gtc-v1' AND eid IS NOT NULL AND wallet IS NOT NULL AND wallet<>''
      AND active IS NOT NULL AND record IS NOT NULL AND updated IS NOT NULL
      AND jsonb_typeof(record)='object' AND jsonb_typeof(record->'plan')='object'
      AND lower(record->>'id')=eid::text AND lower(record->>'owner')=owner::text
      AND record->>'walletKey'=wallet AND record->'plan'->>'playerId'=player::text
      AND venue='Polymarket' AND lower(oid)=lower(record->'plan'->>'orderHash')
      AND (record->>'orderId' IS NULL OR lower(record->>'orderId')=lower(oid))
      AND jsonb_typeof(record->'released')='boolean' AND active=NOT (record->>'released')::boolean
      AND record ?& ARRAY['id','owner','walletKey','maker','plan','createdAt','revision','submit',
        'orderId','decision','deadlineAt','pmAuthorized','other','manual','released','cancel','fills',
        'order','matched','principal','fee','open','terminal','complete','groupComplete','observedAt','error','counted']
      AND jsonb_typeof(record->'other')='object' AND jsonb_typeof(record->'fills')='object'
      AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['pmAuthorized','manual','released','terminal','complete','groupComplete','counted']) AS flag(name)
        WHERE jsonb_typeof(record->flag.name) IS DISTINCT FROM 'boolean')
      AND record->'plan'->>'orderHash' ~* '^0x[0-9a-f]{64}$'
      AND jsonb_typeof(record->'plan'->'playerId')='number' AND player>0 AND player<=9007199254740991
      AND jsonb_typeof(record->'revision')='number' AND (record->>'revision')::numeric BETWEEN 0 AND 9007199254740991
      AND mod((record->>'revision')::numeric,1)=0
      AND jsonb_typeof(record->'createdAt')='number' AND (record->>'createdAt')::numeric BETWEEN 1 AND 9007199254740991
      AND mod((record->>'createdAt')::numeric,1)=0 AND updated>0
      AND COALESCE(lower(legacy->>'pmSide'),'buy')<>'sell')
  ) IS TRUE
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='orders_execution_record_v1') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_execution_record_v1 CHECK (
      public.orders_execution_record_valid_v1(execution_kind,execution_id,execution_wallet_key,
        execution_active,execution_record,execution_updated_at,user_id,player_id,order_id,
        provider,financial_ready,raw));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS orders_execution_id_v1 ON public.orders(execution_id) WHERE execution_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orders_execution_hash_v1 ON public.orders(user_id,player_id,lower(order_id)) WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_execution_wallet_active_v1 ON public.orders(execution_wallet_key) WHERE execution_active;
CREATE INDEX IF NOT EXISTS orders_execution_owner_recent_v1 ON public.orders(user_id,execution_updated_at DESC) WHERE execution_id IS NOT NULL;

-- 显式保留原 DTO 列集；控制 payload 不经 SELECT * 泄漏给财务 API。
CREATE OR REPLACE VIEW public.orders_financial AS
  SELECT id,user_id,player_id,order_id,link,provider,match,bet,item,odds,bet_money,money,status,create_at,raw,changmen_bet
  FROM public.orders WHERE financial_ready
  WITH LOCAL CHECK OPTION;

-- 旧运维硬删和 profile 的级联删除也不能悄悄删除执行控制。
-- 正常财务删除走带 FOR UPDATE 的 hidden/removed CTE，已知财务计数仍按一条返回。
CREATE OR REPLACE FUNCTION public.protect_orders_execution_delete_v1()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.execution_id IS NOT NULL THEN
    RAISE EXCEPTION 'orders execution control must be retained; use financial deletion' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS orders_execution_delete_v1 ON public.orders;
CREATE TRIGGER orders_execution_delete_v1 BEFORE DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_orders_execution_delete_v1();

-- 启动验证只读 catalog，缺列/错类型/错默认值/无效约束或索引/删除触发器禁用均失败。
CREATE OR REPLACE FUNCTION public.validate_orders_execution_schema_v1()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (
    (SELECT count(*)=7 FROM pg_attribute a JOIN (VALUES
      ('execution_kind','text'),('execution_id','uuid'),('execution_wallet_key','text'),
      ('execution_active','boolean'),('execution_record','jsonb'),('execution_updated_at','bigint'),
      ('financial_ready','boolean')) AS expected(name,typ)
      ON a.attname=expected.name AND a.atttypid=expected.typ::regtype
      WHERE a.attrelid='public.orders'::regclass AND NOT a.attisdropped)
    AND EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.orders'::regclass AND a.attname='financial_ready' AND a.attnotnull
        AND pg_get_expr(d.adbin,d.adrelid)='true')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.orders'::regclass
      AND conname='orders_execution_record_v1' AND convalidated AND contype='c'
      AND pg_get_constraintdef(oid)='CHECK (orders_execution_record_valid_v1(execution_kind, execution_id, execution_wallet_key, execution_active, execution_record, execution_updated_at, user_id, player_id, order_id, provider, financial_ready, raw))')
    AND (SELECT count(*)=4 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN (VALUES
      ('orders_execution_id_v1','CREATE UNIQUE INDEX orders_execution_id_v1 ON public.orders USING btree (execution_id) WHERE (execution_id IS NOT NULL)'),
      ('orders_execution_hash_v1','CREATE UNIQUE INDEX orders_execution_hash_v1 ON public.orders USING btree (user_id, player_id, lower(order_id)) WHERE (execution_id IS NOT NULL)'),
      ('orders_execution_wallet_active_v1','CREATE INDEX orders_execution_wallet_active_v1 ON public.orders USING btree (execution_wallet_key) WHERE execution_active'),
      ('orders_execution_owner_recent_v1','CREATE INDEX orders_execution_owner_recent_v1 ON public.orders USING btree (user_id, execution_updated_at DESC) WHERE (execution_id IS NOT NULL)')) AS expected(name,definition)
      ON c.relname=expected.name AND pg_get_indexdef(c.oid)=expected.definition
      WHERE i.indrelid='public.orders'::regclass AND i.indisvalid AND i.indisready)
    AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid='public.orders'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL
      AND pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX orders_user_order ON public.orders USING btree (user_id, order_id, player_id)')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.orders'::regclass
      AND contype='f' AND confrelid='public.profiles'::regclass AND convalidated AND confdeltype='c'
      AND pg_get_constraintdef(oid)='FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.orders'::regclass
      AND tgname='orders_execution_delete_v1' AND tgenabled='O' AND tgtype=11
      AND tgfoid='public.protect_orders_execution_delete_v1()'::regprocedure)
    AND EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.orders_execution_record_valid_v1(text,uuid,text,boolean,jsonb,bigint,uuid,bigint,text,text,boolean,jsonb)'::regprocedure
      AND md5(replace(prosrc,chr(13)||chr(10),chr(10)))='f12bd5bb48310ac57f8aca8e8af98238' AND provolatile='i' AND NOT prosecdef)
    AND EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.protect_orders_execution_delete_v1()'::regprocedure
      AND md5(replace(prosrc,chr(13)||chr(10),chr(10)))='2e454db1c38e6f166c679a3c7b759031' AND NOT prosecdef)
    -- [changmen 扩展] PG18 omits redundant qualifiers; both branches compare the entire view.
    AND pg_get_viewdef('public.orders_financial'::regclass,true)=
      CASE WHEN current_setting('server_version_num')::int BETWEEN 180000 AND 189999
        THEN E' SELECT id,\n    user_id,\n    player_id,\n    order_id,\n    link,\n    provider,\n    match,\n    bet,\n    item,\n    odds,\n    bet_money,\n    money,\n    status,\n    create_at,\n    raw,\n    changmen_bet\n   FROM orders\n  WHERE financial_ready;'
        ELSE E' SELECT orders.id,\n    orders.user_id,\n    orders.player_id,\n    orders.order_id,\n    orders.link,\n    orders.provider,\n    orders.match,\n    orders.bet,\n    orders.item,\n    orders.odds,\n    orders.bet_money,\n    orders.money,\n    orders.status,\n    orders.create_at,\n    orders.raw,\n    orders.changmen_bet\n   FROM orders\n  WHERE orders.financial_ready;'
      END
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid='public.orders_financial'::regclass AND 'check_option=local'=ANY(reloptions))
  ) IS TRUE
$$;

DO $$ BEGIN
  IF NOT public.validate_orders_execution_schema_v1() THEN
    RAISE EXCEPTION 'orders execution schema v1 validation failed; rollback entire DDL';
  END IF;
END $$;
COMMIT;
