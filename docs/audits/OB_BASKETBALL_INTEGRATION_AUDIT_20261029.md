# OB 篮球接入审计

[changmen 扩展] 2026-10-29。审计对象：[OB 篮球接入方案](../OB_BASKETBALL_INTEGRATION_PLAN.md)与本机 `master` 当前源码。基线提交为 `abf94feb94519319c98d52d17ab7d8c5d63e8d92`，工作区含原有未提交与未跟踪内容；56 个关键源码文件的实际字节哈希见 [source_manifest.json](2026-10-29-ob-basketball/source_manifest.json)。这是方案及现状审计，不是新接入代码的发布验收。

## 审计结论

OB 体育试玩可提供篮球赛程、全场独赢和实时推送，继续使用平台 `OB` 接入现有电竞篮球分类在结构上可行。现代码不能仅通过增加 catalog 配置或拼接 SaveMatch 列表完成接入。

共登记 18 项接入风险，其中 P1 为 12 项、P2 为 6 项。这里的优先级表示实施该集成时的影响，不表示现网已经发生这些故障。全部风险已纳入方案的处理与验收范围，但尚未通过代码修复；生产上线条件仍未满足。

方案已据审计修订：保留 `provider=OB` 和原 action；增加按来源隔离的快照契约、客户端能力投影和可逆体育 ID；完整交易包含独立钱包与订单路径。旧独立体育篮球产品线退役，PM 篮球官方状态流等共享能力保留。

## 范围与证据

| 审计层 | 已核对内容 |
| --- | --- |
| 外部协议 | 试玩登录形状、官方版本、篮球菜单、赛程袋、底价/详情、双向独赢、WS 压缩/状态/比分、官方结算规则 |
| 接入与契约 | registry、OB collector、CollectConfig、SaveMatch/SaveBet 裁剪、zod request、router、来源 ID |
| 存储 | OB 内存快照、五分钟 sticky、盘口孤儿、RDS 同 key 写队列、orphan SQL、重启读取及字符串列 |
| 身份与合场 | game catalog、队伍 ID、native_bets 过滤、主客方向、BO/timer、两馆门槛、PM 与非 PM 终态 |
| 客户端行情 | 本机 fo、Sources 回退、足球 WS 默认订阅、足球解析、缓存清理/覆盖顺序、生命周期 |
| 执行 | provider、验盘/提交、体育凭证、资金筛选、余额刷新、订单同步、恢复与共享双腿链路 |
| 退役与交付 | 旧篮球 UI/API/catalog/line、共享 PM 状态、listener 路由基线、源码边界、兼容发布与回滚 |

外部样本取自本会话前段 2026-10-29 的只读 HTTP/WS 调研，经过字段筛选后保存为 [upstream_samples.json](2026-10-29-ob-basketball/upstream_samples.json)。此轮审计复用同日证据，没有把样本记录时间写成正式比赛或发布验收时间。样本不含登录 token、Cookie、ACCOUNT、请求鉴权头或下注账号；公开前端包只保存哈希与 URL，不将整包复制进仓库。

实际调用当前纯函数得到 14 项基线检查，结果见 [offline_audit.json](2026-10-29-ob-basketball/offline_audit.json)。其中 false、null 和 0 多数是被确认的接入缺口，不代表“接入测试失败后被忽略”或“新实现已通过”。检查没有调用数据库写入、网络请求或投注接口。部分 matcher 模块导入现有 storage 时会初始化环境配置和打印 DB 模式，未据此执行 DB 操作。

## P1 接入风险

### F01 平台全量快照不能由两路独立覆盖

触发：现有电竞采集器提交电竞列表，新篮球采集器随后也以 OB 提交篮球列表；或者新客户端提交并集，旧客户端继续提交电竞列表。

依据：[store.js](../../server/backend/core/esport-api/store.js) 的 `saveMatches` 按 provider 重建 batch，有限期保留旧行，再调用 `dropOrphanBetsForProvider`；[platform_collector_store.js](../../rds/rds/platform_collector_store.js) 按平台清理缺席行。五分钟 sticky 只能暂缓缺席，不能保证并发来源隔离。

后果：内存、盘口及 RDS 对同一 OB 集合的认知交替变化；一路停更后可能被另一来源清理。仅修前端本机拼接不能覆盖旧客户端和多机器上报。

