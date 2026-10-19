-- DEPRECATED / no-op.
--
-- 过期数据清理已统一由 gamebet-matcher 调用 server/db/prune_stale.js：
--   - platform_bets / live_timers: 过期删除
--   - platform_matches / client_matches: 过期移入 *_history 后删除
--
-- 不再使用 pg_cron，也不再使用 client_matches.list_status。
-- 旧环境如曾手动注册过 cron.job，请人工 unschedule 后删除 pg_cron 任务。
SELECT 1;
