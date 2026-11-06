# 订单诊断查询优化（2026-11-06）

[changmen 扩展] 本轮只修改管理端只读诊断，并准备操作日志查询索引的维护草案，不修改下单、成交、结算、订单或余额。应用通过 GitHub Actions 发布；线上 RDS 索引维护独立执行，不随本次应用部署运行。

## 默认诊断与按需补查

浏览器使用表单请求，`preferDirect=true` 解码后是字符串。后端现在对 JSON 布尔值 `true` 和表单字符串 `"true"` 都启用执行事件优先查询；`false`、`"false"` 和其它值保持原行为。事件不足时仍可查询操作日志，不以缺少事件推断未下单。

已有诊断在刷新或补查期间保留可见，超时保留原内容并提示重试；重试保留本次查询参数。打开其他用户/Link/执行编号时清空旧内容，原请求代次保护继续防止迟到响应串单。按钮统一称“操作日志”。

## 操作日志索引维护

`fetchBettingUserLogsInRange` 同时查时间窗口和跨时间的精确 Link/订单号。不能只保留时间窗口，也不能在身份匹配前截断记录。原 SQL 和参数保留，避免改变跨日补单、精确关联优先级、返回排序和截断标记。

只调整条件顺序、CTE 或文字预筛的真实只读测试仍约 14–16 秒，没有采用这些效果不足的改写。示例用户约 130 万条操作日志中约 13 万条属于诊断类型；新增专用部分索引，直接索引这五类记录。

维护 SQL 草案如下，本机工件保存在 `output/order-diagnosis-timeout-20261106/user_logs_diagnostic_index.sql`。它在事务外 `CREATE INDEX CONCURRENTLY`，不修改业务数据，也不挂入自动应用发布或历史迁移。部分索引与并发创建的限制依据 PostgreSQL 官方文档：[部分索引](https://www.postgresql.org/docs/current/indexes-partial.html)、[CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)。

数据库模块已迁入 `rds`，`server/db` 已退役；本轮同步修正 AGENTS 中遗留的旧路径说明。索引目前仅作为独立维护草案，后续正式 SQL 资产应归 `rds/assets/`。

```sql
CREATE INDEX CONCURRENTLY user_logs_user_diagnostic_create
ON public.user_logs (user_id, create_at, id)
WHERE (
  title LIKE '%请求盘口数据%'
  OR title LIKE '%下注 =>%'
  OR title LIKE '%拒单%'
  OR title LIKE '%补单入队%'
  OR title LIKE '%补单取消%'
);
```

执行前须独立评审目标 RDS、容量和维护窗口，核对当前索引：

```sql
SELECT c.relname, i.indisvalid, i.indisready,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indexrelid = to_regclass('public.user_logs_user_diagnostic_create');
```

不存在时才执行上述 SQL 文件；已存在时须核对定义、有效状态及就绪状态，不用 `IF NOT EXISTS` 掩盖无效或同名错误索引。失败后的无效索引、或回退移除索引，均单独处理，不能自动删除。执行后重新核对定义及状态，并对照实际查询的计划和记录 ID。

索引不改变查询结果，应用可在其执行前后运行；但操作日志的性能优化依赖该索引实际建立。没有执行线上维护时，不能宣称线上补查已经提速。

## 验证

2026-11-06 本机 `npm run check:change` 完整通过：路由编译、后端及依赖回归、前端回归、类型检查和生产构建；验收期间代码指纹稳定。前端 7563 项通过、4 项跳过，backend 主包 1293 项通过、16 项跳过。另有 315 项诊断弹窗兼容测试及 305 项后端诊断专项测试通过。

以下 PostgreSQL 专项使用本机临时集群与 `output` 中的验证工件，不随应用发布。独立 CI 对实际提交的干净检出执行发布检查，不能把本机包含其它未提交工作时的通过结果当作该提交的独立发布验收。

```powershell
node output/order-diagnosis-timeout-20261106/local-index-acceptance.mjs
npm run check:change
```

独立 PostgreSQL 验证使用本机新建的临时集群，检查回环地址及独立端口，不读取现有数据库。30 万条模拟日志覆盖无身份查询、跨时间 Link/订单号、带转义字符的订单号、数字订单号、无效 JSON 旧文本、外用户隔离、精确关联优先、排序和截断；建立索引前后结果完全一致，并核对实际执行计划使用新索引。最新本机样本约 0.38 秒降至 0.10 秒，不能直接等同于 RDS 的耗时。

真实只读样本 Link `1793903668081`：原操作日志诊断约 16.44 秒；修复表单参数后，通过真实服务读取执行事件约 0.65 秒。详细证据在本机 `output/order-diagnosis-timeout-20261106/`。
