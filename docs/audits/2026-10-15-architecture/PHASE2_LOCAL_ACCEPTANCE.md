# 第二阶段：matcher 边界与列表快照本地验收

最新状态：冷启动错误语义及本次复核问题已完成修复和回归，见 [复核修复验收](./REVIEW_FIXES_LOCAL_ACCEPTANCE.md)。下述复核更正保留为历史过程。

复核更正：列表冷启动失败仍会在 HTTP 上层转换成成功空列表，另有第一阶段回归及测试隔离风险；详见 [本对话实施复核](./CONVERSATION_REVIEW.md)。下文保留当时测试结果。

日期：2026-10-15。落实本轮指定的 matcher/backend 依赖隔离及列表快照统一，对应原审计 F06、F09。
代码保留在当前工作区；未部署、未重启生产进程、未连接生产数据库。

## 实现结果

matcher 的运行源码已移除对 backend 的静态及动态导入。`runtime_ports.js` 只定义宿主端口和内嵌运行标志，
backend 的 `core/matcher/runtime.js` 在采集 store 构造后注入采集读写、提交发布、强制结束的缓存移除及鉴权。
面板的身份、权限、浏览器会话、证书和 CSRF 实现归属 backend；matcher 中间件保留原校验顺序。
未安装宿主鉴权时拒绝访问。`npm run matcher:ui` 经 backend 的明确启动脚本装配，独立合场计算不再隐式加载 backend。
`check:boundaries` 新增禁止 matcher 导入 backend 的规则。

backend 列表和 matcher 面板共用 `@changmen/db/client_match_snapshot.js`。
数据库一次 MVCC 语句读取完整行及版本，避免“行来自 A、版本来自 B”。版本使用按 ID 排序的行 ID 和 PostgreSQL
`xmin` 指纹，覆盖同一 built_at、同一行数下的人工反转、PM 附加状态和行替换；只判断相等，不当作递增编号。
bigint 保留 pg 原有字符串解码，不通过 JSON 聚合损失精度。

缓存合并并发刷新，明确缓存空列表，并在失效时递增进程内代次。
较早的读取在数据库查询期间或结果交付前遇到失效，都会重新读取，不能把旧数据重新发布。
各调用方获得独立数据副本。读取失败保留最后确认结果；失效后没有可信快照时，快照层返回 null。
复核确认：backend 冷启动无旧投影时仍将此 null 转成成功空列表，这一端到端失败语义尚未修复。
backend 可返回已有线协议投影作为故障兜底；matcher 没有可信列表时中止该次读取。

合场生命周期需要已结束赛事的身份，不能拿活跃列表代替。
`compose/io/snapshot.js` 改为一次 `fetchClientMatchesAll({ snapshot: true })`，身份锁、PM 状态和 align 使用同一批完整行，
查询失败直接中止合场，不再降级到缺失 gb/PM 字段的精简行。此视图标记 scope=all，与活跃列表版本的适用范围区分。
采集表、赔率和计时仍遵循原有读取方式；本轮没有将所有表宣称为一个全局数据库事务快照。

合场写事务成功后只做一次宿主发布和一次采集关联补丁，清除原先 compose 与 matchMerge 的重复发布。
发布读取数据库实际存续的活跃行，不直接把计算结果数组当作持久化快照，因而保留独立 PM 状态、sticky ended 以及本拍未合出但仍活跃的赛事。
写失败不发布、不修补采集关联。移除 backend 中已无调用的旧列表保存、孤儿清理和直接内存发布助手。

## A8 行为保护

[changmen 扩展] 以上运行时端口、RDS 版本与缓存代次均为 changmen 服务端内部实现。
本轮未修改前端、插件或场馆运行源码，未修改 HTTP action、参数、响应协议、账号保存顺序及采集开关语义。
`Client_GetMatchs` 仍只读列表；原合场纯计算、ID、主客投影、生命周期写规则、单写守卫、30 秒循环及
SaveLiveTimer 默认 3 秒 debounce 均保留。

未修改 FOK 精确保护脚本、基线或冻结清单。`server/backend/server.js`、`server/db/index.js`、`impl_rds.js`
保持原文件内容；新 DB 能力通过包的明确子路径及现有读取方法的可选参数接入。

## 本地验证

| 验证 | 结果 |
| --- | --- |
| 根目录 `npm test -- --force` | 所有 14 个任务实际执行通过；前端 3938 项通过、1 项原有跳过 |
| backend | 692 项通过、16 项原有专用数据库集成测试跳过，另有 Node/adapter 检查通过 |
| DB | 359 项 Vitest 通过，另有 3 个 Node smoke 通过 |
| matcher | 37 个文件、187 项通过，包含快照失败中止和宿主鉴权分支 |
| `npm run typecheck:frontend` | vue-tsc 通过 |
| backend `compile:router` | 通过 |
| `npm run check:fok-parity` | 通过；180 项对比、20 个确认故障场景、45 个原门控场景，GTC 隔离通过 |
| `npm run test:phase2:postgres` | 临时 PostgreSQL 18.6，12 个真实数据库/本机 HTTP 场景通过 |

数据库验证脚本只创建自行持有的临时集群，绑定 127.0.0.1、随机端口；在导入应用前覆盖所有数据库地址及 storage 目录。
场景包括空列表版本、完整字段与 bigint、人工反转、PM 非最大时间戳更新、内嵌/独立视图一致、提交后发布、失败回滚、
sticky ended、防复活、完整生命周期与关联同批读取、删至空列表、新进程重载及本机 HTTP 未登录返回 401。
缓存单元测试另覆盖并发合并、两段失效竞态、失败恢复、数据副本隔离和年龄兜底刷新。

resolver 原有反向匹配缺陷继续以 1 项 expected fail 记录，本轮未修改算法。
上述通过表示本地回归通过；FOK 检查的 `fullReleaseAccepted` 仍为 false，没有进行生产发布验收或真实场馆端到端操作。
原审计 F10/F11 的采集队列重试、限时排空及统一 readiness 属于后续批次，本轮没有改变 SaveMatch/SaveBet 的接受语义或停机策略。

## 复跑

```powershell
$env:DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline'
$env:DATABASE_URL_PUBLIC = ''
$env:DATABASE_URL_INTERNAL = ''
npm test -- --force
npm run typecheck:frontend
npm run compile:router --workspace=@changmen/backend
npm run check:fok-parity
$env:CHANGMEN_TEST_PG_BIN = 'D:\PostgreSQL\18\bin'
$env:MATCHER_SKIP_AUTH = '0'
npm run test:phase2:postgres
```

机器摘要见 [phase2-verification.json](./phase2-verification.json)；原始日志保存在本机 `output/phase2-*.log`。