方案处理：新增 `snapshotScope`，旧 OB 请求缺省归电竞，新篮球只归 sport-basketball；后端形成 OB 并集。scope 与行内 ID/game 不匹配整批拒绝。**验收**：旧/新客户端交错、同秒并发、任一来源空/失败/停止、重启恢复和盘口清理均不越界。

### F02 只修内存仍会被 RDS 写队列和 SQL 覆盖

依据：[common.js](../../rds/rds/common.js) 对相同排队 key 只保留最新待写任务；[platform_collector_store.js](../../rds/rds/platform_collector_store.js) 的 matches key 仅为 `collector:{platform}:matches`，orphan SQL 的边界仅为 platform。即使内存按来源保存，两路 DB 待写仍可能 coalesce 成一条；scope 未进入删除条件时还会跨来源清理比赛、timer 和 history 归档。

方案处理：排队 key 与 DB orphan/alsoKeep/空列表均带来源范围，数据层通过 `@changmen/db` 暴露能力。**验收**：控制写队列拥塞，交错两路快照及故障回滚，用 PostgreSQL 确认两路都保留、history 归属正确且无跨来源 timer 删除。

### F03 电竞盘口判定会丢掉体育全场独赢

依据：[market_catalog.ts](../../packages/shared/catalog/market_catalog.ts) 的 OB 优先规则要求电竞 OddTypeID，名称回退也依赖“获胜”等格式；[native_bets.ts](../../server/match/matcher/compose/normalize/native_bets.ts) 据此选择来源。当前 hpid=37 与 SourceBetID 并不会自动成为篮球获胜盘。

可重复证据：P02 的 ID 判定和“[全场] 独赢（含加时）”名称判定均为 false；P03 的 `nativeSourcesByMap` 结果为 0。生产方案不能通过改中文名伪装成电竞盘口解决。

方案处理：篮球、体育命名空间、Map=0 和 hpid=37 的明确联合判定，主客按 ot 而非数组顺序。**验收**：37 入选，38/39/半场/单节/冠军盘全部排除，原五电竞选盘结果保持。

### F04 只写库不能让其他客户端获得 OB 报价

依据：[match.ts](../../client/packages/client-core/src/models/match.ts) 的 OB ViewBetItem 初始化不采用 Sources 赔率回退；有效价来自本机 fo。采集端的 localStorage、session、盘口元数据和 fo 不会随 RDS 自动传到查看者浏览器。

可重复证据：P10 给 Sources.HomeOdds=1.84、但不注册本机行情时，getOdds 返回 0。

方案处理：每个查看篮球的客户端启动独立体育试用行情，按 GetMatchs 的可逆来源 ID 补查和订阅；CollectConfig 只控制上报。**验收**：新浏览器无缓存、采集关、采集机器离线、刷新与登录切换时仍能正确获得或明确失效本机报价。

### F05 足球 WS 的默认订阅和实例状态不能直接共享

依据：[obSportWs.ts](../../client/web/src/runtime/obSportWs.ts) 的 builder 可以接受自定义 hpids，但连接器 `sendC8` 不传该参数，实际仍订足球 `1,2,4,17,18,19`；状态 ID 固定为 ob-sport。足球 session 和待订 mid 也属于同一实例的状态。

源站样本还收到足球 C109，说明不能仅因建立篮球订阅就认为每个帧都属于篮球。此次独赢 C105 只验证了锁盘，不能称连续开放独赢报价已验收。

方案处理：将 sport/hpids/会话/状态 ID 贯穿 transport；足球和篮球独立实例并严格过滤目标 mid/运动。**验收**：请求 C8 中确实为 37，两产品并行不互换订阅，重连/续期后仍正确，无关帧不改篮球状态。

### F06 状态编号和全场比赛终态存在结构差异

依据：体育样本 ms=0 为未开赛、ms=1 为进行中，现电竞 IsLive 使用 1/2。篮球比分位于 S1，现有足球 [obSportLive.ts](../../client/web/src/runtime/obSportLive.ts) 读 S0 且 C302 拒绝 csid=2。P07/P08 分别复现返回 null。

