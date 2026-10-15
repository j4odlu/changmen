# 修复后的第二次并发、事务与缓存复核

后续状态：本报告的 S1/S2/S3 已按先补正式失败回归、再修复服务端的顺序处理；最新 7 项并发回归及全量检查见 [修复验收](./REVIEW_FIXES_LOCAL_ACCEPTANCE.md)。下文和机器 JSON 保留发现问题当时的证据。

日期：2026-10-15。结论：仍有 3 项已复现问题，当前不能确认本轮修复没有引入并发回归。
本次仅增加本地复现和审查记录，未修改业务实现、前端或部署配置，未连接生产 RDS。

## S1 / P1：旧余额刷新发生第二次持久化，覆盖较新的余额

位置：`server/backend/core/account/account_service.js:608`、`core/db/store.js:227`，PM 同步助手也使用相同路径。
余额刷新先调用 updatePlayerBalanceRow 落库，随后 syncAccountRowInKv 现在改为 updateAccountForUser。
后者把传入的旧 balance 再次写入数据库；锁只能保证每次修改串行，不能识别参数已经过时。

实际函数复现：

1. 第一轮刷新已将余额 10 写入数据库；延迟其 syncAccountRowInKv 调用进入局部修改。
2. 实际 handleUpdateBalance 收到余额 20，成功写入并返回成功。
3. 恢复第一轮同步，数据库余额从 20 回到 10。

这是本轮把同步助手改为持久化局部 patch 后引入的回归。原整表同步的 accountsPersistUnchanged 会忽略这些易变字段。
之前验证的“完整 ACCOUNT 保存保留新余额”仍成立，但未覆盖这条第二次写余额的路径。
修复方向：明确余额只有一次持久化职责，后续元数据/缓存同步不能再次使用过期金额；若保留二次写入，需要版本条件并同步处理 totalProfit 等衍生值。
不能通过减少 A8 前端保存或调整客户端请求时序规避。

## S2 / P1：局部修改与充值的锁顺序相反，触发真实 PostgreSQL 死锁

位置：`server/db/rds/player_store.js:1270`、`player_store.js:815`。
局部 patch 复用完整替换事务，依次取得 profiles FOR UPDATE、players FOR UPDATE。
已有 rechargePlayerBalanceWithMoneyLogRow 则先锁定 player，然后插入 money_logs。
money_logs.user_id 外键引用 profiles，插入会申请该 profile 的 KEY SHARE，与前者的 FOR UPDATE 冲突。

复现：暂停已经锁定 player 的充值，启动局部 patch 并确认它取得 profile 锁，再恢复充值。
两者循环等待，PostgreSQL 报 `deadlock detected`，实际充值函数返回 `{ ok: false }`。
被中止事务正确回滚，本次没有复现部分充值或流水残留；问题是正常并发请求会失败。

完整 ACCOUNT 路径此前已有相同锁模式；本轮将局部修改也接入该锁，使原局部路径新增这一风险。
需统一账号、充值及关联外键写入的锁次序，或重新设计兼容 FK 锁的用户级互斥。
不能仅根据单个事务自身的 BEGIN/COMMIT 正确，就认定跨入口并发安全。

## S3 / P2：删除路径未参加队列，较早的提交结果能把已删账号放回缓存

位置：`server/backend/core/db/store.js:244`、`store.js:249`、`core/account/account_service.js:114`。
更新在 runAccountWrite 中发布整份 records，但删除先独立写数据库，再同步 removeAccountForUser，没有进入同一协调范围。

复现：

1. 局部修改的 COMMIT 已在数据库完成，延迟其结果交付，缓存尚未发布。
2. 实际 handleDeletePlayer 成功软删除账号并移除缓存，返回成功。
3. 恢复较早更新的响应，`_accountsCache.set(id, records)` 将已删除账号重新加入缓存。

结果：数据库 deleted_at 非空，但 listAccountsForUser 仍包含该账号。没有发生数据库“取消删除”，属于缓存复活。
这是本轮队列统一未覆盖的并发边界；不能将进程内写队列等同于所有账号生命周期入口都已串行化。
修复方向：将删除的数据库操作、缓存发布与其它修改统一协调，或为发布增加可靠的失效代次/删除屏障；只改移除缓存那一行不够。

## A8 与验证结论

[changmen 扩展] 本轮问题均在服务端持久化或缓存协调。前端、插件的运行源码没有被本次复核修改；与 HEAD 的相关 tracked diff 为空。
FOK 精确保护检查继续通过，未修改冻结文件、保护规则、基线或客户端轮询/保存调度参数。
这些证据支持“前端调用逻辑与调度没有改动”，但 S1/S3 会改变客户端读到的数据，不能据此确认端到端业务行为完全兼容 A8。

重新强制执行的完整 npm test 仍为 14 任务通过，原 12 个修复数据库场景也通过，说明它们没有覆盖上述交错。
前端 vue-tsc 及 FOK 精确保护另行复跑。保留的既有 skip 和 resolver expected fail 未改变。
本轮不做生产发布验收、不运行真实场馆请求，不能将通过的本地检查当作生产可用证明。

## 证据

- 复现：`output/review-fix-second-audit-20261015/reproduce.mjs`
- 结果：`output/review-fix-second-audit-20261015/reproductions.json`
- 原始日志：同目录 `reproduce.log`、`all-tests.log`、`existing-postgres.log`、`fok.log`、`typecheck.log`
- 机器汇总：[review-fixes-second-audit.json](./review-fixes-second-audit.json)

复现使用自建临时 PostgreSQL、回环地址、临时 storage 和合成账号；通过门控控制现有函数的查询/响应交付，没有改变真实 SQL 业务内容。

```powershell
$env:CHANGMEN_TEST_PG_BIN = 'D:\PostgreSQL\18\bin'
node output/review-fix-second-audit-20261015/reproduce.mjs
```

3 项当前仍未修复。下一步应先把这些交错纳入正式回归测试，再修复服务端协调，继续保持 A8 前端不变。
