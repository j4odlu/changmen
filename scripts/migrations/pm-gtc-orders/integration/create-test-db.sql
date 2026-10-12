-- [changmen 扩展] 仅供获准后在隔离本机 PostgreSQL 管理连接中执行；本轮未执行。
-- psql -X -v ON_ERROR_STOP=1；数据库/角色已存在即报错，不复用、不删除已有数据库。
-- 管理连接应指向 postgres 库；登录密码另行设置，不在仓库保存密码。
DO $$ BEGIN
  IF current_database()<>'postgres' OR inet_server_addr() IS NULL
    OR inet_server_addr() NOT IN ('127.0.0.1'::inet,'::1'::inet) THEN
    RAISE EXCEPTION 'test database provisioning requires isolated loopback postgres admin connection';
  END IF;
END $$;
CREATE ROLE changmen_orders_phase2_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE changmen_orders_phase2_test_v1 OWNER changmen_orders_phase2_test TEMPLATE template0;
COMMENT ON DATABASE changmen_orders_phase2_test_v1 IS 'changmen:pm-gtc-orders:phase2:disposable:v1';
