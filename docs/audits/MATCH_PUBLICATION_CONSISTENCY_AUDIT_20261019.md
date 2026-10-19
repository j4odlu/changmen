# Matcher 与用户比赛发布一致性审计

[changmen 扩展] 2026-10-19，Asia/Taipei。方案见 [比赛发布一致性方案](../MATCH_PUBLICATION_CONSISTENCY_PLAN.md)。范围为电竞采集持久化、compose 管线、用户接口、matcher 页面、版本缓存、前端行情及订单消费边界。仅新增文档、保存本地审计证据和运行离线检查；没有改业务源码、执行实际合场、下单、数据库 DML、重启或部署。

## 结论

**现有用户接口与 matcher 的可见性契约不相同，且来源缺失的处理同时牵涉发布、比赛结束和订单清理。** 当前方案收敛为公共读取入口的小范围过滤修复，并保留必要的订单兼容回归；不将本报告发现的全部问题都设为架构改造或本次修复的前置条件。

本报告的事实与风险评级保留。用户观察到差异偶发，当前[三步方案](../MATCH_PUBLICATION_CONSISTENCY_PLAN.md)替代此前七步方案；F3/F7 失败语义缺陷单独安排，读取新分支自身仍必须正确区分失败与可信空快照。本次方案修订没有新增运行验证。

发现三项 P1 与四项 P2。P1 表示应优先处理的业务正确性风险；本轮没有证据证明读取异常已在生产造成误结束、误清理订单或真实错误下注。

| 编号 | 优先级 | 发现 | 证据 |
| --- | --- | --- | --- |
| F1 | P1 | active gap 不刷新旧挂载和旧盘口，失效源仍可能被用户引用 | 原 #8189 历史实查、当前 #8208 快照、离线管线复现 |
| F2 | P2 | matcher 隐藏零来源场，用户按未结束记录下发；开赛时间门延长差异 | 当前 RDS 快照、真实 UI 函数、05:33 收尾复查 |
| F3 | P1 | 平台读取失败返回空对象，可进入来源全失与结束写入分支 | 真实 DAL/loader 函数体的依赖替换复现、纯函数结束补丁与空写保护 |
| F4 | P2 | live 单馆保留规则在聚类前置门槛下不能覆盖所有来源缺失情况 | 真正 cluster 与 shape 函数的组合复现 |
| F5 | P2 | 合场行版本不覆盖独立平台变化，且多表读取不原子、客户端无比赛版本协议 | 缓存、DAL SQL、loader、宿主端口及 API 源码 |
| F6 | P2 | 来源缺失借用 ended 生命周期后，来源恢复可能创建新比赛身份 | #8189 / #8194 数据与 ended 排除规则；无恢复轨迹重放 |
| F7 | P1 | 用户接口业务失败被转换为成功空列表，可能误触发补单队列清理 | 真实 API 函数复现、store 与主循环及 removeOrders 源码 |

## 取证范围与当前数据

本机基线 HEAD 为 `eace38d64a1cd6927a67040a63a3d097771950ba`，工作目录为 `E:\River\arb\changmen`。通过 `@changmen/db` 连接本机配置指向的外网 RDS；事务为 `REPEATABLE READ READ ONLY`，确认 `transaction_read_only=on`，结束使用 ROLLBACK。没有核对远端当前运行源码与此 HEAD 的逐文件一致性；源码风险以本机版本为依据。

05:32:47 的一次一致性读取结果：

| 数据项 | 数值 |
| --- | ---: |
| `ended_at IS NULL` 的合场记录 | 4 |
| 按当前 matcher 业务可见条件筛选 | 3 |
| 全部挂载均不存在于活跃平台表的合场 | 1 |
| 仅一个当前来源的合场 | 0 |
| 缺失的平台挂载 | 2 |
| 缺失来源仍保留的地图平台 Source 行 | 6 |
| 其中 `Status=Normal` | 5 |
| active 合场重复占用相同平台场次 | 0 |
| 现存来源 `match_id` 与 active 合场归属冲突 | 0 |
| Source 平台在其合场 `Matchs` 中无挂载 | 0 |

“4 对 3”是从同一 RDS 事务重算服务端下发范围与 matcher 业务可见条件，未包含页面搜索、ID/队名分类、个人赛前筛选或网络缓存，不是两台浏览器同时截取的请求包。

