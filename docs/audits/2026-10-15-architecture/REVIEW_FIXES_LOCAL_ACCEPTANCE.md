# 复核问题修复与本地验收

**最新独立复核与改进：** 本轮发现首次账本接入的历史 SQL 重放风险后，已按用户要求改成日常发布只读结构核验，初始化仅允许显式空库操作。详见 [独立复核](./FINAL_RELEASE_REVIEW.md) 及其机器结果。下文保留此前测试结果，不作为新增边界的安全证明。

最新状态：第二次复核的 S1/S2/S3 已完成服务端修复，先失败后通过的正式回归及最新复核结果见下节。后文保留上一轮验收；历史缺陷证据见 [第二次复核](./REVIEW_FIXES_SECOND_AUDIT.md)，不代表当前仍未修复。

## 发布流程改进后的本地验收（2026-10-15）

最新结论：下节发布就绪检查发现的两个本地阻断已处理；正式 `npm run check:change` 的 full 级别 10 个阶段全部通过，`sourceStable=true`。这属于本地工作区验收；`completeRelease=false` 保持，没有 commit、push、生产版本捕获或生产部署，尚不能将其当作完整发布批准。

[changmen 扩展] 普通发布不再自动运行 profiles.accounts/storage JSON 导入、owner 回填和孤儿软删除。删除了根据账号源码路径设置迁移标志、随后调用上述工具的链路；为了兼容已有计划输出，players/owner 两个退休字段保留为 0。SQL 文件或 schema helper 变化仍会触发带账本的 SQL 迁移，明确 full 激活也保留 SQL 核验；前置约束不满足时中止，不会自动重写历史账号。历史工具仍可用于独立维护，本次没有修改其直接人工执行时的行为。

先补的 5 个部署计划防回填场景在旧实现全部失败；修复后，原有与新增共 12 项部署计划检查全部通过。新增 `npm run test:deploy-safety:postgres`，执行真实部署激活脚本及真实 SQL 入口，同时用临时文件和替代命令隔离 npm、PM2、网络；3 项场景通过：

- 普通账号代码发布：不启动历史账号脚本，保留当前余额 200、当前 token 和旧 profiles.accounts。
- 迁移账本首次接入旧结构：重放现有 SQL 并记录 42 项迁移，当前完整 players 行不变。
- 显式 full 激活：仍不启动账号数据导入或归属修复，当前完整 players 行不变。

另在临时 PostgreSQL 验证了无 owner 的活跃旧账号：027 前置检查拒绝继续，但保留原余额、token、NULL owner 和未删除状态，没有代替操作者做历史归属修复。原风险复现脚本直接调用的是旧人工工具，断言的是其历史覆盖行为；当前日常部署是否安全应使用新的部署路径回归，不能混用两种结果。

[changmen 扩展] 3 个保护失败通过增加精确持久化增量登记解决，没有回退业务修复，也没有修改原 551 项 manifest 或两个固定基线。`account-persistence-increments.json` 逐项记录 12 个已审查的完整顶层声明前后文本，契约内容由固定摘要锁定；验证器仅允许这些完整新文本精确还原为修改前文本，随后仍进入既有逐段还原和整个原模块比对。没有文件/函数名豁免、通配剥离或忽略未知语句。新增 29 项验证覆盖原文本来源、完整还原、正文篡改、局部回退、额外动作和契约修改。保护代码增加了这项严格增量识别；不能将其描述为“所有保护脚本逐字未改”。

本地验收结果：

- 原始 551 项完整保护：551/551，通过；原清单、哈希和冻结基线不变。
- `check:change` full：部署控制、551 保护、验收控制、保护规则、Node 保护、router 编译、全部后端、前端类型检查、全部前端、生产构建，10/10 通过，源码输入稳定。
- 部署控制 Node 53 项及离线 shell 发布集成通过；保护规则 1672 项、验收控制 51 项通过，包含新增 29 项精确增量检查。
- 后端 705 通过/16 项既有 skip；DB 359；matcher 188；前端 3938 通过/1 项既有 skip。resolver 6 通过/1 项既有 expected fail 保持。前端 build 实际执行 `vue-tsc -b` 和 Vite 构建。
- 原有账号、事务、matcher 等 51 项 PostgreSQL 场景以及 5 项缓存边界再次通过；新增部署 PostgreSQL 3 项通过，另有孤儿前置检查实测通过。

[A8 可证实] tracked client/extension diff 仍为空；A8 bundle、前端账号调用链、120–180 秒等待及既有调度参数没有修改。本轮修改集中在部署触发、正式检查的精确增量登记和测试；此前账号持久化修复的运行代码保持原样。

