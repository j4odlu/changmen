# PM GTC orders 并表工具（阶段一、二）

[changmen 扩展] 最终目标是把完整 GTC 执行控制和原单事实一起放入 `orders` 并撤掉旧表。阶段一为纯离线预检；阶段二完整结构在专用本机 PostgreSQL 40/40 通过。生产已增加 7 列，后续按指定 37 条的新授权，在实际旧版兼容验收后仅复制六个控制字段；原字段和财务资格不动，未建控制索引/视图/函数/触发器或切换读写，完整 schema 和兼容开关未启用。旧表仍为执行控制权威。见 [37 条回填验收](../../../output/pm-gtc-orders-legacy-compat-backfill-20261011/验收报告.md)、[仅增列验收](../../../output/pm-gtc-orders-production-add-columns-20261011/验收报告.md)及 [迁移方案](../../../docs/PM_GTC_ORDERS_TABLE_MIGRATION_PLAN.md)。

输入须符合 `schemaVersion=1`，包含 `complete=true`、同一次只读 REPEATABLE READ 快照标识、完整 `profiles` / `executions` / `orders`。可使用 [只读导出模板](export-snapshot.sql) 准备数据；该模板本轮未连接数据库执行。不可按用户或日期截取后改成 complete，也不可拼接不同事务。BIGINT `orders.id`、`player_id`、执行更新时间按字符串保存。

```powershell
node scripts/migrations/pm-gtc-orders/audit.mjs --input snapshot.json --output new-report.json
npx vitest run scripts/migrations/pm-gtc-orders/plan.test.mjs
```

退出码：0 表示本地预检无冲突；2 表示数据冲突，仍可生成可审查报告；1 表示参数或输入格式错误。`--help` 显示用法。没有 `--apply`，未知参数报错；不读取环境凭证或加载任何数据库、应用、场馆模块，不能覆盖输入或已有输出。报告明确 `offline=true`、`databaseSnapshotVerified=false`、`databaseBackfillReady=false`、`applied=false`；`preflightPassed=true` 只代表本地数据预检，没有替代后续数据库与消费者验收。

映射有三个动作：已有原财务行增加完整控制列 `attach-control`；原来无财务行创建 `financial_ready=false` 计划行 `insert-pending`；已迁完整控制与来源一致时 `noop`。三者都不执行 SQL。真正的回填还需阶段二消费者保护、实际 PostgreSQL 验证及阶段三来源版本/目标哈希检查，不能直接执行离线报告。

`attach-existing.mjs` 提供限定已有 TRUE 行的复制函数，不读凭证、不自执行、没有 apply CLI 或应用接线；仅 UPDATE 六个控制列。调用者须先完成实际版本兼容、全量来源/目标核对和 schema 验证，再显式传入 client 及带来源/目标哈希的 `attach-control`。try advisory + NOWAIT 行锁遇到忙业务即退出；哈希漂移、非唯一原单、部分或既有控制、FALSE 行、插入计划均拒绝；提交前精确比较全部原字段及旧源。每条事务独立，执行身份及目标 ID 名单必须固定，不能自动扩大回填或把已变更副本当 noop。生产本次仅原授权 37 条成功，实际兼容测试和生产 journal 在验收报告中链接。

`backfill-pending.mjs` 为缺订单记录提供单条事务执行器。每条先验证完整 schema、调用者声明的全部消费者兼容、原 UUID advisory lock、旧源行及来源哈希，再验证完整来源/载荷和唯一原单；没有对应订单才插入 FALSE 行，已到达的真实财务行只附加六列。完整控制相同可 noop，漂移/重复/跨归属则回滚；旧表不写、不执行状态命令、不触发通知。新增行保留原签单 hash 和全部 record，不把计划成本填成财务事实。

缺行 INSERT 需要关闭普通 writer 不共享 GTC 锁、原唯一键区分大小写所产生的空隙：工具取得短暂的 `orders` SHARE ROW EXCLUSIVE NOWAIT 锁后再次核对。已有写入忙时立即失败，不自动重试；锁持有期间新到达的写入仍可能短暂等待。该锁只在回填工具内，生产执行前须审查窗口和耗时，不能声称完全没有延迟影响。

`backfill.mjs` 默认只离线规划缺订单清单，不读取凭证、连接数据库或创建 journal。唯一执行选项 `--execute-isolated` 通过固定测试库、非特权角色、数据库标记及真实 loopback 服务端验证，**没有生产 apply 入口**。批次逐条提交、fsync 记录回执/journal，失败即停止；允许用原固定清单重跑已经一致的记录，来源更新后须重新审计，不能覆盖旧/新控制差异。实际消费者升级、生产兼容发布和生产执行入口不属于本轮。