四场分别为 #8194 FURIA vs BB Team、#8202 salamit vs Power Rangers、#8208 Team Cobra vs New Growth、#8209 Procyon Team vs your end。#8208 的两个来源均已移入历史表；旧合场仍含 OB 四个地图 Source、RAY 两个地图 Source，其中仅 OB 全场盘状态为 Locked，其余五行为 Normal。界面的实时锁定状态另取浏览器缓存，不能直接把数据库 Normal 当成真实可下注证明。

05:35:05 的独立只读复查：#8208 的 `ended_at` 已是 05:33:01.418，active 数为 3。系统自动结束发生在本轮观察期间，未由审计写入触发；它符合 05:30 计划开赛加三分钟时间门，不表示所有来源缺失问题已解决。

## F1 未合出的活跃行绕过失效盘口清理

入口为 `compose/cluster/merge_clusters.js:135` 的既有行种子；剩余来源不足两馆时跳过。`pipeline.js:170` 再次要求至少两馆，失效平台的 `project_sources.js:203` / `live_shape.js:56` 清理只作用于进入本轮处理的行。

`compose_once.js:31` 的 `resolveComposeEndPatch` 将未处理且未结束的 ID 记入 `activeGaps`。`io/write.js:41` 只提交当前 activeRows、endedRows 和显式 markEndedIds；`client_matches_store.js:149` 不会顺带重写 gap 的 matchs、bets、reverse。因此保留的是整份旧记录，不只是身份。

用户 `store.js:535` 及 `core/db/store.js:346` 原样投影该记录的 Matchs、Bets、Reverse。`ViewBetItem` 从 Sources 构建盘口，之后按 oddId 从浏览器缓存读取赔率。赔率缓存一小时清理、盘口锁盘推送以及场馆实际预检不能替代发布有效性判定。

离线复现：仅剩 RAY 的既有两馆赛事，`clusterCount=0`、`writeRows=0`、`activeGaps=[42]`；单独对同一结构调用 `stripOrphanPlatforms` 可以清除 OB，证明清理能力已有，但 gap 没有走到该步骤。

建议保留身份关系，同时为所有未合出的既有活跃身份生成明确的发布投影。只修改 strip 函数或赔率缓存无法覆盖该入口。

## F2 两端筛选不同并受开赛时间门影响

用户 DB 读取以 `client_matches_store.js:188` 的 `ended_at IS NULL` 为准。matcher UI `public/index.html:801` 额外要求：至少两个历史挂载，且当前至少一个来源仍存在。`matcher_data.js:58` 也有相同类型的筛选，用于挂靠和推荐计算。

#8208 全部来源消失后 UI 先隐藏；`resolveComposeEndPatch` 只有在 `startMs <= now - 180000` 且全部来源缺失时才提交结束。在 05:32:47 快照中仍未达到 05:33 门槛，用户接口范围因此多一场。

建议把发布暂停与真实结束分开；matcher 已发布视图与用户接口共享发布集合，运维待恢复区域仍展示原记录。用户个人筛选和 matcher 的 ID/队名分类必须单独说明，不能把分类栏计数直接当成完整已发布数量。

## F3 平台查询失败会被当作真实空快照

`platform_collector_store.js:955` 的 `fetchPlatformMatches` 捕获查询错误后返回 `{}`，`fetchPlatformBets` 和 `fetchLiveTimers` 也返回空对象。`compose/io/snapshot.js:116` 顺序读取这些结果，没有携带成功标记；只对 lifecycleSnapshot 缺失抛错。

matcher UI 的 `ops/rds_snapshot_cache.js:143` 对 meta 非空而数据假空有保护，但自动写合场使用的是 `compose/io/snapshot.js`，不经过该 readCached 保护。不能据 UI 缓存防护推断写链同样安全。

通过真实函数体、模拟查询失败和模拟可读取的生命周期依赖，得到：DAL 返回 `{}`；loader 接受零平台与一条旧身份；旧场已超过开赛时间门时 `markEndedIds=[42]`；`shouldAllowEmptyWrite` 返回 `{ok:true,reason:"all_sources_gone_covered"}`。即单次平台查询失败后其它读取与后续写库仍可用时，风险链路能够通过现有保护。没有执行该结束补丁或实际写库。

建议查询失败显式传播为不可信快照并中断状态推进，不能生成来源消失或结束补丁；正常成功空结果仍按业务规则处理。平台表、盘口表、计时表要分别明确失败语义。

## F4 进行中单馆保留存在前置门槛