[resolve_structure.js](../../server/match/matcher/compose/structure/resolve_structure.js) 将 OB timer 与 IsLive 用于地图 Round，[ended_filter.js](../../server/match/matcher/compose/shape/ended_filter.js) 对无 PM 且只有 Map=0 的比赛没有明确体育终态通道。P09 显示双馆全场盘均 Locked、已开赛两小时、OB IsLive=1 时仍返回未结束；这不是要求将锁盘当结束，而是说明仅复用原字段无法表达确认的体育终态。

方案处理：显式转换 ms；篮球不进地图 timer；经核实后扩展体育终态值及定向生命周期分支。有 PM 时保留当前 PM 终态权威与身份核验。**验收**：NBA/NBL/大学篮球的未开赛、进行中、暂停、加时、延迟/取消/最终状态；OB+RAY 的最终状态确实收敛，未知保持未知。

### F07 品牌相同会选到电竞验盘和提交协议

依据：[registry/adapters.ts](../../client/packages/venue-browser/adapter/registry/adapters.ts) 的 getProvider 只按 account.provider 取 provider；[ob/bet.ts](../../client/packages/venue-browser/adapter/ob/bet.ts) 的 checkBet 和 betting 均调用 `/game/bet`，验盘还构造一元 probe。体育 [obSportPlaceBet.ts](../../client/web/src/runtime/obSportPlaceBet.ts) 则走 yewu13，且两处 sportId 写死为足球 1。

后果：新增体育来源被普通 OB 路由误认；不能认为“验盘”是无交易副作用的查询，也不能把拼错的体育 ID 发送到电竞接口验证。

方案处理：在可执行腿选择、账号筛选、check/submit/retry/makeup 全部按来源协议判断能力；观察期不支持执行的体育协议在任何投注请求前拒绝并清空 prepared data，已有电竞执行不变。完整交易显式传 sportId=2，重新核对现有 probe 类别工具。**验收**：所有入口 spy 验证无电竞或体育投注请求泄漏，后续分别验收体育预检、提交和未知结果恢复。

### F08 体育余额不能用电竞余额替代

依据：[platformAccount.ts](../../client/packages/client-core/src/models/platformAccount.ts) 的 getBalance 读电竞 balance；[accountPicker.ts](../../client/web/src/stores/account/accountPicker.ts) 按品牌和该余额选号；[balanceRefresh.ts](../../client/web/src/stores/account/balanceRefresh.ts) 仅在 pathname 以 /sports 开头时刷新 sportBalance。体育专用卡在电竞页面还会因缺电竞 token 跳过普通余额刷新。

后果：只换 provider.checkBet 仍可能用错钱包做资金阈值和金额换算，或无法选择体育专用账号。一个账号同时具备两种凭证时风险更明显。

方案处理：交易阶段给 option 明确钱包协议，选号、阈值、币种和统计使用目标钱包；不覆盖电竞 balance，不更改 ACCOUNT 的读写时序。**验收**：只有电竞资金、只有体育资金、两者都有及各自失效四类账号，普通页面与 listener 均按来源选资金。

### F09 订单刷新也不能只靠当前页面路径切换

依据：[venueOrders.ts](../../client/web/src/stores/account/venueOrders.ts) 只有 /sports 进入 footballOrderStore；普通电竞路径仍读电竞 OB getOrders。provider.getOrders(account) 没有 option，而当前体育订单持久化和统计属于 football_orders，电竞为通用 orders。

后果：篮球在电竞分类中提交体育订单后，可能查不到回执、误判拒单或误触发补单，也可能串入足球盈亏。把订单 ID 去前缀后直接混存还可能发生跨协议碰撞。

方案处理：按订单协议保存和查询，明确受理、未知结果、拒绝、最终结算与恢复策略；同品牌不同协议不以页面路径代替业务身份。**验收**：订单迟到、拒单、查询失败、刷新/重启、C201 与轮询竞态、同原始 orderId、双腿与补单及盈亏对账。

### F10 旧客户端读取新 OB 来源会使用旧语义

依据：现 Client_GetMatchs 对 OB Sources 没有体育能力投影；旧客户端 provider 仍是电竞实现。即使新客户端做对了采集，旧浏览器也可能取得带体育 ID 的 OB 腿。

方案处理：新客户端显式声明观察能力，后续交易另声明能力。缺能力时从同一合场 DTO 去除体育 OB 的 Sources/Matchs/Reverse，而非修改持久化合场或重新判定两馆门槛；详情和推送出口一致。后端先兼容，再发布前端。**验收**：旧客户端+新后端、新客户端+旧后端、分别回滚、普通 web 和 listener 混用，既有 RAY/PM 篮球仍正常。