正式本地验收不包含生产的完整 22 阶段来源捕获/兼容性验收，`fullReleaseAccepted`/`completeRelease` 不会被改成 true。工作区仍混有原有其他改动和未跟踪文件；整理准确候选提交后，仍须由 Actions Validate and release 验收并发布。生产是否有待人工维护的历史数据，本次未连接生产确认。

机器汇总：[deploy-safety-verification.json](./deploy-safety-verification.json)。原始日志为 `output/deploy-safety-*.log`，孤儿验证源码为 `output/deploy-safety-orphan-recheck.mjs`。正式运行状态也保存在 `output/change-validation/verdict.json`，该路径会被后续正式检查更新。

## commit / push / 部署就绪检查（改进前的历史记录，2026-10-15）

结论：当前不能放行 `master` push 和生产部署。本地可先整理准确范围作为待验收提交；不能把此前业务回归通过等同于发布保护通过。本次只执行本地检查和临时数据库复现，没有 commit、push 或生产操作。

### 阻断一：正式原 551 项保护未通过

执行 `npm run check:change`，范围被正式入口判定为 full，第一阶段 `fok-551` 失败，后续阶段未执行；`sourceStable=true`、`completeRelease=false`。此前通过的 `check:fok-parity` 覆盖范围更窄，不能替代 `check:change` 或完整 22 阶段发布验收。

在不修改保护文件、原始 manifest 和基线的情况下，补充逐项诊断 551 个原条目：548 项通过，3 个业务文件不满足原保护约束：

- `server/backend/core/account/account_service.js`：complete fixed-baseline module。
- `server/backend/core/integrations/polymarket/pm_client_handlers.js`：unregistered protected source difference。
- `server/backend/core/integrations/predictfun/pf_player_account.js`：unregistered protected source difference。

这属于明确发布门禁失败；本次没有绕过检查、改保护基线或将其降级。证据：`output/commit-push-readiness-local.log`、`output/commit-push-readiness-551-diagnostic.json`，正式 verdict 位于 `output/change-validation/verdict.json`。

### 阻断二：普通代码部署会触发有覆盖风险的历史账号回填

`deploy/scripts/deploy-server-remote.sh:271` 将本次 `core/db/store.js` / `server/db/rds/player_store.js` 变化归入 players 迁移，随后 `:343` 自动执行 `migrate-accounts-jsonb-to-players.mjs`。该旧脚本从 `profiles.accounts` 合并历史 JSON 后调用 `savePlayerAccountRecord`，会将历史余额和 token 写回当前权威 players 行；此次改动的 `apply-rds-schema.mjs` 也会触发 schema 应用。`release-backend.sh:53` 明确代码回退不撤销数据库修改。

已使用临时 PostgreSQL、合成用户和真实未修改迁移脚本复现：players 原余额 200、token=`synthetic-current`，历史 JSON 为余额 1、token=`synthetic-legacy`；执行后 players 变成 1 / `synthetic-legacy`。测试没有连接生产，不能据此断言生产当前一定有历史非空 JSON；但未经隔离，部署路径具备这项明确的数据覆盖风险。

复现入口 `scripts/testing/release-account-backfill-replay.mjs`；日志 `output/commit-push-readiness-backfill.log`。该脚本断言的是风险当前存在，不应当作“部署安全通过”的回归入口；修复时应改为验证权威数据被保留，并检查 storage JSON 导入等同类部署分支。

### 提交范围与下一步

当前在 master，0 文件暂存、54 个 tracked 文件变更，另有本轮必需的新模块、测试及原有不相关文档删除、前端未跟踪文件、浏览器快照和 output。不能 `git add .` 后直接推送；必须完整纳入本次 runtime ports、snapshot cache、写队列、迁移工具和 offline test setup 等依赖，同时排除原有无关改动和本地数据。

[changmen 扩展] `.github/workflows/release.yml:3` 在 master push 时自动进入 Validate and release；有组件待发布时会在验收后自动部署。所以 push master 不是单纯备份动作。本次没有调用生产版本捕获、生产 RDS、迁移或部署。

应先解决 3 个保护失败、隔离会覆盖权威数据的自动回填、整理干净候选，再对候选执行正式本地验收；生产仍只由 Actions 完整验收及其绑定的不可变 artifact 放行。机器汇总：[commit-push-deploy-readiness.json](./commit-push-deploy-readiness.json)。

## 再次独立复核（2026-10-15，S1/S2/S3 修复之后）

