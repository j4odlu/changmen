# PM 本对话改动：代码与官方协议复核（2026-11-07）

后续状态：R1、R2 的修复与验证见[后续修复报告](./PM_PRICE_REVIEW_FIXES_20261107.md)。本文保留当时的复核与失败证据。

[changmen 扩展] 本轮是检查与取证，没有修复运行代码。用户已暂缓报价时间混用及配套时序改造，该项保持暂缓。没有提交、push 或部署，没有真实订单操作。

## 1. 结论

官方直连“初次全量、随后差集增减、新增资产取官方 book”符合当前官方协议，报文也与本机官方 SDK 的构造一致。直连不采用 MarketIndex 价格是 CHANGMEN 自身的数据来源选择，官方协议提供的初始/新增 book 支持该选择，但这并不自动保证整条价格链路没有缺陷。

本轮发现 **1 个本次改动的兼容性遗漏、1 个已存在且仍未解决的空盘缺陷**。另保留用户暂缓的时钟问题。不能把完整回归通过写成“没有 bug”或“现场实时同步已验收”。

| 编号 | 优先级 / 归属 | 结论 |
| --- | --- | --- |
| R1 | P2 / 本次遗漏 | 官方直连切回转发，Index 版本未变时，不会补入转发模式应使用的目录初值 |
| R2 | P1 / 原有缺陷 | 明确空卖盘或无有效可买价被过滤，旧有效报价仍显示并供扫描读取 |
| K1 | 已知 / 用户暂缓 | 本机时间与交易所时间混用、迟到回包的排序改造没有实施 |

## 2. 实际实现归属、范围与取证方式

**行情订阅没有复用官方 SDK 的运行管理器。** 当前仍由 CHANGMEN 自建的 `ws.ts` 创建原生 WebSocket，`marketQuoteHub.ts` 合并订阅并生成差集，`wsQuotes.ts` 解析原始消息；报价经 `pmTokenQuote.ts`、生产桥接进入 `oddsStore`，由 Vue 页面读取。本次修改了这些已有入口，没有改成 `PublicClient.subscribe()`，也不是本次从零重写整套 transport。

官方 SDK 用于源码对照与离线行为验证。它已有的订阅/连接管理能力没有在当前主行情链路中被实际调用；“与 SDK 报文和行为一致”不能写成“已复用 SDK”。因此现有心跳、重连、增减订阅和解析的正确性仍需由本项目维护。应用缓存、显示转换及 Vue 更新则属于 CHANGMEN 自身职责。

按本对话实际改动选取 23 个前端路径：14 个运行源码、9 个测试/测试桥接文件。范围涵盖 API 报文、主行情 hub/transport、Index collector 与映射、source-mode 通知、报价来源标记、生产桥接、oddsStore、BetRow/MatchCard/SportMatchBoard 及相应回归。测试桥接归测试路径，不计为业务源码。

核对完整 Git 差异及实际调用方；进一步检查共享解析器、报价先后辅助状态、体育独立缓存、tick 元数据、报价冻结和预检读取入口。本工作区此前的手续费旁显、扩展、RDS 等修改不是本对话的价格链路改动，不能把它们归为本次修复，也不以本报告验收无关后端业务。

为验证缺陷，临时复制既有实际 collector/transport/生产桥接/Pinia 集成测试，增加 4 个审计断言。运行后删除临时测试文件，保留本机证据。没有用固定返回值的假缓存替代正式缓存。

## 3. 官方文档与 SDK 对照

资料于 2026-11-07 重新查阅。SDK 行为基线为已安装 `@polymarket/client@0.12.0`，不以当前 GitHub main 代替本机版本。