### F11 空盘口与旧数据覆盖可能让已锁报价复活

依据：[store.js](../../server/backend/core/esport-api/store.js) 对空 SaveBet 保留已有盘口；[oddsStore.ts](../../client/web/src/stores/oddsStore.ts) 的 save 直接覆盖，未按源时间拒绝旧数据，默认 stale 清理为一小时，`clean('OB')` 清整个 OB bucket。C105 实抓 hs=2 时部分选项仍有旧 ov，不能只看价格。

方案处理：体育模块局部协调 HTTP/WS 代际和先后，缺盘时明确上报旧 ID Locked，锁优先于旧 HTTP；断线和换会话失效体育子集，不更改全平台覆盖规则。汇总缓存不能因另一源成功而被重新打成 fresh。**验收**：慢 HTTP 在 WS 锁之后完成、部分项/撤盘、hid 更换、停采后其他源持续上报、登出/HMR；电竞报价不被清。

### F12 字符串类型支持不代表元数据会自动穿透

依据：[collectWire.ts](../../client/web/src/api/collectWire.ts) 明确裁剪 SaveBet 字段；[native_bets.ts](../../server/match/matcher/compose/normalize/native_bets.ts) 的 sourceFromBet/cloneRawSource 也只投影既定字段。P05/P06 证明额外 Hpid、RawHid、OddTypeID 不能靠生产者随手添加来传给消费端；P11 证明 18 位 oid 经 Number 丢精度。

现 RDS source_match_id/source_game_id/home_id/away_id 为字符串传递，核心 matcher 查询也按 String，可承载拟定前缀；这只证明检查过的身份链路，不能外推所有管理工具或交易参数都支持新格式。

方案处理：采用严格、可逆、全链一致的体育 ID 编码；必要的新契约字段显式贯穿 wire、DB、DTO，不借临时 Map 充当唯一真相。**验收**：采集→wire→DB→重启→matcher→GetMatchs→本机补盘的原样往返、主客反转、长 ID 与错误前缀。

## P2 范围与兼容风险

| 编号 | 发现与依据 | 方案处理及验收 |
| --- | --- | --- |
| F13 | [mqtt.ts](../../client/packages/venue-browser/adapter/ob/mqtt.ts) 中 GetMatchs 刷盘 helper 对所有 OB ID 走电竞协议；全仓引用仅定义、内部互调和测试，未找到生产调用方 | 更正此前“当前 GetMatchs 必然触发”的表述；保护或拆分 helper，新增篮球生产订阅入口必须有真实调用路径测试，不能只改这个未接线 helper 就声称接通 |
| F14 | 当前 catalog 无 OB sport:2（P01）；后端 OB 仍有未来一小时窗口（P13），直接读取早盘不代表可立即下发 | 显式新增游戏映射且限制到采集传输；保留真实时间及原窗口，别用袋时间/现在时间钳制扩窗；验证冷启动与未来窗口边界 |
| F15 | 官方样本含 Fantasy 与 3x3；电竞 RAY 真实篮球和 NBA2K 本就可能共用游戏 ID；包含加时不等于取消/中断规则相同 | 依据运动/类型/赛事范围和联赛过滤首期支持场次，保留队伍身份标记；不用“去后缀”把虚拟比赛归成真实；逐市场确认结算兼容 |
| F16 | 旧体育篮球横跨 router、board/store、API actions、nba 拉取、catalog、lines 和 listener 路由测试；PM 电竞篮球仍依赖 Sports 状态 | 分两次发布退役 action，保留历史数据和共享模块；不按字符串全局删除 nba/basketball，不搬旧 sport_matches 到 client_matches；链接/路由/历史读取测试 |
| F17 | 体育工具目前在 web runtime，adapter 归 venue-browser；直接从 adapter import web 会形成反向依赖；历史 AGENTS 路径与当前 rds 布局有差异 | 按当前 WORKSPACE_LAYOUT 提取纯传输/解码并维护 exports，由宿主 ports 供会话；足球迁移兼容测试，实施后运行 boundaries，不重建退役目录 |
| F18 | [collectors.ts](../../client/web/src/runtime/collectors.ts) 始终启动行情任务，CollectConfig 仅门控上报；当前 OB startObCollector 的整个循环被电竞 Gateway/index 成功条件包围 | 体育任务不能依赖电竞会话成功，也不能依赖采集开关才启动；独立停止/重连/单飞/取消请求、保持原电竞轮询时序，验证 web 与 listener、HMR、登录切换 |

