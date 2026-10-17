# PM 本地订单簿：Builder 项目与公开实现对照

[changmen 扩展] 2026-10-17，Asia/Taipei。研究入口为用户提供的 <https://builders.polymarket.com/>，采用公开、只读材料；没有注册、连接钱包、申请试用、下载执行第三方软件或发布 changmen。本报告区分官网宣称、可检查源码和本项目判断，不能用 Builder 成交量证明订单簿正确性或 FOK 成交率。

## 决策

[changmen 扩展] 后续已按用户要求收敛为 [Nautilus 快照恢复与差异取证具体方案](./PM_BOOK_RECOVERY_AND_EVIDENCE_PLAN_20261017.md)：明确可复用模块、逐资产状态机、PM-M 恢复权限、取消补偿、证据包及有限验收顺序。该文为设计稿，本次未实施、构建或测试，经典 FOK 不变。

**应先确定行情同步与恢复的契约，再做有限验证。继续反复构建、延长随机实测，不能解决缺快照时没有恢复权限的问题。** changmen 当前保留“现有 PM-M → 独立被动簿/Worker → 动态旁路”的实现与默认关闭设置，实际预检继续 HTTP，经典 FOK 不变。本次研究不实施另一轮行情/交易改造。

最有价值的工程参照是榜单中的 **NautilusTrader**，产品参照是 **SpreadCore、Traderline**。前者有可核对的 PM 同步恢复实现；后两者适合研究跨场馆工作流和交易操作，内部实现仍有黑盒。技术灰度判定与这份架构取舍分别记录，不将可运行旁路等同于真实本地预检已就绪。

## 榜单取证与选择

本机公开抓取的榜单是 `1m Volume` 口径，2026-10-17 13:43 左右可见：Betmoar.fun 第 1、traderline 第 2、Sharktool 第 4、MagicMarkets 第 5、SpreadCore.xyz 第 6、NoArb 第 10、NautilusTrader 第 22。名次随时间变化，搜索索引的旧榜单不用于当时排名。页面读取器因正文超过大小上限失败；技能自带的公开 HTTP 提取器成功读取，记录在 `output/playwright/pm-asset-isolation/builders-leaderboard.json`。

选择依据是与本项目的关系及证据可得性，不只看名次。榜单未提供足够可核对的项目身份链接时，不凭相同名称把某个仓库认定为该 Builder 的实现。

| 对象 | 公开证据与边界 | 对 changmen 的用途 |
| --- | --- | --- |
| NautilusTrader | 官方 PM 文档和 Rust 源码可读；本次固定 `develop` 提交 `e1c7a7af…`，不是对某稳定发行版的实盘认证 | 首要工程参照：逐资产状态、共享订阅、恢复所有权与迟接入处理 |
| SpreadCore | 官网宣称 PM 对 9+ 博彩平台扫描、深度、PM 下单和对冲金额计算；没有取得内部同步源码 | 最接近业务的产品参照；不能由“WebSocket 更新”推断它取消 HTTP 预检或自动执行两腿 |
| Traderline | 官网确认 PM/Betfair 专业终端和 ladder 工作流；内部缓存、恢复、执行线程未公开核实 | 研究交易交互、盘口深度和客户端职责；桌面表现不能替代浏览器后台验收 |
| Betmoar | 官网介绍社区/Discord 交易入口和市场研究；未取得本地簿实现 | 研究展示、市场上下文与操作整合；对当前簿同步问题帮助较小 |
| MagicMarkets | 找到同名体育交易所及公开数据 feed；与榜单 Builder 的主体对应仍需确认 | 其协议可作补充参照，不能当成已证明的 PM 适配器或直接复制到 PM |
| NoArb / Sharktool | 榜单身份可见；本次没有核实 NoArb 的官方技术实现。同名 Sharktool 站点主要描述 Odd Justa，不能据此认定为榜单同一 PM 产品 | 保留身份/实现未知，不以名字推断自动套利或订单簿架构 |

