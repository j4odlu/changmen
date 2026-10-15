# changmen 第一阶段修复与本地验收

最新状态：复核发现的问题已完成服务端修复及回归，见 [复核修复验收](./REVIEW_FIXES_LOCAL_ACCEPTANCE.md)。下述复核更正保留为历史过程。

复核更正：后续发现余额覆盖回归及未覆盖的批量事务、账号并发、profile 读写竞态，已在本地复现；详见 [本对话实施复核](./CONVERSATION_REVIEW.md)。下文保留当时实现与测试结果，不代表问题已全部修复。

日期：2026 年 10 月 15 日。对应原审计 F01 至 F05。修复保留在工作区；未提交、推送或部署，未连接生产 RDS。

## 完成的修复

| 问题 | 当前行为 | 主要实现 |
| --- | --- | --- |
| 账号写入确认 | 普通 SQL 异常向上抛出；更新行数不足视为失败；成功确认后才更新缓存 | [player_store.js](../../../server/db/rds/player_store.js)、[store.js](../../../server/backend/core/db/store.js) |
| ACCOUNT 保存事务 | 锁定用户 profile 与本人活跃 players，读取 RDS 当前状态，在同一事务内校验归属、保护既有字段、写入和 prune；失败全部回滚 | [account_service.js](../../../server/backend/core/account/account_service.js)、[player_ownership.js](../../../server/backend/core/account/player_ownership.js) |
| 同用户并发保存 | 进程内队列协调提交与缓存发布；数据库用户行锁约束并发事务，包括本人账号为空的情况 | [user_write_queue.js](../../../server/backend/core/db/user_write_queue.js) |
| 配置失败回滚竞态 | 同用户的 UpdateSetting、USERCONFIG、CollectConfig 和其它 KV 写入共用配置队列；失败不发布缓存，不再恢复整行旧快照 | [store.js](../../../server/backend/core/db/store.js)、[profile_store.js](../../../server/db/rds/profile_store.js) |
| 未等待的账号同步 | 两处后端余额同步现在等待账号写入，失败进入既有错误处理；使用独立数组，避免提前修改缓存 | [PM handler](../../../server/backend/core/integrations/polymarket/pm_client_handlers.js)、[account_service.js](../../../server/backend/core/account/account_service.js) |
| 漏执行迁移 | 显式清单包含 034、039 及两个订单观察迁移；共 42 项；002 为已弃用 no-op，明确排除 | [apply-rds-schema.mjs](../../../server/backend/scripts/apply-rds-schema.mjs) |
| 迁移执行可靠性 | 会话级 advisory lock 覆盖整份清单；每项 DDL 与执行记录同事务；重复执行跳过已完成项；历史内容校验和变动时失败 | [rds-migrations.mjs](../../../server/backend/scripts/rds-migrations.mjs) |
| 默认测试漏跑 | DB workspace 有了 test 任务；backend 加入 core/account、core/db、迁移测试；纯 Node 文件单独运行；修复一项依赖仓库根 cwd 的 GTC 测试路径 | 两包 package.json 与 Vitest 配置 |
| 测试环境与缓存 | 新接入的 backend/DB 测试使用临时 storage 和不可用的回环数据库地址；Turbo 将测试环境脚本纳入 test 输入 | [offline-env.mjs](../../../scripts/testing/offline-env.mjs)、[turbo.json](../../../turbo.json) |

后端数据入口原有精确保护未修改。事务通过已有 `saveAccountRecordsForOwner` 的显式 `replaceWith` 选项进入，没有改动受保护的 `server/db/index.js` 或订单实现，也没有放宽保护基线。

## A8 行为保护

`[A8 可证实]` 前端 ACCOUNT 的加载、整包保存和余额刷新后的保存调用保持原代码；没有添加空列表、管理预览或其它前端 skip。

`[A8 可证实]` 采集开关只控制上报的语义、请求字段、调用顺序、下注与拒单补单时序均未修改。本次没有修改 `client/web`、`chrome-extension`、`client-core` 或场馆 adapter 的运行代码。工作区原有的 PM README 改动不是本阶段变更。

后端成功响应现在以事务提交或数据库确认作为前提，响应耗时可能包含更多数据库等待；这不改变客户端发起和等待请求的代码顺序。现有空覆盖、归属、场馆 provider、token、省略字段、体育 token 与 PF 账本保护继续保留。

## 本地 PostgreSQL 集成验证

命令：`npm run test:phase1:postgres`。