结论：在本次源码复核与本地故障注入覆盖范围内，未发现此次修复新增的业务并发、事务回滚或缓存失效缺陷。本轮仅新增两个审计测试脚本及验证记录，没有修改业务实现、客户端或部署配置。复核前后记录的 46 个现有文件内容哈希一致。

[changmen 扩展] 新增 8 个真实临时 PostgreSQL 场景，全部通过：

1. 用延迟约束触发器令充值在真正 COMMIT 时失败；余额、流水均回滚，下一次充值成功。
2. 令 ACCOUNT 在真正 COMMIT 时失败；账号字段与 prune 均回滚，缓存保持原值，后续队列可继续写入。
3. owner 锁等待超时；充值无余额/流水残留，事务释放后可恢复。
4. 一个 owner 被锁住时，另一用户的账号修改仍可提交。
5. 严格回源已读到旧行、但延迟交付期间成功删除；旧行不会恢复到缓存。
6. 删除被数据库拒绝，较早已提交的账号修改延迟交付；账号保持活跃，缓存不会被失败删除误过滤。
7. 账号修改已完成 ROLLBACK、延迟返回期间成功删除；失败操作不恢复旧缓存，下一项队列修改成功。
8. 元数据修改先取得 player 锁，较新的 Client_UpdateBalance 随后到达；两项数据库修改均保留，严格回源读取最新余额。

另新增 5 个列表快照缓存场景，全部通过：meta 探测期间连续失效、重载期间再次失效、共享读取失败后所有等待者错误传播及后续恢复、失效后数据库故障与确认空区分、畸形快照拒绝及恢复。返回值的嵌套引用隔离和 bigint 字符串也一并校验。

原有 7 项账号并发、12 项复核修复、12 项第一阶段及 12 项第二阶段 PostgreSQL/HTTP 场景重新执行全部通过。加上新增测试，共 51 项 PostgreSQL 场景和 5 项额外缓存场景通过。入口：

```powershell
$env:CHANGMEN_TEST_PG_BIN = 'D:\PostgreSQL\18\bin'
node --test scripts/testing/account-boundary-audit-postgres.mjs
node --test scripts/testing/snapshot-boundary-audit.mjs
```

全量检查：最终 `npm test -- --force` 14/14 任务通过，0 任务缓存；backend 705 通过/16 既有跳过，DB 359，matcher 188，前端 3938 通过/1 既有跳过；resolver 6 通过/1 既有 expected fail。前端强制 `vue-tsc -b`、backend router 编译、FOK 180 项对比/20 个确认故障/45 个原门控与 51 项 GTC 隔离检查均通过。Windows CRLF diff 检查通过。

本轮发现并保留一项独立的既有测试波动：首次全量运行的 `core/auth/web_session_routes.test.mjs:52` 报 `fetch failed / bad port`，因此首次全量不能记为通过。该测试使用 `server.listen(0)`，日志未保存具体端口；不能据此断言当时的具体端口值。没有修改该测试或认证业务代码，单独复跑 10/10、随后整套强制重跑 14/14 通过。失败、单测复跑、全量复跑日志分别是 `output/account-boundary-audit-all-tests.log`、`account-boundary-audit-cookie-recheck.log`、`account-boundary-audit-all-tests-recheck.log`。这项测试稳定性问题未在本轮修复。

[A8 可证实] 再次读取本地 bundle 的账号 store：整包 `ACCOUNT` 保存；逐账号 `updateBalance → updateOrders`；finally 中本地订单读取后保存账号；连续刷新等待 `120*1e3+Math.random()*6e4`。当前前端对应调用次序、120–180 秒等待区间、无空数组/admin 保存门控均未修改。tracked client/extension diff 为空；bundle SHA256 仍是 `33b8a5e586f55564ac5483c723cc613b144726985daaa45c936d90fa038c4279`。matcher 默认 30 秒及 timer debounce 3 秒参数没有变化；精确保护入口、基线和冻结清单保持。

边界说明：测试验证了数据库明确拒绝 COMMIT 的回滚，并不证明网络在提交响应期间断开时一定未提交；已有故障降级允许读取上一次确认的赛事投影，单独余额写入后的账号缓存也不承诺每个中间时刻强一致，严格回源/随后的 ACCOUNT 保存负责刷新。这些既有语义未由本次修复改变。没有生产连接、真实场馆访问、真实下注、生产迁移或部署，不能将本地通过等同于生产端到端验收或绝对无缺陷证明。

机器汇总：[account-boundary-audit-verification.json](./account-boundary-audit-verification.json)。源码核对证据：`output/account-boundary-audit-source-evidence.json`。本轮原始日志：`output/account-boundary-audit-*.log`。

## S1/S2/S3 修复与再次复核（2026-10-15）