来源：[官方榜单](https://builders.polymarket.com/)、[SpreadCore 官网](https://spreadcore.xyz/)、[Traderline 官网](https://traderline.com/)、[Betmoar 官网](https://www.betmoar.fun/)、[MagicMarkets 官网](https://magicmarkets.com/about)、[同名 Sharktool 官网](https://sharktool.com/)。官网的收益、速度和用户数为产品方宣称，本报告不采纳为性能或交易安全证据。SpreadCore 页面示意的 `36ms` 等也不作为实测数据。

## 可检查实现及适用性

### NautilusTrader：同步恢复由行情适配器负责

固定提交的 [book 模块说明](https://github.com/nautechsystems/nautilus_trader/blob/e1c7a7af5ae0b2a254dc303475e11663c3dd5762/crates/adapters/polymarket/src/book/mod.rs) 明确指出 PM 簿没有序号：先接受快照，再处理增量；这不是交易所连续序号证明。

[逐资产同步源码](https://github.com/nautechsystems/nautilus_trader/blob/e1c7a7af5ae0b2a254dc303475e11663c3dd5762/crates/adapters/polymarket/src/book/sync.rs) 以 instrument 保存状态；快照等待、恢复占有、取消订阅与重连各有状态转换。恢复只有一个持有者，退出订阅后不会靠迟到响应恢复旧状态。这里值得借鉴的是状态和所有权，而不是 Rust 本身。

[PM 适配文档](https://github.com/nautechsystems/nautilus_trader/blob/e1c7a7af5ae0b2a254dc303475e11663c3dd5762/docs/integrations/polymarket.md#websockets) 说明：报价与簿消费者共享资产订阅；迟接入没有快照或 tick 切代时由适配器恢复订阅。只有 hash 原像字段完整时才验证 hash，缺字段不声称已验证。文档也说明其运行环境是 Rust/Python，与浏览器不同。

**本项目判断**：这揭示当前旁路的明确缺口。我们已把单资产故障隔离，但被动服务不能改变 PM-M 订阅、不能补建簿，因此没有承诺恢复快照的能力。不能一边保留这个约束，一边把低覆盖率当成队列/计算优化就能解决的问题。以后如要提供有恢复保证的公共簿，应在 PM-M 的网络所有权内另行设计资产恢复协议，先证明不会打断原报价及经典 FOK；本次不添加该行为。

[恢复任务源码](https://github.com/nautechsystems/nautilus_trader/blob/e1c7a7af5ae0b2a254dc303475e11663c3dd5762/crates/adapters/polymarket/src/book/recovery.rs) 进一步确认：发送重订阅成功本身不算恢复，必须由同步器接受快照；取消、退订、替换和退出会终止过时工作。恢复请求由行情池执行，使用共享重试预算，簿消费者不各自创建恢复连接。这比“有问题就再开一个 WS”更适合本项目现有边界。

也不整套搬入 Nautilus：它会带入不同的运行时、订阅管理和执行语义。只参考公开状态机和证据边界；未复制其下单、精度、资金、订单恢复或风控规则。

### CCXT：有直接 PM 实现，但不能等价为严格执行来源

[固定 PM 实现 `c89f5497…`](https://github.com/ccxt/ccxt/blob/c89f5497f9c710a0ec66285456152e4d159ac428/ts/src/prediction/polymarket.ts) 按资产保存簿：快照替换，增量写入新聚合数量，零数量删除，没有快照时忽略增量；该版本明确忽略 `tick_size_change`。其 `watchOrderBook` 自行管理订阅入口。

**本项目判断**：可用来核对最小归并语义，但不直接替换现有 PM-M 或当前动态执行校验。引入一个成熟库不等于自动取得 tick、元数据、年龄、后台恢复及双腿 FOK 的全部保证。

[CCXT Binance 实现](https://github.com/ccxt/ccxt/blob/d21dce2be87b2ba4923771f5130eda825ed93cb5/ts/src/pro/binance.ts) 则用交易所更新 ID 拼接 REST 快照与缓存增量。**不能将这种有交易所序号的恢复证明照搬到 PM**，也不能把本地接收序号说成 PM 序号。

### Hummingbot、官方 SDK 与补充项目

[Hummingbot tracker](https://github.com/hummingbot/hummingbot/blob/9af100d6822da7d2d0291a906c730ef172284ee2/hummingbot/core/data_type/order_book_tracker.py) 将数据源、逐交易对队列/簿、策略分开，并保留增量窗口以恢复快照；[官方架构说明](https://hummingbot.org/connectors/connectors/architecture/) 将周期快照列为维护不足时的补救。其 Python 服务框架不适合直接塞入浏览器。

[PM 官方 SDK 的固定 WS manager](https://github.com/Polymarket/ts-sdk/blob/e77aca62456ed4e25c3d4406c7cbb2f5ea258882/packages/client/src/websockets/clob/market.ts) 管理连接、订阅、协议解析及分发；这里没有可直接接入任意既有原始流的完整执行簿。继续复用协议类型/校验依据，暂不以更换网络层扩大本轮范围。

[poly-book](https://github.com/weiminglong/poly-book/tree/126d30ce9638b9441a3358bbd14ea1b3d420d0cd) 将确定性回放和单写入者作为设计核心，值得参考取证方式；它自述仍是演进中的个人项目，不把其“production-grade”或纳秒 benchmark 当成已独立验证事实。无需为当前 16 资产旁路引入其存储/服务全栈。

[MagicMarkets 公开 feed](https://github.com/magicmarkets/magicmarkets-data-feed) 提供快照后增量的协议及示例，但传输的是该平台参考价格，不能当成 PM 完整订单簿。跨平台协议的快照结束、删除、重连语义必须分别验证。

另一个可核实的边界是其 [交易 API](https://github.com/magicmarkets/magic-api)：实时 offer、参考 feed 和 REST selection quote 分属不同接口。**有实时行情，不自动意味着执行前不需要 HTTP。** 这里仅核对该同名项目的接口分工，不据此认定其与榜单 Builder 是同一运营主体。

SpreadCore 的公开流程也值得单独理解：它展示 PM 下单和博彩公司对冲金额计算，不能由此推断第二腿已经自动提交、成交或确认。changmen 应继续以自己已有的双腿顺序、成交确认和订单绑定为准；不将竞品页面的“锁定利润”直接转成交易规则。

## changmen 应保留和暂停什么

| 决策点 | 本轮结论 | 理由 |
| --- | --- | --- |
| 公共簿与动态预检分离 | 保留 | 与成熟数据引擎分层一致；深度、展示、模拟不应各自持有第二条行情连接 |
| 同资产按顺序处理、资产级失效与代次 | 保留 | 可以在不改变原报价的条件下隔离可定位故障，旧证明不能复活 |
| Worker 与有界消息桥 | 保留当前实现，停止无根因的进一步微调 | 浏览器隔离需要，但不解决上游快照恢复缺口 |
| 动态 60s 快照、1s 接收、20ms 读等门槛 | 本次不改 | 是当前业务策略，不是 PM 官方保证；不能为提高比例放宽，也不能误认为展示簿必须按它清空 |
| 补快照/资产重订阅 | 只列设计缺口，不暗中加入 | 要由原行情网络持有者统一处理；属于会影响共享订阅的独立变更 |
| 导入整套 CCXT/Nautilus 或迁移到后端 | 本次不做 | 与双端分工、浏览器采集、现有 FOK 边界不匹配，改动面远大于当前问题 |
| 真实 WS 本地预检 | 继续 NO-GO | 缺恢复和完整性证据，行情可用率不是双腿成交证据 |
| 小范围生产旁路 | 以当前固定构建的浏览器审计单独判定 | 技术可观察性与替换实际 HTTP 是两种不同能力；研究本身不授权发布 |

Chrome 官方将 [hidden、frozen、discarded](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) 区分为不同状态。浏览器内 Worker 的本次 hidden 验证不能证明页面冻结、丢弃或机器休眠后仍保持连续交易行情；不借鉴服务端/桌面项目就作出这样的承诺。

## 收敛验证，避免循环试错

1. **先固定契约和版本**：网络/恢复持有者、逐资产状态转换、快照来源、元数据来源与年龄、执行来源；每份结论标明构建及源码哈希。
2. **固定回放作主要回归**：保存真实原始流、原接收顺序、资产集合、故障位置和预期状态；归并、失效、代次及元数据问题优先用同输入重放定位，不用每轮随机市场替代因果证据。
3. **只做一轮有时限的浏览器验收**：协议/架构无变更时不重复完整构建与长期实测。本轮已开始的冷/晚接入观察继续完成，之后只补既定的隔离、报价回放、资源和 HTTP/经典检查；无生产源码修改，不另起优化循环。
4. **将分母分清**：退休旧名单单独保留；新发现名单在一轮内不换；新鲜完整快照、动态候选、HTTP 业务结果、真实双腿成交分别统计。市场结束、单边、缺参数和迟接入都不能筛掉。
5. **通过只证明该层能力**：零报价差异可支持原行情输出隔离；旁路稳定可支持有限取证；两者都不证明真实预检已提速或 FOK 成交率提升。任何结论变化必须指出版本、输入或验收项变化，不能只改“GO/NO-GO”标题。

研究没有触及默认开关、用户预检选择、经典自动准备、价格/金额/深度、双腿顺序、单次提交、成交确认、补单及订单绑定。生产发布和实际 WS 执行均未实施。

10 份公开源码已固定提交与 SHA-256，见 [来源快照](./audits/pm-order-book-external-sources-20261017.json)。这是一次架构研究，未执行这些项目的代码；不声称完成它们的安全审计或实盘性能复现。
