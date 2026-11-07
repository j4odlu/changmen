# PM 用户直连：停用 MarketIndex 价格

[changmen 扩展] 2026-11-07。状态：**实施后复核发现一处页面范围判断错误，已修正，修复后完整前端门禁通过**。第 6 节记录本次发现与修复；第 4 节保留初版验证结果。仅修改客户端；未提交、未 push、未部署。

## 1. 用户确认的职责边界

MarketIndex 继续提供比赛、盘口、方向、token、状态和赛果元数据。官方直连模式不再使用其中的 `homeClobPrice / awayClobPrice` 或 `homeOdds / awayOdds` 初始化、覆盖或恢复可交易报价。VPS 采集与下发契约保留。

价格初始化使用官方 Market WS 的初始 book；新增资产的 subscribe 返回该资产 book，后续由行情推送更新。正常流程不需要等待价格发生变化，也不等待下一次 30 秒 Index 检查。官方协议说明见 [Real-Time Data](https://docs.polymarket.com/market-data/realtime-data) 的 Market Stream 部分；`initial_dump: false` 只跳过初始 market 帧的快照，后续 subscribe 对真正新增的资产仍发送 book。

“预检纠偏价”指预检查询官方订单簿后取得的实际卖一，例如页面旧价 0.28、预检实际卖一 0.35，原本轮提交被拦截，同时更新当前报价为 0.35。该更新不修改原尝试的冻结限价。

## 2. 已实施的行为

| 场景 | 本次处理 |
| --- | --- |
| 官方直连首次取得 Index | 只建立盘口映射、登记订阅，内部映射不采纳 Index 赔率，不灌价格缓存 |
| 官方直连 Index 版本更新 | 更新目录、赛果与订阅集合，不覆盖 WS/预检当前报价，不再为种子触发全表 refresh |
| 首份官方报价尚未到达 | 电竞赔率为 0，现有 UI 显示“等待报价”；不使用 ViewBetItem 的旧 fallback |
| 仅一侧收到有效卖一 | 该侧立即更新并可读，另一侧继续等待；不因双侧未齐把有价一侧锁定 |
| 新增 token | 通过已完成的增量订阅取得自身初始 book，再进入现有报价入口 |
| clean 缓存重建 | 有效 WS/预检报价快照继续可用；Index 不再写入旧值覆盖它 |
| 从转发切到官方 | 响应式来源镜像立即生效，当前条目、快照及 fallback 中的目录种子不再被当作可交易价 |
| 旧内存里的 HTTP 条目没有细分来源 | 官方直连将其视为未确认的旧数据，等待新 WS 或带来源的预检报价；不猜测它是新行情 |
| 已冻结的尝试 | 保持原 cap、金额和预检/提交语义，后续行情不重新定价已有尝试 |
| CHANGMEN 转发 | 保留原 Index 种子初始化分支及 fallback 行为；记录种子身份，供以后切到官方时识别 |
| 独立体育板及其他平台 | 独立体育板显式保留原 fallback 路径；其他平台的 save、clean、fallback 不套用 PM 规则 |

这里的官方直连策略跟随已有 PM-M 来源选择。来源切换同步更新 Pinia 镜像，不依赖下一轮 Index 或下一条价格消息才重新计算页面。桥接重复安装会释放旧监听，清理桥接时解除监听，store reset 使用当前来源初始化。

## 3. 改动范围与来源标记

在现有报价条目中增加一个可选字段 `pmQuoteSource`，值为 `http-seed | ws | book-correct`。这是用于识别已有转发种子及官方预检报价的最少元数据，没有新增行情 store、连接或恢复队列。

既有 `source: http | mqtt` 保持原用途。HTTP 预检纠偏仍为 http，另带 book-correct；实际 WS 带 ws；转发模式接收的 Index 种子带 http-seed。生产桥接及测试桥接保留此字段；clean 继续复制完整 PM 条目；纯赔率回写不能把已有种子身份洗掉。

`pmQuoteSource` 是浏览器内存中的报价来源，诊断指标原已有对应 `quoteSource`。本次未在盘口、订单进度或预检提示上增加 book-correct 英文标签，也不新增后台持久化字段。

| 文件 | 主要改动 |
| --- | --- |
| [markets/collect.ts](../client/packages/venue-browser/polymarket/markets/collect.ts) | 官方分支停止种子写入；转发分支保留并标记种子 |
| [markets/marketIndex.ts](../client/packages/venue-browser/polymarket/markets/marketIndex.ts) | 支持只映射目录、不读取赔率；原默认行为供其他调用方保留 |
| [quotes/pmTokenQuote.ts](../client/packages/venue-browser/polymarket/quotes/pmTokenQuote.ts) | 把既有细分来源从指标参数保留到实际条目 |
| [oddsAccess.ts](../client/packages/client-core/src/bridge/oddsAccess.ts) | 可选 PM 来源字段；不改变公共函数签名或其他平台条目 |
| [oddsStore.ts](../client/web/src/stores/oddsStore.ts) | 官方屏蔽种子与旧 HTTP 初值、禁止电竞缺价 fallback、保留快照及等待状态 |
| [pmWsSourceMode.ts](../client/packages/venue-browser/polymarket/pmWsSourceMode.ts)、[pmMarketWsMode.ts](../client/packages/venue-browser/polymarket/pmMarketWsMode.ts) | 提供可释放的来源变化通知；原 set/cycle/persist 行为保留 |
| [installClientCore.ts](../client/web/src/runtime/installClientCore.ts) | 生产桥接传递来源、维护响应式来源镜像及生命周期 |
| [BetRow.vue](../client/web/src/components/match/BetRow.vue) | 明确电竞/独立体育的 fallback 读取范围，复用原“等待报价”展示 |

复核后的范围传递为：主交易列表默认 quoteScope=esport，独立 SportMatchBoard 显式传 sport，经 MatchCard 传给 BetRow。这里是既有页面/缓存职责，不是按比赛项目区分价格；主交易列表也可以包含篮球。两处对同一 PM token 的可买价格定义都仍是官方卖一。

本次不修改 VPS、后台 API、数据库、独立体育的网络订阅、订单提交、盘口预检、冻结限价或缓冲公式。页面手续费旁显等此前已有改动保留，不纳入本次行为变更。

## 4. 验证

新增 [真实报价链路集成测试](../client/web/src/stores/oddsStore.pmDirectIndex.test.ts)：使用实际 collector、hub、transport、Pinia oddsStore 及生产 client-core 桥接，只有 WS、后台返回和外围服务使用离线桩。共 14 项，覆盖：

- 首次映射无种子、旧 fallback 不生效、收到一侧 book 后独立更新。
- WS 0.28 → 预检 0.35 → 旧 Index 刷新，直接条目和 clean 快照均不退回 0.28；随后新 WS 0.34 正常更新。
- 新增资产等待自己的 book、重连恢复最新订阅并继续更新。
- 转发到官方切换：完整种子、仅赔率种子、保留快照以及纯赔率回写均不复活目录价。
- 旧内存未标记 HTTP 条目停止使用；带来源的官方预检纠偏仍可读取。
- 百分比/+1 tick 的已有尝试保持冻结；其他平台和独立体育 fallback 保留；来源监听可释放和重新安装。

另扩展目录映射测试、BetRow 等待与体育展示测试，以及来源 set/cycle 通知测试。原 hub 生命周期、WS 重连、快照和缓冲回归继续通过。

行情契约专项：6 个文件、42 项通过，覆盖 PM 主 hub、官方差集订阅、独立体育 hub、浏览器连接隔离、collector 生命周期和 PF hub。冻结文件仍提示旧 `@changmen/venue-adapter` workspace 命令，但当前该 package.json 已退役，本轮直接运行对应现行 Vitest 文件，没有恢复旧入口。

首次完整检查命中电竞冻结保护的三个真实改动入口：client-core 的 oddsAccess、PM collector、web oddsStore。核对均属于用户本次授权的 PM 电竞价格修复后，按 AGENTS.md 使用单次进程环境 `ALLOW_ESPORT_TOUCH=1` 重跑；冻结清单与基线未改，不持久化环境变量。该放行仅允许本次有意修改冻结面，其他边界与回归检查照常执行。

完整前端门禁通过：

| 检查 | 结果 |
| --- | --- |
| boundaries / `npm run test:checks` | 通过；冻结面按上述授权范围单次放行，其他检查保留 |
| web | 659 个测试文件通过，3 个文件原配置跳过；7,607 项测试通过、4 项跳过 |
| listener-live | 6 个文件、76 项通过 |
| listener-compat | 21 个文件、265 项通过 |
| 前端测试合计 | **7,948 项通过、4 项原配置跳过** |
| `npm run app:build` | 通过，包含前端类型检查以及 web/listener 构建 |
| 源码稳定性 | `passed: true`、`sourceStable: true` |

本机记录位于 `output/pm-direct-index/validation.json` 和 `validation.log`。工作区有本任务之前的扩展、手续费和 RDS 等修改，本轮通过仓库同一 change-plan/verify-change 引擎按本次 14 个前端路径选择检查。报告身份包含工作区已有源码，不代表无关后端修改已验收，也不构成发布候选验收。

## 5. 仍需后续处理

最新全面复核见 [本对话改动与官方协议审计](./audits/PM_DIRECT_DIALOGUE_CHANGES_REVIEW_20261107.md)：新增确认官方切回转发且 Index 版本不变时漏补初值；另复现原有明确空盘后旧报价未清除。两项尚未修复；时钟改造继续按用户要求暂缓。

本次切断了**用户直连模式下 Index 种子覆盖当前报价**的路径。前一版计划中“继续保留直连种子、增加种子覆盖优先级”的 B 方案已由本实现替代。转发仍沿用原种子策略，不把该分支宣称为已修复。

剩余工作沿 [当前后续计划](./PM_DIRECT_SUBSCRIPTION_UPDATE_20261107.md#4-后续工作顺序) 执行。用户于 2026-11-07 要求先不处理时钟问题，报价先后判断及配套迟到回包修复暂缓；下一步先做实际官方直连只读对照，核对同一 token 的官网卖一→本地缓存→页面，定位差异后再安排对应最小修改。随后先审计明确空卖盘处理，不假设暂缓的顺序保护已经存在。本轮没有进行真实浏览器/官网网络观察，不能声称所有预检价差已消失或现场延迟达到某个阈值。

## 6. 实施后复核：页面范围判断回归

本轮用户要求检查错误、bug 和业务影响。复核发现 **1 处前一版实现引入的回归**：BetRow 用 `props.match.pmSport` 的存在判断是否使用独立体育板的 fallback。`pmSport` 实际是 PM 比分/计时元数据，主交易列表中的电竞比赛同样会带此字段，不能作为页面或报价缓存类型。

**触发与影响：**主交易列表带 PM 比分、本地尚无有效官方报价、ViewBetItem 留有旧 fallback=2 时，前一版 UI 返回 2，而正确结果应为 0 并显示“等待报价”。另一方向，独立体育页面暂时没有 pmSport 时会错误停止原 fallback。它影响价格展示和等待状态；不能把这次复核写成“未发现任何回归”。这处问题尚未发布。

原测试错误地把“增加 pmSport”当成“切换体育页面”，所以初版完整回归没有识别该错误。复核先改正测试语义，确认修复前两项断言失败：主列表错误显示 2，以及缺 PM 比分的独立体育页面错误显示 0，再修改运行代码。

**修复：**BetRow 与 MatchCard 增加默认 esport 的显式 quoteScope；独立 SportMatchBoard 明确传 sport。UI 的读价与等待判断均使用该页面参数，不再从比分或计时字段推断。HomeView 默认路径无需改变，原下注开关保持。

补充/修正回归：

- 带 PM LIVE/currentMap 的主交易盘口，缺价时等待，比分数据出现或消失均不恢复旧 fallback；收到有效报价后正常显示。
- 显式 sport 范围，无论是否有 PM 比分数据均保留原 fallback。
- MatchCard 默认传递 esport，并能转交明确的 sport；独立体育板的现有隔离契约确认显式声明。
- 原直连 Index/生产桥接集成回归继续运行。

定向验证为 4 个文件、52 项通过。未改变来源标记、快照、价格/缓冲转换、冻结尝试、金额、FOK/GTC、下单确认或拒单代码。继续核对了主列表与独立体育的实际入口，以及现有预检/提交对冻结报价的使用；在这些检查中未发现另一个需要修改的运行时问题。

修复后使用原验证引擎按本任务 18 个前端路径完成复验，沿用本次明确授权冻结面的单次环境放行：

| 检查 | 结果 |
| --- | --- |
| boundaries / `npm run test:checks` | 通过 |
| web | 7,610 项通过、4 项原配置跳过 |
| listener-live / listener-compat | 76 / 265 项通过 |
| 前端合计 | **7,951 项通过、4 项跳过** |
| `npm run app:build` | 通过，含前端类型检查及 web/listener 构建 |
| 验证报告 | `passed: true`、`sourceStable: true` |

本机报告为 `output/pm-direct-index-review/validation.json` 和 `validation.log`。本轮重新验证修复后的源码，不复用初版 7,948 项通过作为修复后的验收。工作区验证仍不构成发布候选验收；尚未做真实官网/浏览器网络对照，不据此声称所有价格或时序问题已解决。