`live_shape.js:123` 允许 `Round>0` 且剩一个平台的行保留，但 `merge_clusters.js:157` 的 seed 和 `pipeline.js:170` 在进入结构与展示处理前就要求两馆。

离线复现给既有赛事设置 round=2，当前快照仅保留一个来源并提供计时：cluster 输出 0；同一类单馆 live 行直接送入 filterMultiPlatform 输出 1。人工 bindings 等其它路径可能重建两挂载再进入 strip，因此不能称全部单馆路径必失败；可以确认后置例外不足以覆盖普通 seed 来源缺失。

完整修复该问题时必须从真实 cluster 入口贯穿验证，不能只测 shape 函数。当前小范围方案不重写 cluster，只从已有活跃合场记录统一过滤来源并保留单馆展示；这一读取修复不等于前置聚类门槛已被修复。

## F5 现有版本保护不等于发布版本一致

已有正确机制：client_matches 的行与 xmin 派生版本在同一 SQL 中读取；versioned cache 对 generation 失效隔离、并发合并、空快照与复制都有回归。提交后先失效，再经宿主端口刷新内存。本轮相应测试通过，应复用。

现有不足：

- `CLIENT_MATCH_META_SQL` 只覆盖 client_matches；平台删除但旧合场行不更新时，业务发布资格变了，合场版本可以不变。
- composer 顺序读取平台比赛、盘口、计时、生命周期、绑定与 override；UI 使用部分并行读取，均不是同一个跨表事务快照。
- 内部 `clientMatchVersion` 未作为比赛版本协议提供给用户。`core/matcher/runtime.js:11` 的提交回调仅调用宿主内存重载，不是浏览器比赛列表推送；用户主要靠 30 秒轮询更新。
- UI 根据平台存活和映射重新分类，用户接口还附加 PmPrematch。应比较同版核心集合与引用，不应要求页面文案、参考价、比分和本机实时行情逐字相同。

建议发布版本覆盖真正改变发布投影的来源变化，定义跨表一致性边界，并在现有机制上增加兼容元数据及通知。此项是设计缺口；本轮没有并发写入制造跨表撕裂。

## F6 用结束代替暂停影响身份恢复

当前 ended 为 sticky；`compose/ids/resolve_ids.js:18` 排除已结束行的身份复用，pipeline 也清掉指向 ended 的临时链接，避免真实下一场比赛粘旧 ID。这种保护本身合理。

但用来源消失兜底触发 ended 后，相同平台场次恢复便可能换 ID。当前数据同时保留 ended 的 #8189 与 active 的 #8194，两者都挂 OB `6672562986409554`、PM `1207558`；#8194 还新增 PB/RAY，开赛时间也有变化。该数据和源码支持身份更替风险，未逐拍重放，因此不把全部更替原因归于单一分支，也不能按队伍对强行合并两条记录。

建议暂停发布保留原身份；真实 ended 仍保持 sticky 和跨场防复用规则。验收来源恢复时的 ID、投注行 ID、人工反转与订单归属，不能批量恢复已结束比赛。

## F7 业务失败被用户 API 转换为成功空列表

`api/client.ts:29` 的 post 在 HTTP 请求成功时会返回业务 envelope，包括 `success=0`。`api/match.ts:63` 对非 success=1 或非数组 info 返回 `[]`。后端路由捕获异常也会通过 HTTP 200 返回 fail，故这不是只能构造出的网络层情况。

`matchStore.ts:225` 接收到数组后替换 matchs、推进 lastFetchAt 并返回 true。`mainBetLoop.ts:35` 随后走成功分支，执行 oddsStore.clean；若六十秒清理门控已到，调用 `loseOrderStore.removeOrders([])`。该函数删除不在活跃盘口集合且无 pendingVenueOrderId / pendingRegularReceipt 的队列条目；有关 linkId 的自动卖出扩展也可能随后被触发。

依赖替换运行实际 getMatchs 函数，`success=0,info=null` 确实变成 `[]`。现有主循环“拉取失败早退”单测直接 mock fetchMatches=false，没有覆盖真实 API 将失败包装成数组的链路。网络异常会抛错，不能说所有失败都会清空；真实成功空数组仍应允许。

建议先保持失败语义贯穿 API/store，再设计发布暂停与已有订单处理的关系。单纯修复列表过滤可能扩大 activeBetIds 的缩减范围，必须审查补单、待确认、补绑和自动卖出，而不是给经典 FOK 加新的拒单门控。