| 核对项 | 代码结论 | 官方依据 |
| --- | --- | --- |
| 官方地址与首次订阅 | `/ws/market`；`type: market`、`assets_ids`，请求初始快照 | [Real-Time Data](https://docs.polymarket.com/market-data/realtime-data) |
| 运行中增减资产 | `operation: subscribe/unsubscribe`，不重建连接；共享资产等最后消费者退出后才移除 | [Market Channel](https://docs.polymarket.com/api-reference/wss/market)、本机 SDK protocol.ts |
| 新增资产初始化 | 后续 subscribe 的新增资产会有 book；不依赖 `initial_dump:false` 阻止快照 | [Real-Time Data](https://docs.polymarket.com/market-data/realtime-data) |
| 自定义顶层价事件 | 初始及新增订阅保持 `custom_feature_enabled:true`；退订不附带该开关 | 官方实时数据页及本机 SDK 报文构造 |
| 心跳 | 每 10 秒发送文本 PING，过滤 PONG，保留已有重连处理 | 官方实时数据页、本机 SDK heartbeat.ts |
| 事件格式 | 当前通道读取原始 snake_case；没有误用 SDK 标准化后的 camelCase 事件结构 | 官方 Market Channel 原始消息示例 |
| 卖一初始化 | book、BBO 和包含 best_ask 的 price_change 均可提供本侧价格；不必等待对侧 | 官方实时数据页及本轮通过的审计用例 |
| 重连恢复 | 新连接重建发送集合，恢复最新消费者并集；旧 socket 回调不修改替换后的连接 | 本机 SDK 重连行为与本项目实际 transport 回归 |
| 对照口径 | 对齐同 token 的最低 ask；页面概率、中间价、缓冲 cap 与其倒数另行区分 | [Prices & Orderbook](https://docs.polymarket.com/concepts/prices-orderbook) |
| SDK 使用边界 | 官方同时提供 SDK 和原始 WebSocket API；保留唯一既有 transport 本身没有违反协议 | [TypeScript SDK](https://docs.polymarket.com/getting-started/typescript)、实时数据页 API 示例 |

重新运行既有 SDK 离线脚本，7 项公开行为检查通过，包括连接复用、初始帧、重复资产、增订、事件标准化、退订及重连重订。它证明 SDK 的这些行为，不等于 CHANGMEN 已由 SDK 接管网络，也不证明真实网络性能。

## 4. R1 [P2] 切回转发时遗漏同版本 Index 的初始化

位置：[markets/collect.ts](../../client/packages/venue-browser/polymarket/markets/collect.ts#L236)，重点是 `updatedAt` 短路位于来源判断之前。

触发顺序：

1. 以官方模式初始化，目录提供 `homeClobPrice=0.28`，按本次设计只建立映射，不写价格。
2. 官方尚未提供报价，手动切回转发，或因无 book 自动回退。
3. 转发建立连接，但其 book 尚未到达；后台目录本轮 `updatedAt` 与上轮相同。
4. collector 在判断转发应使用目录初值前提前返回；即使再等完整 30 秒轮询，缓存仍无该资产。

本轮实际集成断言期望转发获得标记为 http-seed 的 0.28，结果为 `undefined`，显示赔率 0。转发订阅帧已经正常发出，因此该复现不是订阅消息丢失。

归属：这是直连停用 Index 价格新增的模式差异没有进入去重条件导致的遗漏。原版首次处理目录时无论来源都会写入该初值；本次官方初始化刻意不写后，切换转发需要重新评估同版本目录。若新转发 WS 正常立即回 book 或目录恰好更新，该问题会被掩盖；不宣称每次切换都必然空白。

影响：转发模式原有的目录初始化兼容行为退化；可能等待新 WS 或 Index 更新才恢复。没有证据表明会绕过预检或改动下单参数。

修复方向：把“Index 版本”和“应用价格策略的来源模式”共同纳入处理条件，或在切换转发后重新应用已取得的目录。直连继续禁用目录价；避免借此恢复直连种子覆盖，不需要修改 VPS。另补官方→转发、转发→官方，以及实际自动回退的集成回归。

## 5. R2 [P1] 官方明确空卖盘后旧价仍被保留

位置：[wsQuotes.ts](../../client/packages/venue-browser/polymarket/wsQuotes.ts#L79)、[marketQuoteHub.ts](../../client/packages/venue-browser/polymarket/marketQuoteHub.ts#L104)。

确定性证据：

| 输入序列 | 正确要求 | 实际结果 |
| --- | --- | --- |
| 有效 book ask=0.35 → 新 book asks=[] | 当前不再有有效可买价，旧 0.35 不应继续作为当前价 | 缓存仍为 0.35，读出赔率 2.857 |
| 有效 book ask=0.35 → 新 price_change best_ask=1 | 按现有有效价范围，1 不可作为可买报价；旧价应失效 | 缓存仍为 0.35，读出赔率 2.857 |

第一条在解析阶段被过滤：空 asks 得到 0，`bestAsk > 0` 不成立，没有任何清价事件。第二条会进入 hub，但在 `bestAsk >= 1` 时被丢弃，同样没有通知消费者清除旧值。缺字段和非法输入应与明确空侧区分，不能把所有坏包都清价。

归属：`wsQuotes.ts` 与 `bookQuote.ts` 对比 HEAD 未改；hub 的有效价过滤也不是本轮新增。因此这是原有缺陷仍然存在，不是增减订阅报文造成的新回归。本次禁止 Index 种子并未解决它。

影响：UI 及读价扫描可能继续使用已经没有对应卖单的旧价格，引发无效机会或后续预检拦截。它不证明原截图那一单由空盘导致，也不代表订单一定会提交或成交。

修复方向：在既有通道传播明确空侧状态，覆盖缓存、保留快照、页面及新尝试读取，并覆盖新有效卖单恢复。必须验证旧空事件迟到不会清掉新价；若需要触碰用户暂缓的 C 批顺序规则，明确列为依赖，保持暂缓，不在本轮偷偷实施。

## 6. 已复核且未发现新增明确回归的部分

- 首次订阅、同集合/force 不重复发送、新增/移除差集、多消费者引用、连接中集合变化、重连和换源，既有真实 hub/transport 测试通过。
- 直连 Index 不写种子；来源标记贯通实际保存条目和生产桥接；目录刷新及 clean 不恢复直连旧种子；后续有效 WS 降价仍能更新。
- 页面范围由显式参数传递；主列表出现/消失 PM 比分信息不改变读价范围；独立体育板仍明确读取其原有 fallback。
- 当前尝试冻结的 rawAsk/cap、百分比与 tick 转换、金额及 FOK/GTC 执行源码没有本对话差异；相关既有业务回归继续纳入所属模块检查。没有用展示改价放行失败订单。
- 其他平台读取规则不新增 PM 来源过滤；原转发报文格式保持。

这里的结论限于已检查路径与离线回归，不是对所有业务或生产环境的绝对保证。

## 7. 暂缓项 K1 与验证结果

K1 的源码与 HEAD 一致；SDK 脚本再次证明本机时间模拟快 5 秒时，当前交易所时间被判旧。没有改动 Windows 系统时间。用户已要求本次先不处理，本轮只记录该问题，不实施时间拆分或请求版本改造。

本轮按仓库同一 change-plan/verify-change 引擎，以本对话 23 个前端路径计算检查范围，结果为 frontend，完整执行 boundaries、frontend、build。任务范围内核对冻结路径后沿用单次 `ALLOW_ESPORT_TOUCH=1`，进程结束恢复环境；没有改冻结基线或豁免清单。

| 验证 | 本轮结果 |
| --- | --- |
| 边界/契约等 `test:checks` | 通过 |
| web | 7,610 项通过，4 项原配置跳过 |
| listener-live / listener-compat | 76 / 265 项通过 |
| 所属前端完整回归合计 | **7,951 项通过、4 项原配置跳过** |
| 生产构建 | 通过，包含前端类型检查 |
| 验证报告 | `passed:true`、`sourceStable:true` |
| 额外定向复验 | 15 个测试文件、109 项通过 |
| 官方 SDK 离线行为 | 7 项通过 |

完整验证期间没有修改受检查源码；审计文档在验证结束后落盘。工作区仍含无关预先改动，按本任务文件计算模块范围，不是无关后端验收或发布候选验收。

**既有门禁通过与审计失败用例须分别报告。** 审计新增用例明确留下 3 个失败断言（R1 一项、R2 两项），另 1 项 price_change 独立初始化通过。14 项原测试因定向选择审计用例而跳过，不是缺陷修复后的跳过门禁。

本机证据位于 `output/pm-dialogue-review/`：targeted.json、probes.json / probes.log、临时测试源码副本、SDK 结果、未改源码指纹以及完整验证报告。该目录由 gitignore 忽略；证据不是已发布制品。没有现场浏览器/官方服务器的连续价格对照，不能把离线结果写成现场同步已验收。