## 对初步口头方案的修订

| 初步描述 | 审计后的精确结论 |
| --- | --- |
| 把两份列表一次 SaveMatch 即可 | 单浏览器成立，生产多客户端与旧版并存需要后端来源边界；provider/action 保持，新增可选 snapshotScope |
| 现有字段都能放字符串，所以可以直接接 | 核心身份支持字符串，但仍需新 catalog、显式体育选盘、可逆编码和参数路由；追加自定义字段会被裁剪 |
| GetMatchs 后 OB 刷盘会自动处理每场 | 有该 helper 和测试，未找到当前生产接线；不能把静态函数当成已运行的请求链 |
| 直接复用足球 WS 与比分 | 压缩、心跳等能力可提取；连接器订阅、session 实例、S1 比分与 csid=2 需要明确参数化 |
| 只需将下注切到体育接口 | 必须连同 sportId、凭证、钱包选号、订单受理/查询/恢复和盈亏一起完成 |
| 体育篮球不要了就删除所有体育篮球代码 | 退役的是独立产品及专用读取；PM 官方状态和电竞篮球共享解析必须保留 |

## 实施后必须执行的场景

| 验收组 | 必须覆盖 |
| --- | --- |
| 来源隔离 | 旧电竞与新篮球交错/并发、RDS 队列拥塞、两路独立空/失败/停止、重启、历史归档和清理 |
| 身份与盘口 | 字符串长 ID、scope 伪混合拒绝、37 双向、反转、换盘、错误 hpid、至少两馆与虚拟赛事隔离 |
| 本机行情 | 非采集机器冷启动、CollectConfig 关、足球并行、gzip/zlib、未知 mid、锁盘后旧 HTTP、重连/续期、断开与 HMR |
| 生命周期 | BO/Round 不被 Q4 污染，S1 比分，未知状态不误判，无 PM 明确终态，有 PM 的既有权威不变 |
| 观察阶段执行隔离 | 手工/自动、重试/补单、listener 均不能将尚未支持的体育腿发送到电竞或体育投注接口；RAY/PM 原篮球不受影响 |
| 交易阶段 | 体育专用/双凭证账号、余额与限额、预检/提交 sportId=2、受理不等于成交、未知状态、订单迟到、拒单/幂等恢复、结算与盈亏、PM FOK/GTC 对冲 |
| 发布与退役 | 能力协商、旧客户端 Sources 投影、旧体育篮球 URL/action tombstone、共享状态流保留、后端先行、先撤体育来源再回滚 |

这些是后续验收要求，当前没有新实现可执行以上场景。源码/业务改动完成后走所属模块完整 `check:change`；涉及 DB 的来源语义和交易持久化执行数据库兼容演练，不以现有列无需改型为由跳过。

## 本次验证结果与限制

1. 14 项当前源码离线检查均与预期现状一致，完整输入结果已保存；没有运行真实下注或“以一元下单作验盘”。
2. 56 个关键源码哈希用于绑定实际工作区，包含两个原有未跟踪 listener 文件；没有重置、暂存或提交用户既有改动。
3. 当前变更仅方案、审计、索引和 docs 下证据。通过实际 `changePlan` 对这些精确路径判定为 docs，checks 为空；未将用户其他未完成源码改动混入本次业务回归。
4. 本次只证明当前源站可访问、结构可解析和有限时间内有推送。没有实测 token 完整生命周期、终态表、多客户端竞争或生产网络稳定性，也没有取得新功能的 CI/生产验收。
5. 方案审计可以支持开始实现，但不能将本报告的“基线检查一致”表述为“OB 篮球已经接入通过”。

文档收口已核验 40 处新文档本地链接、56 个源码哈希未变化、3 份 JSON 可解析及源站证据中的凭证字段排除；复核入口实际运行得到 14 项基线一致。`git diff --check` 对本次已跟踪文档修改通过，新文档另检查了空白与代码围栏。精确 9 个交付路径均归 docs，无业务代码检查计划。