[changmen 扩展] 按“正式并发复现 → 验证失败 → 修复服务端 → 扩展边界回归 → 全量复核”执行。新增根命令 `npm run test:account-concurrency:postgres`，实现位于 `scripts/testing/account-concurrency-postgres.mjs`，使用临时 PostgreSQL 和合成账号。修复前 3 项全部失败，原始日志保留于 `output/account-concurrency-before.log`；修复后扩展为 7 项全部通过。

| 问题 | 最终修复 | 关键验证 |
| --- | --- | --- |
| S1：旧刷新第二次写回余额 | 三处余额同步助手使用内部 preserveBalance 选项，锁内合并时丢弃旧余额及别名，沿用 players 的最新值；普通账号利润按最新余额和 credit 计算，PF 保留已结算盈亏；响应返回同步后的金额 | 实际 Client_UpdateBalance 20 不再被旧值 10 覆盖；PF 余额 40 不被旧值 10 覆盖，利润保持独立语义；PM 回包不再覆盖成先前采样值 |
| S2：账号更新与充值死锁 | 充值事务在锁 player 前取得 owner profile 的 KEY SHARE，提前取得 money_logs 外键所需锁；完整 ACCOUNT 继续使用原有 FOR UPDATE 强锁 | 两种相反启动顺序均提交；4 个并发充值精确累加；注入流水失败时余额和流水同时回滚；并发建号被 owner 锁阻塞，保存结束后新账号不被 prune |
| S3：删除后旧快照复活缓存 | 所有排队的账号读写共用发布屏障；操作期间成功删除的 ID 从待发布结果中过滤；操作结束（含失败）即释放屏障；成功软删除后先移除缓存，再清理流水 | 实际 COMMIT 结果延迟交付时删除仍成功，旧结果不再复活账号；普通/严格回源、完整替换、ACCOUNT 事务、局部修改均覆盖；空缓存、多次删除、失败后恢复及新回源允许账号重新出现均覆盖 |

屏障只协调本进程账号缓存的在途发布，不引入永久删除标记或全局串行锁。数据库事务仍由已有 owner/player 锁协调；没有额外的提交后查库失败窗口。删除流水清理失败仍沿用原错误传播，但已删除账号不会因此留在缓存中。

再次复核检查了账号所有缓存发布点、失败释放、锁次序及外键、余额别名、PF 账本/利润、完整保存的强锁和 prune；并重跑 matcher 列表的版本、失效、确认空、结束态、独立 PM 字段及提交失败场景。在此次覆盖范围内未发现新的并发、事务或缓存回归。

最新本地结果：

- `npm test -- --force`：14/14 任务通过，0 缓存；backend 705 项通过、16 项既有跳过；DB 359；matcher 188；前端 3938 通过、1 项既有跳过。新增 11 项默认后端回归覆盖删除发布及余额/响应语义。
- PostgreSQL：新增 7 项，之前三组各 12 项均通过，共 43 项。
- 前端 `vue-tsc -b`、backend `compile:router`、FOK 180 项对比/20 个确认故障/45 个原门控及 51 项 GTC 隔离检查通过；`fullReleaseAccepted=false` 保持。
- Windows CRLF 文件按 `git -c core.whitespace=cr-at-eol diff --check` 检查。

首次全量检查暴露既有 `clob_proxy.test.mjs` 的真实公共 `/time` GET，TLS 失败中断测试。已将该默认测试改为本地响应夹具，并增加请求参数/响应校验，随后完整重跑通过。保留失败日志 `output/account-concurrency-all-tests.log`，最终结果为 `output/account-concurrency-all-tests-local.log`；未进行真实下注、生产 RDS 操作或部署。

[A8 可证实] 客户端 ACCOUNT 整包保存、余额刷新后的保存顺序继续沿用当前复刻实现；本次未编辑客户端/插件运行源码、A8 bundle、轮询参数、采集门控、接口 action 名或请求数。tracked client/extension 相对 HEAD 的运行改动为空；仓库原有未跟踪文件保持。参考 bundle SHA256 为 `33b8a5e586f55564ac5483c723cc613b144726985daaa45c936d90fa038c4279`，与前两轮机器验证记录相同。受精确保护的 server.js、DB index.js / impl_rds.js 和冻结规则未改。

上述结论是本地回归范围内的兼容性证据，未进行生产或真实场馆端到端验收，不承诺排除所有缺陷。resolver 原有 expected fail、16 项 backend skip、1 项 frontend skip 保留。机器记录见 [account-concurrency-verification.json](./account-concurrency-verification.json)，完整日志为 `output/account-concurrency-*.log`。