[验证脚本](../../../scripts/testing/phase1-postgres.mjs) 使用本机 PostgreSQL 18.6 创建独立临时集群，只监听 `127.0.0.1` 的临时端口。初始化、查询和应用模块的所有数据库地址均指向这个集群；结束时停止集群并清理本轮目录。无需使用项目现有数据库配置。

12 组场景全部通过：

1. 两个客户端并发初始化空库，42 项迁移只执行一轮；再次执行无待运行迁移。
2. 旧库缺少 034、039 且没有执行记录时可升级，原有账号数据保留，新增字段实际可读写。
3. 并发迁移只执行一次；已执行迁移的内容发生变化时拒绝继续。
4. 迁移中途 SQL 失败时，DDL 与成功记录一起回滚。
5. 注入 prune 错误，先前的账号 UPDATE 回滚，缓存与未删除账号保持原状。
6. 注入账号写入错误，不返回成功、不更新缓存、不清理其它账号。
7. 既有账号被空数组覆盖、使用其它用户的 player 被拒绝；真正无账号用户仍可提交空数组。
8. 原 ACCOUNT JSON 保存入口成功提交更新与 prune；省略 token 时保留数据库已有值。
9. UPDATE 行数不足时，整个替换事务回滚。
10. 绕过进程内队列的两个数据库事务仍由用户行锁串行读取和提交。
11. 缺少目标 profile 时，配置保存失败且不生成新缓存。
12. 配置失败请求与随后成功请求并发进入时，数据库和缓存仅保留成功状态，失败字段不污染后续写入。

## 其它验证结果

| 命令或范围 | 结果 |
| --- | --- |
| `npm run test:backend` | 12 个 Turbo 任务成功，最终一轮 9 个任务复用缓存、3 个实际执行；此前首轮 12 个任务均实际执行 |
| backend Vitest | 681 项通过，16 项既有的专用登录 PostgreSQL 集成测试未启用；另有 2 个 Node 测试及 adapter layout 检查通过 |
| DB workspace | 352 项 Vitest 测试及 3 个 Node 冒烟通过，已接入总测试 |
| matcher | 188 项通过，未改匹配算法 |
| resolver | 6 项离线断言通过、1 项预期失败登记既有缺口；体育队名 Node 冒烟通过 |
| 前端选定回归 | 21 个文件、187 项测试通过，覆盖 collect、odds、account、主循环和部分双腿执行阶段 |
| `npm run typecheck:frontend` | 通过 |
| `npm run compile:router --workspace=@changmen/backend` | 通过 |
| `npm run check:fok-parity` | 原始保护通过：40 个核心文件、29 个 PM 函数体、18 个执行场景；后续 180 次对比、20 个确认故障场景及 45 个原门控场景通过，GTC 隔离检查通过 |
| `npm run test:checks` | 团队边界、exports、冻结面、client-core、URL 契约及 23 步 catalog 冒烟通过 |
| `git diff --check` 指定本阶段代码范围 | 通过 |

前端回归命令与原审计的选定测试相同。没有进行生产构建、真实下注、生产数据库迁移或生产重启；上述结果不作为生产发布验收，FOK 输出的 `fullReleaseAccepted` 仍为 false。

## 保留的限制

- 本阶段的事务与队列保证保存动作原子完成，不会自动识别另一个标签页提交的旧完整 ACCOUNT 快照。跨标签页业务冲突策略仍需单独设计。
- 原 resolver 的 `test.js` 会访问 PandaScore/Liquipedia 并更新本地缓存，部分失败只打印。它现在保留为显式 `probe:live`，默认 test 改为模拟 provider 的离线断言。首次总测试调用过旧诊断；后续默认测试已不再依赖外部解析服务。
- 新的 resolver 离线断言发现旧 `scoreMatchPair` 的交叉腿比较有缺口，反向队伍未被正确识别；使用 `it.fails` 明确登记。运行算法未改，留待合场阶段处理，不能把该场景计为功能正常。
- 原审计的 5 条前端分层违规、matcher 反向引用 backend、列表缓存与异步采集队列等后续阶段项目仍保留。没有通过忽略检查来宣称这些问题已修复。
- 初次临时 PostgreSQL 启动测试留下的旧目录 `C:\Users\mints\AppData\Local\Temp\changmen-phase1-pg-HcoPiI`，其清理被自动审批检查拦截，未提供具体原因；对应进程已停止。后续集群启动方式已修正，各轮测试集群正常停止并清理。

原 [evidence.json](./evidence.json) 保留审计当时的状态；`audit.mjs` 的两个缺陷复现已固定到审计基准提交，以免把当前修复后的代码当作旧缺陷重放。当前状态以本阶段测试及 [phase1-verification.json](./phase1-verification.json) 为准。
