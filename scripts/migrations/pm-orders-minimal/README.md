> [changmen 扩展] 2026-10-14：旧存储模式已退役，以下为历史方案。当前运行代码不读取旧开关，仍使用 orders 与 pm_gtc_executions。最小模式生产迁移入口拒绝执行；隔离验收仅运行固定 Git 27d51b200889c962b7bc21f2733ecd895fa3a1e9 的历史 writer。当前数据整理使用 scripts/migrations/river-gtc/result-copies.mjs。

# PM FOK/GTC 最小订单兼容：本机及显式迁移工具

[changmen 扩展] 保留 pm_gtc_executions 的完整记录及原执行来源，只向 orders 添加 PM 模式、小投影和非财务订单资格。不新建执行控制表，不把计划、授权、成交明细完整复制进订单行。

PM_ORDERS_MINIMAL 默认关闭；启用前仅 SELECT 验证 validate_pm_orders_minimal_v1。与旧 ORDERS_EXECUTION_COMPAT=1 互斥。FOK、传统对侧、卖单及未知历史模式不自动猜测或改标，原 FOK 执行及保存入口保持。

schema.sql 是显式增量脚本，复用 financial_ready/execution_id，仅增加 pm_order_mode/pm_order_snapshot，不改旧列和数据，不安装旧完整执行控制约束或触发器。它不在启动或交易请求中运行。本地新 schema 首次安装后，重试先运行只读 validator；不要重复直接执行 ADD CONSTRAINT。显式生产工具见 PRODUCTION_RUNBOOK.md；本轮只在隔离本机测试，没有生产执行。

```powershell
node scripts/migrations/pm-orders-minimal/local.mjs --plan
node scripts/migrations/pm-orders-minimal/local.mjs --execute-local
node scripts/migrations/pm-gtc-orders/integration/local.mjs --execute-local
node scripts/verification/verify-pm-orders-minimal-release.mjs
```

前两项使用默认 D:/PostgreSQL/18/bin（可显式设置 PM_GTC_PG_BIN），只创建自己的全新 127.0.0.1:55443 实例，校验真实 data_directory、专用标记库、非特权测试角色后，执行 87 项真实 PostgreSQL 回归并停止实例。端口忙时退出，不停止其它服务。测试凭证随机生成、不打印；应用 DATABASE/PG 凭证不传入测试子进程。第三项独立重跑原 64 项，各用自己的新实例，须顺序执行。

run.mjs 默认只输出计划，--execute-isolated 还要求正确测试 URL/执行令牌/证据目录，不能接受生产地址或普通本机库。postgres.integration.mjs 不属于默认 *.test.* 发现范围。DDL/DML 仅在这个验证后的可丢弃测试库发生。

订单投影只在原首单关闭后的 facts 核对保存路径执行；原 first create、authorize、ack 和 open 状态不增加投影 SQL。缺行时 NOWAIT 短暂 orders 写锁重查，忙锁使本次事务回滚，由既有核对流程重新读取；已有行按原 UUID/订单锁串行，不能覆盖其它执行或较新投影。执行记录不切换、不回填、不重设 counted；投影从不作为下注、拒单检测、补单或恢复输入。

所有财务/选号/检测消费者继续使用原财务集合；工作台及 GTC 模式订单页可以读取真实非财务原单，仍保留 DisplayOnly 操作和未知金额保护。普通首次入库 hook 只在原 COMMIT 后首次 INSERT；普通 writer 不得晋升陌生 GTC 非财务行，原 GTC 专用晋升不新增普通 hook，通知异常隔离。新列不泄露到旧 hook payload。

发布保护保留原 FOK/VPS 提交及 551 项清单。新保护精确撤销七个新增接线，再比较完整已发布模块；新 helper 全文固定 SHA，负向测试拒绝越界。当前结果写在 output/pm-orders-minimal-*，历史失败记录保留。通过本机保护不代表已允许生产结构安装、开关开启或历史回填。

2026-10-13 本机 bug 复核：新增 11 项真实 PostgreSQL 负向/竞争回归，修复前全部失败。旧七列 execution_id 副本缺少有效 GTC 投影时沿原硬删，不改变旧执行记录；财务 ON CONFLICT 取得目标锁后再次验证当前模式和双重执行身份，冲突使用原 NOT NULL 约束使整笔事务回滚；启动拒绝三列异常默认值及 NOT NULL，增量脚本提交前验证 schema。零成交正常终止 DTO 保留原 Return 展示，错误/未知状态不推断退回。仅 GTC 新开关生效，旧完整兼容删除 SQL 与 FOK 原路径保持。

删除财务后追加成交的原 raw 账本保持不变；非财务 DTO 的 PmShares/PmGtcBuyShares 同取已核对的小投影，避免已发布前端以旧 gross 覆盖新量，未知份额不按旧值补齐。新增一项真实数据库回归及三项实际前端投影链路测试。

生产工具默认只输出计划；显式 schema-plan/install、batch-plan/apply/rollback/reconcile 依次校验预期数据库身份、schema 和人工消费者声明。每批最多 25 条、整体 3 秒预算，忙锁立即失败，无自动 SQL 重试。提交前持久化不可覆盖回执；来源/目标漂移、财务晋升停止，COMMIT 不确定先只读核对。PM_ORDERS_MINIMAL_PROJECTION_WRITE=0 只暂停展示投影，保留 PM_ORDERS_MINIMAL=1 的财务过滤及原事实/财务晋升流程。

最终入口 node scripts/verification/verify-pm-orders-minimal-acceptance.mjs --postgres <87项acceptance.json> --legacy <64项acceptance.json> --out <新报告.json> 离线检查当前源码、完整 18 项保护及明确指定的数据库证据，不能引用旧报告放行。完整保护仅对识别出的公开网络连接错误保留失败并原命令重跑一次，不重设基线或豁免断言失败。