## 行情 参考赔率与采集边界

- OB、PB、RAY 空快照有 sticky 保护，缺席来源在五分钟宽限后才 orphan；PM 空批次不直接清空，显式 prune 有独立语义。不能把“当前平台请求没看到”直接替代“已确认来源失效”。本轮没有重放每个 collector 的外部响应或宣称所有平台快照完整性已获证明。
- RDS 有未对应当前平台赛事的历史盘口行：OB 9,238、PB 3,767、RAY 6,154。这是全表聚合，不等于用户曝光量；当前活跃合场确实引用缺失来源的只有上述六个地图平台 Source。compose 对正常处理行先确认平台源存在，不能仅据 orphan 总量判定全面泄露或直接删除。
- `oddsStore.getOdds` 不查询 matcher 存活状态；全局 clean 按一小时过期处理。它服务多个消费者，不能以整馆清空替代按比赛的发布投影。
- BetRow 红色参考赔率来自 defaultOdds/InitialOdds；PM PmPrematch 来自存储附加行情；二者不能证明当前场馆可成交。展示层应明确区别于执行行情。
- 自动候选遍历 matchStore 的赛事对象，手动金额弹窗跨 await 持有旧 match/bet/item；替换列表并不撤回所有已持有对象。是否更新旧展示、何时进入执行、提交后继续确认，必须分别验收；本轮未操作真实弹窗或提交订单。

## 验证结果与证据

本地输出目录为 `output/match-publication-audit-20261019/`，由 gitignore 排除，不包含凭据、账号或订单内容。报告中的核心结果已写入本文件，不依赖该临时目录才可理解。

| 检查 | 结果 | 文件 |
| --- | --- | --- |
| matcher 管线、UI、snapshot 回归 | 31 文件、169 项通过 | matcher-tests.log |
| DB 缓存、生命周期、sticky、API 契约与附加行情 | 6 文件、63 项通过 | contracts-tests.log |
| 前端主循环、比赛索引、BetTarget、赔率缓存与 PM 取价 | 7 文件、42 项通过 | frontend-tests.log |
| 新增离线契约探针 | 12 个断言场景通过；只存本地证据，不加入正式业务测试目录 | contract-probe.mjs / .json / .log |
| 客户端与服务端边界 | 通过；工具仍保留既有发布范围未认证提示 | boundaries.log |
| 经典 FOK 等价验证 | passed=true；180 comparisons，49 个函数在 FOK 输入下相同 | fok-parity.log |
| VPS FOK 固定保护 | 551/551；包含 shared boundaries、GTC isolation，未修改基线 | fok-vps.log |
| RDS 一致性读取与独立复查 | READ ONLY，ROLLBACK | db-audit.mjs、db-snapshot.json、db-followup.json |

合计 44 个现有测试文件、274 项通过。通过说明现有局部行为未变，不表示本次发现已经修复。未修改前端，因此未以本轮运行替代或声称完成前端类型构建。没有执行浏览器同版 E2E、真实下注、持续采集故障注入、生产 DML、实际合场写入或发布；FOK 工具自身 `fullReleaseAccepted=false`，不能将固定检查通过当成发布验收。

## 当前修复范围与实施顺序

当前采用三步小范围方案：先提取统一规则并离线验证，再接入用户接口与 matcher 已合场列表并完成必要兼容回归，最后有限实查。每步完成后可停；第二步完成即具备主要修复效果，第三步用于确认收尾，不默认扩展架构。

读取时清理失效来源、盘口和相关 Reverse 副本项；至少一个来源仍存活的既有合场继续显示，零来源两端均隐藏。matcher 可保留原始失效挂载作运维诊断。保持数据库身份、写入算法、现有三分钟结束兜底及经典 FOK 语义，不新增发布状态机、持久化快照或通知协议。

当前范围不承诺来源恢复后一定复用已 ended 的原 ID；F6 仍独立存在。F4 的聚类门槛、F3/F7 的全链路失败处理、新版本协议与跨表原子发布均保留为独立议题。新读取分支不能按假空快照过滤，且列表减少的订单兼容回归仍为接入必需，不能以缩小范围为由省略。

过去七步方案中“改变来源缺失的结束语义、保证恢复原 ID”的设计不再是当前实施要求。该收缩来自用户对偶发差异和改造规模的判断，审计事实与既有测试记录没有因此被撤销或重跑。本轮仍只更新文档，不执行业务修复。