```powershell
$env:CHANGMEN_TEST_PG_BIN = 'D:\PostgreSQL\18\bin'
npm run test:account-concurrency:postgres
```

## 上一轮修复验收（历史记录）

日期：2026-10-15。修复本对话复核中的 5 个问题及心跳测试隔离风险；仅保留本地工作区改动，未部署生产。

| 问题 | 修复方式 | 验证 |
| --- | --- | --- |
| R4：旧 ACCOUNT 覆盖新余额 | 配置保存从锁定的 players 行保留最新余额；在事务内比较持久字段，重复保存跳过 player UPDATE；校验和显式 prune 保留 | 余额 123 保持；改 token 仍保持余额；无变更时用拒绝 UPDATE 的触发器证明不写 player |
| R1：报错前部分提交 | 默认批量入口自行开启事务，行数检查在 COMMIT 前完成；已有事务调用继续复用 client | 缺失账号导致整批回滚；原有失败注入回归通过 |
| R2：局部保存丢更新 | 体育账号、通用余额、PM/PF 同步及管理端局部修改在 owner 锁内读当前值并合并；不 prune、不 UPDATE 无关账号；DB 旧 patch 入口也走锁内读改写 | 并发双账号 token、同账号不同字段、实际体育保存请求、无关行拒写触发器、失败后队列恢复 |
| R3：旧 profile 读取覆盖配置 | 单用户 profile 读取与配置写入共用队列；批量刷新重新读取最新行后发布 | 延迟旧读取、并发配置提交、后续 patch 后 base/saved/next 均保留 |
| R5：冷启动查库失败返回空成功 | 没有可信快照和旧投影时抛出明确错误，由既有路由 fail envelope 处理；DB 确认空仍返回空列表；有旧列表时保留原故障兜底 | 冷启动故障、恢复为空、已有快照降级的回归测试 |
| 心跳测试覆盖真实文件 | Vitest / NODE_ENV=test 自动使用各模块实例独有的临时目录，退出清理；正常运行仍使用原仓库心跳位置 | matcher 测试验证临时目录，既有单写守卫测试通过 |

锁内事务在写完后重新读取实际行，COMMIT 成功后才交给缓存发布，避免 SQL 的 PredictFun 余额保护使“计划写入值”与实际数据库值不同。
内部局部修改均已改用 mutate/update，旧完整列表替换助手仅保留兼容语义，不能用于基于旧快照的局部修改。
完整 ACCOUNT 请求本身仍表示完整保存；不把两个客户端的完整保存猜测为字段补丁。

## A8 保护范围

[changmen 扩展] 本轮修复位于服务端持久化、缓存协调及测试层。
未修改前端、插件、场馆运行源码，未减少 ACCOUNT 保存请求，未增加空列表或预览 skip，未改变 load/persist/余额刷新/save 的客户端时序。
空列表覆盖和外部账号拒绝、显式删除 prune、PredictFun 账本保护均有回归场景。
`Client_GetMatchs` 的失败继续使用现有错误 envelope；成功形状、采集上报门控、合场算法和定时参数保持原实现。
FOK 精确保护、基线及冻结清单未改动。

## 本地验证结果

- `npm test -- --force`：14 个任务通过，未使用任务缓存。backend 694 项通过、16 项既有跳过；DB 359 项通过；matcher 188 项通过；前端 3938 项通过、1 项既有跳过。另有各 workspace 的 Node 和 adapter 检查通过。
- `npm run test:review-fixes:postgres`：12 个新增真实 PostgreSQL 场景通过。
- 第一阶段 PostgreSQL 12 场景、第二阶段 PostgreSQL/HTTP 12 场景均回归通过，共 36 个数据库相关场景。
- `npm run typecheck:frontend`、backend `compile:router` 及 `check:fok-parity` 通过。
- FOK 保留 180 项对比、20 个确认故障场景、45 个原门控场景；`fullReleaseAccepted` 仍为 false，本轮不表示生产发布验收。

resolver 既有反向匹配 expected fail 未修改。F10/F11 的全局采集重试、排空及 readiness 仍为后续范围，本次没有扩大到这些架构变更。

机器结果见 [review-fixes-verification.json](./review-fixes-verification.json)，原始本地日志为 `output/review-fix-*.log`。
复跑新增数据库验证：

```powershell
$env:CHANGMEN_TEST_PG_BIN = 'D:\PostgreSQL\18\bin'
npm run test:review-fixes:postgres
```

历史 `output/conversation-review-20261015/reproduce.mjs` 断言的是缺陷行为，修复后其旧断言预期失败；当前验收使用上面的正式回归入口。
