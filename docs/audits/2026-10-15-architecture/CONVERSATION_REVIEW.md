# 本对话实施复核

后续状态：本文的 5 个复现问题及心跳测试隔离风险已修复并完成本地回归，见 [修复验收](./REVIEW_FIXES_LOCAL_ACCEPTANCE.md)。本文保留修复前的问题与证据；当前复跑应使用正式回归入口。

复核日期：2026-10-15。范围是本对话第一、第二阶段的变更、测试与验收表述；工作区原有其它改动未归为本次引入。
结果：5 个问题已在独立临时 PostgreSQL 中复现，另有 1 个测试隔离风险由源码确认。
本次只新增复现和复核记录，未修改业务实现、未部署、未连接生产 RDS。

## 1. P1：普通 ACCOUNT 保存可覆盖更新后的余额（第一阶段新增回归）

位置：`server/backend/core/account/account_service.js:341`、`server/backend/core/db/store.js:209`。
旧入口调用 `replaceAccountsForUser`，会通过 `accountsPersistUnchanged` 跳过仅余额、时间等 volatile 字段变化的重复保存。
新完整事务入口没有保留这项处理，每次保存都会调用 batch UPDATE，非 PredictFun 账号的 `total_balance` 使用客户端值。
复现：账号缓存/请求余额为 0，`updatePlayerBalanceRow` 先确认写入 123，再保存同一份 ACCOUNT 请求，数据库变回 0；请求返回成功。
这不表示场馆实际资金被修改，但会写错服务端账号余额及基于该值的展示/判断。原有前端调用顺序无需变化即可触发。
建议：在服务端完整事务中区分配置字段与易变字段，保留原有去重行为或独立余额写入职责；不能在前端减少保存调用规避。
复现编号：R4。

## 2. P1：默认批量保存抛错时，部分账号已经提交（第一阶段修复不完整）

位置：`server/db/rds/player_store.js:1229`。
`batchSavePlayerAccountRecords` 仍可在没有传入事务 client 时调用 pool.query。
SQL 更新存在的账号后自动提交，随后才检查 rowCount；包含不存在、软删除或归属变化的账号时抛错，但无法撤销已更新的其它账号。
完整 ACCOUNT 的 replaceWith 分支有事务；`replaceAccountsForUser` 等默认路径仍没有。
复现：一条有效账号和一条缺失 ID 一起保存，函数抛出“账号保存未全部确认”，有效账号 token 已变为 `partial-committed`。
建议：默认批量入口也应自行持有事务，行数检查在 COMMIT 前完成；传入 client 时继续复用调用方事务。
复现编号：R1。

## 3. P2：写队列没有保护调用方读取、合并的全过程（原有问题未覆盖）

位置：`server/backend/core/db/store.js:193`；调用方例如 `account_service.js:408`、`account_service.js:609`。
队列内处理的是调用方已经构造好的完整数组。两个请求先从同一份旧缓存复制列表，再分别修改不同账号或字段，排队保存仍是后者覆盖前者。
复现：两份旧列表分别更新账号 1 和账号 2 的 token；Promise.all 保存后，账号 1 的新 token 丢失，账号 2 的修改保留。
建议：把读取当前状态和合并 patch 放到队列及数据库事务内；局部修改避免重写整份旧数组。
复现编号：R2。

## 4. P2：旧 profile 查询可覆盖已提交配置，后续保存丢字段（原有问题未覆盖）

位置：`server/backend/core/db/store.js:98`。
配置写入使用了 runProfileWrite，但 loadProfileById 不参与同一代次协调，查询返回后无条件覆盖缓存。
复现：延迟交付已读取的旧 profile；提交 `{ saved: 2 }` 后交付旧读取，缓存回到 `{ base: 1 }`；再保存 `{ next: 3 }`，
数据库变成 `{ base: 1, next: 3 }`，已成功保存的 saved 字段被删除。
建议：profile 的读缓存发布也采用代次保护或统一读改写协调，不能只串行化写函数。
复现编号：R3。

## 5. P2：列表冷启动读失败仍被返回成成功空列表（原有问题及验收表述错误）

位置：`server/backend/core/esport-api/store.js:538`、`router.ts:574`。
新快照层在无可信数据且读取失败时返回 null；backend 没有旧投影则也返回 null，buildMatchList 将它转换为 []，路由继续 ok(list)。
复现：在没有列表缓存时，注入 client_matches 查询失败，buildMatchList 正常返回 []，没有抛错。
第二阶段验收中“不伪造空库成功”的说法只描述了快照层，不能代表完整 HTTP 路径，已补充更正。
建议：区分“数据库确认空”与“没有可用快照”，在现有失败响应契约内报告后者，不改变前端调用时序。
复现编号：R5。

## 测试与动作复核

- 既有 matcher 心跳测试直接写仓库内 `.matcher-heartbeat.json`，afterEach 删除该文件，没有临时路径或恢复原文件。
  backend/DB 测试的临时 storage 不会改变该硬编码路径。本机 backend 若同时运行，完整测试可能覆盖并删除它的运行心跳，干扰单写守卫。
  此为既有测试风险；没有证据表明本次实际发生了并行写入。本轮复核没有再运行会触碰该心跳的测试。
- 历史日志中的 14 任务通过、类型检查通过及本地 PostgreSQL 12 场景通过均有对应记录；它们没有覆盖以上复现，不能据此认定无缺陷或可生产发布。
- resolver 的反向匹配错误仍是已记录的 expected fail；不是本轮新增，也没有修复。
- F10/F11 的队列重试、排空及 readiness 已明确留作后续；不能把它们算作第二阶段本批已实现。
- 第一阶段曾遇到临时目录清理被自动审批拒绝，已在该阶段文档记录；没有重新尝试清理旧目录。
- 本次未发现迁移清单及锁/逐迁移事务的新确定性错误；第二阶段宿主端口装配与单语句列表版本读取也未复现新的功能回归。

## 证据与重跑

复现脚本：`output/conversation-review-20261015/reproduce.mjs`。
结果：`output/conversation-review-20261015/reproductions.json`。
日志：`output/conversation-review-20261015/reproduce.log`。
脚本使用自行创建的临时 PostgreSQL、loopback 地址及临时 storage，不读取生产状态；所有业务模块在测试地址覆盖后加载。

```powershell
$env:CHANGMEN_TEST_PG_BIN = 'D:\PostgreSQL\18\bin'
node output/conversation-review-20261015/reproduce.mjs
```

上述 5 项复现应先转成正式回归测试，再修复实现。修复完成前，第一、第二阶段记录只能作为当时测试结果，不能作为无缺陷结论。