```powershell
node scripts/migrations/pm-gtc-orders/backfill.mjs --input snapshot.json --output new-pending-plan.json
node scripts/migrations/pm-gtc-orders/integration/local.mjs --plan
# 本轮获准的独立本机实测；新建自己的临时实例，执行后停止并保留证据：
node scripts/migrations/pm-gtc-orders/integration/local.mjs --execute-local
```

本机完整结构下 64/64 集成测试通过，含原 40 项及新增缺订单回填的 24 项；普通首次 hook 与原 GTC 无普通 inserted hook 的行为分别验收，不因 FALSE→TRUE 新增 GTC 通知。详见 [缺订单回填验收](../../../output/pm-gtc-orders-pending-local/验收报告.md)。本轮未连接或修改生产库、提交或部署，生产继续旧源权威和原有 37 条副本状态。

原 UUID、owner、钱包、revision、授权、deadline、other、取消、释放、计次、facts、fills、财务助手缓存及未知历史字段都保持。回执 ID 与签单 hash 不一致、同原单多执行、大小写多行、归属冲突、较新目标、缺控制字段、缺 financial_ready 和孤儿记录均报错；不猜测 Link，不重算财务，不覆盖已有卖出/结算。报告只有身份、哈希和冲突，不包含完整控制 payload。

`phase2-add-columns.sql` 为独立增列脚本，首次生产结构授权仅覆盖此文件；六个控制列可空，`financial_ready boolean NOT NULL DEFAULT true`，原列/键及旧表不变。事务使用 ACCESS EXCLUSIVE NOWAIT，拿不到锁即失败须回滚，避免 DDL 排队；无任何 DML、索引或触发器。后续原 37 条的六列复制属于新的单独授权。

完整阶段二脚本为 `phase2-schema.sql`、`phase2-rollback.sql`、`phase2-validate.sql`，均须单独审查并另行授权执行，没有 apply CLI 或自动部署接线。前两者带事务、锁/语句超时及独立 schema 锁；回退只允许无控制数据、无 FALSE 行的空扩展，拒绝有数据回退和 CASCADE。只新增 7 列不足以通过完整 schema 验证，不能启用兼容开关，也不能据此直接执行完整回退脚本。

消费者兼容默认关闭；`ORDERS_EXECUTION_COMPAT=1` 需要启动只读验证通过才可使用 `orders_financial`。缺 schema 时不能降级使用普通表。在生产完整结构验收、所有生产消费者启用兼容前不能创建或回填生产 FALSE 行；应用环境开关未修改，生产原 37 条 TRUE 行仅附加非权威控制副本。详细资格、删除、锁及 hook 说明见 [阶段二记录](../../../docs/PM_GTC_ORDERS_PHASE2_ACCEPTANCE.md)。

结构迁移保留旧字段和键约束。旧版期间不安装新删除保护、控制索引及财务视图，不创建 FALSE 行；仅明确授权且通过实际旧版验证的已有订单允许复制非权威控制副本。原硬删会连副本一并删除，旧表仍保留恢复权威；旧源更新也不会自动同步副本，切换前须再次核对。只有活动消费者具备完整兼容后才能完整回填，最后切换控制读写并撤旧表。37 条已经有控制数据，不能执行仅限空扩展的回退。

## 第二阶段隔离 PostgreSQL 验收准备

[测试库脚本、执行顺序及逐项验收清单](integration/ACCEPTANCE.md)已补齐。真实套件从 25 类场景、40 项扩展到 40 类场景、64 项，使用原 writer、财务资格和 GTC 契约；本机 PostgreSQL 18.6 已全部通过（0 跳过），历史 40 项结果见 [实测验收报告](../../../output/pm-gtc-orders-postgres-execution-20261011/验收报告.md)，最新缺订单结果见上文报告。专用库/角色/标记及真实服务端地址必须全部符合隔离条件。测试默认发现不包含真实数据库套件；环境变量存在不会自动触发。

下面两条命令仅输出计划或运行离线准备检查，不执行数据库脚本：

```powershell
node scripts/migrations/pm-gtc-orders/integration/run.mjs --plan
npx vitest run scripts/migrations/pm-gtc-orders/integration/preparation.test.mjs
```

此前隔离测试授权范围内，`create-test-db.sql`、`bootstrap.sql`、`reset-fixtures.sql`、完整阶段二迁移/回退及专用 `--execute-isolated` 入口已在独立本机实例执行，实例已停止；该测试入口不读取应用凭证、不连接生产库。真实 catalog、锁、触发器、回滚及首次入库 hook 已通过最小结构验收；生产此次仅增列，完整结构和实际首单截止窗口仍未验收。
