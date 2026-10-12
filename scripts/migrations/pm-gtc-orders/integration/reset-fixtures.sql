-- [changmen 扩展] 仅清理本专用测试库中的测试夹具，不作为业务删除或回退工具。
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='8s';
SELECT public.assert_pm_gtc_phase2_test_database();
TRUNCATE public.orders,public.pm_gtc_executions,public.profiles RESTART IDENTITY;
COMMIT;
