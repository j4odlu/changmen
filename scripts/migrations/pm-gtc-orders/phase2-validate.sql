-- [changmen 扩展] 独立只读验收模板。本轮未连接数据库执行。
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = public, pg_catalog;
SELECT public.validate_orders_execution_schema_v1() AS schema_valid;
SELECT count(*) AS total, count(*) FILTER(WHERE financial_ready) AS financial,
  count(*) FILTER(WHERE NOT financial_ready) AS pending,
  count(*) FILTER(WHERE execution_id IS NOT NULL) AS executions
  FROM public.orders;
SELECT count(*) AS financial_view_rows FROM public.orders_financial;
SELECT count(*) AS old_execution_rows FROM public.pm_gtc_executions;
COMMIT;
