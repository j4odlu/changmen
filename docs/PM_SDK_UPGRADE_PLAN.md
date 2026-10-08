# PM SDK 分阶段升级方案

日期：2026-10-07。状态：阶段二至四代码已实施并进行回归；统一 SDK 下单保持评估阶段。2026-10-08 按用户要求恢复 BUY 提交异常的普通失败/重试语义，见下述修订；其余实施与发布记录见文末。

## 2026-10-08 BUY 异常路径回退

[changmen 扩展] 用户明确要求恢复“提交异常返回普通失败，进入既有失败／重试判断”。新的 BUY 提交使用 `guardedPmSubmit` 的 `buyFailurePolicy=retry` 分支，仅保留发送期间互斥及等待后的最终价格/会话校验。异常返回 `success=false`、`pending=false`，不附本地哈希作为 orderId，不创建 `submit_unknown` 记录或同资产的持久重发阻断。缺失有效受理回执的响应也按既有失败路径返回；下一次执行仍须重新预检、签名，已消费的报价不能重复提交。

有效订单 ID 和受理回执继续走原有成交/delayed 核验及 BUY 超时退出策略。已受理后的辅助处理异常不能覆盖真实受理结果。SDK 1.2.0、Builder、买卖签名参数和本地/VPS 下单选项保持。SELL 防重复卖出及历史 BUY 记录的恢复查询保留；历史记录不再阻断新的 BUY，本次不清除浏览器记录或修改历史订单。

该策略恢复的是业务失败与重试判断，不代表网络异常已证明官方未受理；原单迟到成交仍可能与重试形成重复敞口。下文阶段二的“无 ACK BUY 始终阻断重发”属于此次修订前的行为，SELL 与历史恢复仍沿用其证据核验规则。本次仅修改代码并做离线回归，发布另行进行。

回归结果：修改前新增的 6 个 adapter 用例复现持续待确认或旧记录阻断；修改后完整前端 409 个测试文件、2920 项通过，1 文件/1 项跳过；`typecheck:frontend`、`test:checks`（按本次 PM 范围设置 `ALLOW_ESPORT_TOUCH=1`）通过。覆盖本地/VPS 的超时、断网、异常响应后重新预检重试，顺序/并行双腿失败后的既有重试与补单，已消费报价不可复用、等待互斥后的 tick 重验、历史 BUY 恢复记录不阻断新买入，以及 SELL 未知提交仍阻断重复卖出。日志位于 `output/pm-buy-failure-rollback-{before,focused,frontend,typecheck,checks}.log`。以上为模拟和静态验证，未进行真实下单或部署。

提交前复查：补充发送异常后临时互斥释放、存储不可写不阻断 BUY、受理后的辅助处理异常保留真实成交回执两项回归；定向 176 项通过。仅纳入此次 6 个文件的干净检出中，全量前端 409 文件/2913 项通过、1 文件/1 项跳过，`app:build`（含 vue-tsc）、边界及 adapter 检查通过。首轮测试与构建并行时两项已有用例触发 5 秒超时，构建结束后以 `--maxWorkers=4` 重跑全量通过，未提高测试超时。干净检出数量较混合工作区少，是未纳入其他正在修改的测试所致。日志见 `output/pm-buy-failure-review-{clean-tests,clean-tests-serial,clean-build}.log`。

[changmen 扩展] 本次升级围绕 changmen 已有的 Deposit Wallet 下单业务，先补齐提交结果判断和买卖协议一致性，再升级 CLOB SDK，最后评估统一 SDK 的下单迁移。各阶段独立验收、独立发布；统一 SDK 迁移不作为前面修复的前置条件。

## 业务范围和既定约束

仅支持 Deposit Wallet，钱包签名类型固定为 `signatureType=3`。不增加 EOA、Proxy、Safe 的产品支持，也不重新生成现有钱包、替换 funder 或批量重建 API 凭证。共享底层保留的兼容分支不代表业务支持所有钱包，本次不顺带删除这些历史分支。

保持以下业务契约：

- 买卖使用 FOK；买单按当前金额和费用口径下单，卖单按份额下单。冻结限价、价格缓冲、精度、最小份额和盘口检查继续生效。
- 用户选择本地时由浏览器提交，选择 VPS 时经服务器转发。POST 结果不确定时不自动换通道重发；读取请求沿用既有路由。
- Builder code 必须进入最终签名订单，买卖、本地和 VPS 四种组合均验证。订单归因不等同于已经核验官方返佣到账。
- 保持玩家归属校验、本机钱包仓、会话失效检查、订单 Link、卖出回款和盈亏归账逻辑。
- 保持现有 `Client_*` / `API_*` 调用形状和账号读写时序。新增 PM 提交状态通过兼容扩展接入，不能改变其他场馆的失败、补单和统计规则。

现有买入核验退出策略单独保留：[PM 延迟订单核验修复](./PM_PENDING_CONFIRM_REPAIR.md) 明确记录，已有官方受理证据及原单 ID 的买入腿在核验耗尽且没有已知成交证据时，通过 `applyPolymarketBuyTimeoutPolicy()` 按本地策略退出待确认，进入既有补单判断。该策略不是官方拒单，手动卖出不适用。本次 SDK 升级不自动改变它；若以后调整，作为单独的业务策略变更处理。本地算出的签名订单哈希不属于受理证据，不能仅将它填入 orderId 就启用这个策略。

## 升级前接入基线和问题证据

| 项目 | 实施前工作区状态 | 升级处理 |
| --- | --- | --- |
| `@polymarket/client` | 三个消费者固定为 `0.12.0`，核对日为 npm 最新稳定版 | 保持版本，承担现有 Deposit Wallet 准备和授权 |
| `@polymarket/clob-client-v2` | 声明 `^1.1.0`，当前锁文件和安装为 `1.1.0`；最新稳定版 `1.2.0` | 独立升级到明确版本并同步锁文件 |
| BUY 签名 | `pmOrderClientCache.ts` 使用低层 `OrderBuilder`；`bet.ts` 根据 book.version 选择签名域版本 | 保持已完成的缓存和纯本地签名优化 |
| 手动 SELL 签名 | `pmManualSell.ts` 创建高层 `ClobClient`，固定 `cachedVersion=2` 并填充内部缓存 | 与 BUY 共用经过验证的市场参数和低层签名流程 |
| 提交异常 | BUY 外层 catch 返回普通失败；SELL 未取得 ID 时返回 `unfilled=true` | 区分提交前失败、明确拒绝和提交结果不确定 |
| 既有 delayed 核验 | 已有用户 WS、REST 核验、刷新恢复及买入超时策略 | 复用现有链路，避免重写已修复的行为 |
| 原单金额恢复 | 已有 `PmSubmission`、`Pm_GetSubmission`、补单队列中的原单微单位金额快照 | 复用已受理 BUY 的快照，新增未知提交记录与之区分 |
| Data API v2 | 已有迁移和验证记录 | 保持现有迁移，不重复纳入 SDK 更换 |

源码入口均位于 `packages/venue-adapter/polymarket/`，主要包括 `bet.ts`、`pmManualSell.ts`、`pmOrderClientCache.ts`、`pmClientApi.ts`、`pmTransport.ts`、`orderStatus.ts`、`orderSettlement.ts`。前端接入入口包括 `client/web/src/stores/account/betGateway.ts` 和 `client/web/src/stores/account/pmManualSell.ts`。

钱包类型和签名域版本是独立参数。Deposit Wallet 的 `signatureType` 始终为 3；CTF 普通和负风险市场的交易签名域版本为 2，book 返回 `version: "v2"` 的新协议市场对应签名域版本 3。[官方下单说明](https://docs.polymarket.com/trading/place-orders)

SELL 固定签名域 2 是条件性兼容风险：实际业务市场均为 CTF 时不会触发。实施前应确认业务资产和盘口分布，不能仅凭代码差异宣称线上卖单已经失败，也不能把 BUY 的签名域分支当作整个新协议接入已经完成。

## 阶段一 建立升级基线

先固定当前工作区的 PM 改动范围与构建版本，区分已提交、未提交、已部署和浏览器已加载的版本。当前工作区还包含非 PM 改动，实施和回滚都只处理本次范围。

完成以下只读核对：

1. 盘点 PM 的买入、手动卖出、查询、钱包准备、授权、费用和订单同步入口，确认三个 workspace 的依赖和锁文件一致。
2. 按电竞、体育业务分别采样现有资产的 ID、book.version、neg_risk、tick_size；核对资产来源是 tokenId 还是 positionId。复核所需合约 spender 和已有授权，不发起授权交易。
3. 整理明确成交、明确 FOK 拒绝、delayed、HTTP 超时、断网、刷新恢复样本，记录其真实判断依据。日志只记录白名单字段，不保存私钥、API secret、HMAC、完整签名或凭证正文。
4. 按本地/VPS、买入/卖出、冷/热准备和响应状态分组，记录预检到提交、签名、POST 到 ACK、ACK 后成交确认的 P50/P95、样本量和错误率。链上结算和交易哈希补齐单独计时，避免归入官网 HTTP ACK。当前 `pmSubmitOrder()` 返回前仍 await 交易哈希补齐，其耗时包含在调用者的 submit 计时中；3 秒循环预算不能中止已挂起的单次读取。因此必须在原始 HTTP 返回处记录 ACK，不能直接把现有 submit 指标当作纯 HTTP 耗时，也不能将预算标注视为严格时限。

交付：接入清单、脱敏样本、当前回归结果、市场与授权检查表、性能基线。若缺乏真实网络样本，将该指标标为待观察，不能用 mock 耗时充当生产 SLA。

## 阶段二 修复提交结果不确定的处理

SDK 版本暂时保持不变，先让 BUY 和 SELL 使用一致的提交结果分类。

| 情况 | 判断 | 后续行为 |
| --- | --- | --- |
| 预检、签名、校时或会话检查失败，确定未发起 POST | 提交前失败 | 按现有入口重新预检，不生成已提交拒单 |
| 收到官方明确拒绝回执 | 明确拒绝 | 保留拒绝证据，进入既有业务处理 |
| 收到有效订单 ID 和受理回执 | 已受理 | 进入现有成交或 delayed 核验 |
| 已发起 POST，但超时、断网、代理中断或返回无法解释的响应 | 提交结果待确认 | 跟踪原提交身份，不直接判未成交，不自动新签名或换路由补发 |

官方明确返回 `order timed out` 表示入簿前拒绝，可按明确拒绝处理；浏览器超时、VPS 代理超时和普通未知 5xx 不能据此推断原单未受理。[官方错误码](https://docs.polymarket.com/resources/error-codes)

实施内容：

1. 在统一提交入口记录稳定 attemptId、所属用户/账号、钱包会话标识、funder、资产、方向、Link 或父买单、原提交时间、路由和金额/份额。同一业务操作的重复点击/刷新应关联同一尝试，不能每次生成新 UUID 绕过阻断；新一轮获准下注、加仓或正常补单使用新身份，不能永久锁住同一个市场。
2. 分开保存 `localOrderHash`、官方 `acceptedOrderId` 和 `acceptanceEvidence`。本地订单哈希只用于精确查找，须按实际 Exchange 签名域计算，不能用 JSON 字符串哈希、链上交易哈希或 Deposit Wallet 包装签名的哈希冒充订单 ID。对比现有脱敏真实 ACK 的 orderID，验证一致后才能用于恢复查询；收到对应官方订单或成交证据后才转入已有受理流程。
3. POST 前 await 本地最小恢复记录成功写入，记录不含凭证和完整可重放签名。按用户、账号、网关和钱包会话隔离；切换用户不能续查另一用户记录。保留原始提交时间，不使用 saveLog 可能重写的 beginTime 或刷新时间替代；BUY 使用实际签名 makerAmount 的微单位金额，SELL 保存原始份额和父买单，不用现价或当前计划人民币金额重算。
4. 本机阻断分为 prepared、dispatching、submit_unknown、accepted 和 terminal。签名/预检失败且确定没有进入发送阶段时释放；在调用可能发送的 transport 前先持久化 dispatching，之后崩溃一律按不确定恢复，不能依靠租约超时猜测未发送。原始 ACK 到达即保存证据；交易哈希补齐、日志、订单落库或 UI 回调失败不得把已经受理的订单改成提交失败。
5. 采用跨标签页的原子互斥和可恢复记录，分别验证刷新、关闭重开和存储不可用。BUY 以一次业务尝试阻断重复提交，SELL 以父买单阻断重复卖出；同钱包资产存在多笔在途卖单时维护份额预留，避免不同父买单重复消费同一份仓位。不因单个未知操作锁住同账号全部正常市场，也不重新读取剩余份额后重发原卖单。
6. 账号用户 WS 和订单/成交 REST 按原身份核验。ACK 前事件、ACK 迟到、WS 断线补查、分页和取消成交竞争复用已有机制。查空、404、读取报错、单条 trade FAILED 或单次等待结束不单独证明原单未成交。提交前失败必须有发送阶段证据；官方拒绝必须有可归属原请求的上游回执，不能凭错误字符串中的 timeout/500 推断。
7. 为 `submit_unknown` 增加 PM 专用状态和无 ACK 的恢复任务。现有 `BetResult.pending` 含义是已受理待确认，不能把未知提交伪装成 success=true；仅设 pending=true 且 success=false 也不够，因为现有 place 状态先判断 success，恢复队列也要求 orderId。新状态贯穿 adapter、手动下注、套利 place/settle/finalize、即时换腿重试、补单队列和卖出 closing；其他平台沿用原行为。
8. 日志区分 `official_reject`、`submit_unknown` 和 `timeout_policy`。未知提交不能落成 api_failed/unfilled 正式 Reject，不计成交成功、成功音效或成功占位，不能绑定同账号最新的另一张订单。收到官方受理证据后进入原核验流程，保留已授权的 BUY 超时退出策略；任何已知成交证据不得被覆盖成拒单。

必须覆盖的编排边界：

- 顺序下注的第一腿为未知提交时，不伪造 success 来触发第二腿；先保留本轮第二腿未提交的事实，确认原腿成交后按现有补单条件处理。
- 并行下注的一腿已成交、另一腿提交未知时，已成交腿仍正常落库，未知腿继续核验，不能立即 anyOdds 换平台重试该未知方向。
- 已受理 delayed 锚腿和明确失败目标腿的既有即时重试行为保持；不能把 submit_unknown 的阻断扩大到全部 pending 或所有场馆。
- 手动卖出在 POST 前建立尝试记录，无 ACK 也保持父买单 closing；不能依赖现有只保留 sellOrderId 的 sessionStorage 结构，否则刷新后会丢锁。成交 patch 保存失败时维持现有 persistBlocked 防双卖行为，重复恢复保存须幂等。

最小新增入口包括 `packages/client-core/src/models/betResult.ts` 的兼容状态扩展，PM `legOutcome.ts`、原单恢复逻辑，以及前端 `betGateway.ts`、`pmManualSell.ts`、`autoBet/phases/types.ts`、`placeArbLegs.ts`、`settleBothArbLegs.ts`、即时重试和补单消费。已受理 BUY 的金额恢复继续复用 `packages/shared/pm_submission.ts` 和 `Pm_GetSubmission`；不能让该 BUY 快照解析器承担 SELL 或无 ACK 尝试的状态判断。

本阶段的持久化和互斥实现必须测量新增耗时。若存储失败不能建立恢复记录，应在 POST 前明确失败并释放仅预检占位；如果已经可能发送，则保留不确定状态。若无法可靠计算原单哈希，本阶段先完成结果分类及重复提交阻断，恢复查询保持待确认；不能以按金额/时间近似匹配的另一笔成交自动释放阻断。持续未知操作应有人工核对入口，不能既没有恢复任务又永久静默占锁；风险退出策略另行确定，不能假装取得官方拒单。

这个阶段明确改变异常路径：无 ACK 的操作将由普通失败改为待核验，因而可能更晚重试或再次卖出。正常成交、明确拒绝以及已受理 BUY 的超时退出策略保持。拒单率会因未知提交不再错记为拒单而变化，需要单独统计提交未知数量。

验收：模拟“官方接受但 ACK 丢失”时只能存在一次 POST；刷新、重开和多标签页操作不能重复卖出；官方明确拒绝仍能退出；签名前失败不被误标为已提交；已知成交优先；原有 delayed 买入超时退出策略回归通过；无 ACK 状态进入独立恢复任务；前述顺序/并行和重试边界、金额快照及用户隔离全部通过。

## 服务端协调作为独立扩展

服务端持久提交意图及跨设备互斥单独实施和发布，不作为基础 SDK 升级的强制前置条件。基础阶段不增加“本地下单必须等待服务端意图落库”的条件；后台镜像失败不能影响已经取得的官方结果。完成本机及跨标签页恢复不代表已经解决跨设备重复操作。

扩展实现由 backend 和 `@changmen/db` 提供带玩家归属校验的意图状态；定义 prepared 的失效释放、dispatching 之后的未知恢复和终态幂等更新。预检被取消、另一腿预检失败、会话变化时，释放能够证明未提交的占位；发送阶段不确定不能按 TTL 自动解锁。锁的粒度与业务操作/份额预留一致，不能默认串行化账号全部订单。

若预检阶段建立服务端互斥，必须测量新增请求对双腿预检汇合和订单新鲜度的影响。后台异步镜像与服务端强互斥是不同保证；需要强互斥时，只有参与该协议的客户端才能宣称跨设备防重。旧浏览器仍能直接向官网发送，VPS handler 无法拦截这条路径，所以不能声称只部署后端即可获得全局防重。

恢复意图与真实 orders 分开保存，不能生成零金额成交单或拒单占位污染盈亏。状态扩展向后兼容，异步旧事件不能覆盖终态，终态保存和释放顺序须避免先解锁后丢失成交。该扩展完成后再验收跨设备、页面关闭后的跟踪和服务端重启恢复。

## 阶段三 统一 Deposit Wallet 买卖协议处理

让 BUY 和手动 SELL 共用市场参数验证与签名运行时，移除 SELL 对高层 SDK 私有 `cachedVersion`、tick/fee 缓存结构的写入依赖。SELL 参数必须验证资产、盘口结构、最小份额、tick、neg_risk 和 book.version；金额、份额及 FOK 语义保持不变。

市场选择按已核对的业务范围处理：

- CTF 普通市场：签名域 2，使用对应 CTF Exchange。
- CTF 负风险市场：签名域 2，使用对应负风险 Exchange。
- 新协议市场：只有资产来源、positionId、签名域 3、合约授权、余额/仓位读取及卖出核验均验证后，才认为该市场接入完成。
- 不认识的版本或不满足接入条件的资产，在 POST 前给出明确错误；不能猜测合约、资产 ID 或授权。

业务目前没有新协议市场时，先验证 CTF 两类市场的买卖一致性，再用离线样本覆盖新协议分支。是否开放新协议市场按业务范围决定，不由 SDK 版本自动决定。

对 `signatureType=3` 验证 maker/signer 为 Deposit Wallet、EOA 私钥仍对应账号签名者、funder 正确，以及包装签名、Builder、tokenId/positionId、金额精度和 verifyingContract。签名期间账号、钱包会话、路由或 tick 改变时沿用当前失效检查。

验收：固定 salt 和 timestamp 的同输入离线对比通过；无法固定随机字段时，逐项比较订单金额和域，并分别对实际原始签名进行验证，不能修改字段后把不同签名规范化成相等。覆盖 BUY/SELL、CTF 普通/负风险、新协议样本、各受支持 tick、最小量边界、会话变更和 Builder 非零值。Deposit Wallet 要验证 ERC-7739 包装、内层签名和实际 funder 绑定，不能只执行 EOA 的 verifyTypedData 或只比较两个 SDK 输出。已准备完成后的签名不新增隐式网络查询。

## 阶段四 升级 CLOB SDK 到 1.2.0

将 `client/web`、`packages/venue-adapter`、`server/backend` 的 `@polymarket/clob-client-v2` 同步固定到 `1.2.0`，更新根锁文件并检查实际解析版本。`@polymarket/client` 保持 `0.12.0`。以实施时再次核对的稳定版本为准，不追随 canary 或混入无关依赖更新。

官方 1.2.0 包含 positionID 选择 Exchange V3、tokenID/positionID 互斥检查、元数据请求合并以及版本不匹配时的一次 create-and-post 重试。[官方发布说明](https://github.com/Polymarket/clob-client-v2/releases/tag/v1.2.0)

升级审查重点：

- 对照 1.1.0/1.2.0 的低层 OrderBuilder 入参、签名、序列化、市场版本和舍入结果；检查新校验是否适用于当前低层入口。
- 确认本项目仍通过统一 transport 提交，不因 SDK 高层 create-and-post 引入隐式重发。新 SDK 的版本拒绝重试不等于允许对网络超时重试。
- 已有纯本地签名并不自动受益于高层元数据预热；通过测量验证速度，不能仅凭发布说明宣称下单提速。
- Browser 和 Node 两端均验证导出、加载和构建，保持 Builder 和既有交易哈希补齐逻辑。

交付：依赖和锁文件变更、版本差异检查、离线签单对比、前后性能数据。本阶段不要同时调整 HTTP 30 秒预算、延迟核验窗口或费用口径，以便独立定位回归。

## 阶段五 评估并迁移统一 SDK 下单

钱包准备继续使用现有 unified SDK。下单迁移先实现可替换的 PM 签名适配层，分别验证 `createMarketOrder` 与签名订单的提交格式，不直接用高层 `placeMarketOrder` 覆盖本地/VPS 分流。

官方支持先签名后提交，同时迁移改变 assetId、响应模型及 maxSpend 的含义。[官方迁移指南](https://docs.polymarket.com/migrate/clob-sdk-to-unified-sdk)

迁移必须逐项满足：

1. CTF tokenId 与新协议 positionId 正确映射为 assetId；Deposit Wallet 和现有 API 凭证绑定保持一致。下单客户端显式绑定现有 funder 和凭证，验证返回账号钱包一致；不能照搬钱包初始化中省略 wallet 的部署流程，也不能在每笔下单时创建凭证或执行 setupTradingApprovals。
2. BUY 的 amount 延续当前名义买入金额口径。不能无条件令 maxSpend=amount，导致 SDK 将手续费计入预算并减少实际买入份额；SELL 继续使用 shares。
3. FOK、限价、精度、订单 ID、matched/delayed、错误和 tradeIDs 均映射回现有内部契约。SDK 的 ok/orderId 与原 API 的 success/orderID 在一个明确入口转换。当前安装的 0.12.0 SignedOrder 含 orderType、postOnly、salt 字符串及类型化 signature；不能直接复用 clob.orderToJsonV2 或仅替换字段名。用官方 public API 的实际请求序列化对比验证 wire body，包括 side、signature 和 owner 等字段；验证无法完成时保留当前下单 SDK。
4. 预检准备阶段可以提前加载需要的元数据；从预检通过到开始提交之间不能无依据加入额外的公开查询、钱包部署或授权请求。SDK 无法满足现有热路径约束时保留低层签名方案。
5. 签名后的准确订单正文继续由既有 transport 发送，本地和 VPS 使用对应校时与 HMAC；校验正文和最终发送一致。对 SDK 支持的序列化/transport 扩展能力先做离线验证，不依赖私有字段或臆造接口。
6. Builder code 保持进入最终订单。Builder 远程授权仍用于现有钱包操作，Builder secret 不进入浏览器；保持订单归因字段与 relayer 鉴权职责的区分。
7. 未确认提交恢复记录跨新旧签名适配层仍能被读取和跟踪。只切换下一次新提交，不能借切换 SDK 重签并重发在途订单。

验收通过后按现有测试账号和发布流程逐步切换。需要交易级验证时安排独立的实际买卖验收；本方案的编写与离线验证不包含真实交易。旧 CLOB 依赖在消费者全部迁移且回退观察完成后才删除。只读查询的统一 SDK 迁移另行评估，不与下注切换绑定。

## 回归测试和发布验收

| 场景 | 必须满足的结果 |
| --- | --- |
| 本地/VPS × BUY/SELL | 路由符合配置，Builder 字段和签名正文一致，无隐式第二次 POST |
| accepted 但 ACK 丢失 | 保留原提交身份并核验，不立即生成重复订单 |
| 本地哈希存在但无官方受理证据 | 不能触发已有 delayed BUY 的超时策略或伪造受理 |
| 顺序首腿未知、并行目标腿未知 | 不误发第二腿、不 anyOdds 重试未知方向；已成交腿照常保存 |
| 已受理 delayed 锚腿和明确失败目标腿 | 保持原有即时重试和补单门槛，不扩大未知状态的阻断 |
| 成交事件早于 ACK 或晚于超时 | 命中原单，成交证据不被错误覆盖 |
| 明确拒绝与提交前失败 | 分类正确，保留原有正常补单/重预检行为 |
| delayed BUY | 市场延迟、WS/REST 和已授权买入超时退出策略保持 |
| SELL 待核验、刷新、多标签页 | 持续阻断同一父买单的重复卖出，确认后恢复 |
| 预检取消、另一腿预检失败、存储失败 | 确定未发送时释放占位；可能已发送时进入恢复 |
| 多父买单卖同一资产、成交落库失败 | 份额预留不重叠，保留 persistBlocked，幂等保存后释放 |
| 查询失败、查空、404、分页未完成 | 与官方明确零成交终态区分，不借其他订单解除待确认 |
| 账号、钥匙、funder、路由、tick 在签名期间变化 | 提交前失效，无错误账号或错误路由订单 |
| 费用、余额、卖出回款、跨日 Link、盈亏聚合 | 口径和现有记录一致，不双计、不减漏份额 |
| 本机尝试和既有原单金额恢复 | 用户隔离、原始时间、微单位金额、关闭重开及旧记录兼容通过 |
| 服务端协调扩展 | 启用该扩展时单独验收跨设备互斥、准备占位释放、旧事件及重启恢复 |
| unified 客户端与 wire body | 不部署/换钱包、不重建凭证、不隐藏重发，FOK/签名/正文契约一致 |

实现每阶段先运行相关 PM 回归，涉及前端至少执行 `npm run typecheck:frontend` 或 `npm run app:build`；阶段发布前执行 `npm run test:frontend`、`npm run check:boundaries`、adapter 导出/导入检查。触及后端时增加 PM handler、订单存储及归属校验回归，依赖/跨端变更完成后执行 `npm test` 和生产构建。PM 冻结路径仅在明确范围内显式放行，不能修改冻结清单绕过检查。

性能按相同路由、业务类型、冷/热状态和时间段比较，并报告样本量。本方案采用的建议发布门槛为：同环境离线热路径不新增网络请求；样本足够的线上 P95 若增加超过基线 10% 或 50ms 中的较大值，暂停扩大发布并定位。该数值是项目验收建议，不是官方 SLA，也不以牺牲订单判断为代价压低延迟。

30 秒 HTTP 等待预算先保持。另行根据本地/VPS 实测、代理中止预算及尾部延迟评估；提交超时、官方 delayed 撮合和链上结算等待分别计时与处理，不能统一成一个超时参数。

## 发布顺序和回滚

实施拆为可单独审查的变更：基线与回归样本 → 提交不确定的分类和本机恢复 → Deposit Wallet 买卖参数一致性 → CLOB 1.2.0 → unified 签名适配与验证 → 分步切换和依赖清理。服务端协调扩展独立安排。

每次发布先检查已有待核验任务，再只对新提交生效。当前升级不自动部署；上线遵循仓库生产发布流程。

SDK 回退只替换新提交的签名适配层及对应依赖/锁文件，保留已验证的结果分类、提交互斥和恢复记录。后端新增状态先兼容旧客户端，回退期间不删除恢复记录或用旧 bundle 解除待确认阻断。若旧版本不能正确读取新状态，停止新提交并继续只读核验后再恢复服务。

出现重复 POST、错误钱包/合约签名、Builder 缺失、金额口径变化、订单 Link 或盈亏错误时停止扩大发布，优先保护在途订单；不得通过直接将待确认改为未成交来完成回滚。

## 阶段完成标准

阶段二至四完成后，可交付一个保留已受理买入策略、改进无 ACK 异常路径、统一 Deposit Wallet 买卖签名并使用 CLOB 1.2.0 的版本。阶段二完成要求 BUY 和 SELL 的所有入口均可跟踪未知提交，不能只修改 transport 或 adapter 就发布。跨设备和页面关闭后的服务端跟踪以独立扩展的验收为准。阶段五只有在路由、金额、Builder、恢复和性能全部通过时完成；尚未迁移的高层 SDK 能力不影响前面阶段独立交付。

本方案不宣称升级版本会自动降低官网处理时间，也不宣称离线测试证明真实 Builder 返佣到账。实际成交、归因和性能以发布后的对应证据验收。

## 方案复查结果

2026-10-07 源码对照复查发现的设计缺口已在方案中修正；下表保留方案审查记录，具体实施状态见文末。

| 缺口 | 若直接按初稿实施的影响 | 修正 |
| --- | --- | --- |
| 把本地订单哈希视作已受理原单 ID | 未收到 ACK 也可能套用 BUY 超时策略并补单 | 分离 localOrderHash、acceptedOrderId 和受理证据 |
| 只修改 adapter 的 pending/失败结果 | 套利 anyOdds 重试仍发生，或伪造 success 误发顺序第二腿 | 新状态贯穿所有编排入口，保留既有 delayed 策略 |
| 未覆盖无订单号的恢复结构 | 现有队列和卖出 closing 刷新后丢掉未知提交 | 增加 attemptId 恢复，复用既有已受理快照 |
| 预检服务端互斥未定义生命周期 | 取消预检遗留占位，新增本地下单依赖和延迟 | 独立扩展，区分确定未发出和可能已发出，限定锁范围 |
| 恢复金额和时间约束不足 | 补单金额、查询时间窗或卖出份额漂移 | 保留原签名 makerAmount、SELL 份额和不可变 submittedAt |
| submit 指标包含 ACK 后补齐 | 将补齐耗时误判成官网受理慢 | 原始 HTTP 返回记录 ACK，补齐及单次超时另行验证 |
| unified 订单可直接接旧序列化的假设 | side、signature、owner 或 FOK wire body 不兼容 | 比较官方真实序列化，显式绑定现有钱包和凭证 |
| 随机字段规范化及 Deposit Wallet 验签不足 | 对照相等但实际钱包包装签名错误 | 保留原签名验证，单独检查 ERC-7739 和 funder |

原行为基线回归：12 个相关测试文件、115 项测试通过，覆盖买入超时策略、PM 收尾、卖出终态、交易哈希补齐、套利 place 类型、即时重试及补单配对。该结果属于实施前基线，新状态验证见下面的实施记录。

## 2026-10-07 实施记录

[changmen 扩展] 当前工作区完成第一批代码升级：

- 三个 workspace 和根锁文件固定 `@polymarket/clob-client-v2@1.2.0`；锁文件没有顺带更新其他包。`@polymarket/client@0.12.0` 保持。
- BUY/SELL 共用盘口资产、版本、负风险、最小量和 tick 校验；SELL 改用缓存的低层 OrderBuilder，删除高层 SDK 的私有缓存修改，按盘口选择签名域 2/3。金额、FOK、Builder 和本地/VPS 路由保持既有契约。
- 官方 `success=true + orderID` 是受理证据；`unmatched` 或暂缺成交数量继续待确认。无 ACK 时 `success=false`、`pmSubmitUnknown=true`，本地哈希仅用于查询。套利首腿未知不发顺序第二腿，未知目标腿不进入 anyOdds 换腿；普通明确失败保留重试。
- `pmSubmitJournal.ts` 在发送前保存 dispatching；用户/账号/gateway/签名者/funder 隔离，无私钥、secret、HMAC 或完整签名。更新 API Key 不解除同钱包未决记录。Web Locks 保证同浏览器跨标签页互斥，持久化失败在 POST 前中止。
- BUY 未知提交按资产阻断；不同 Link 的新尝试明确报告本次未发送，避免把旧订单归到新套利。SELL 按资产串行保留至官方未成交或成交归账完成，防止多个父买单共用余额重复卖出；其他资产仍可执行。这是份额预留的保守实现，并非同时卖同资产多个父单。
- 原始提交时间和 BUY makerAmount 微单位随 `PmSubmission` 恢复，未知标志不会因刷新变成受理。原单 WS/REST/精确成交证据取得后才进入既有已受理 BUY 策略；404、查空和读取失败不解除未知状态。
- 账号加载恢复持久化 BUY 记录；卖出从持久化记录恢复父单 closing。套利/补单恢复监视不重复手动成功计数。现有套利队列仍负责配对与补腿；若页面在配对状态落盘前关闭，最低恢复记录负责跟踪原单，不能凭它推断另一腿状态或自动创建新的配对。
- 原始 HTTP 返回记录为 `submit_ack`；原 `submit` 仍包含后续处理。交易哈希补齐以单调时钟限制最多 3 秒等待，挂起的查询不会无限拉长该等待，也不会覆盖已获 ACK。
- 官方 JSON 的明确 4xx 拒绝及文档指定的 500 `order timed out` 保留拒绝证据；408、其他 5xx 和断网保留未知。服务端在调用 fetch 前发现时钟/鉴权错误时使用 `pmSubmitNotSent`，不把未发送误记成拒单。

统一 SDK 下单尚未切换。对实际安装的官方 0.12.0 源码（发布包 source map）核对：`createSecureClient` 校验凭证、检查钱包部署状态，并可能进入钱包部署流程；带保护价的 `createMarketOrder` 仍使用私有市场元数据缓存，缓存 10 分钟失效后查询 condition/market。直接替换当前提交时签名入口会增加准备请求。官方 public `prepareMarketOrder` 支持先推进 workflow 到签名请求、再本地签名，因此后续可以将这些查询放进预检；本轮尚未完成该 workflow 与冻结报价、金额变更及官方 POST 序列化的全部对照验收。按阶段五门槛，保留已验证的低层 CLOB 签名路径；不存在仅因升级到 1.2.0 就必须同时切换全部接口的结论。

离线验证覆盖 432 组 BUY/SELL 签名向量，包括 Deposit Wallet 的 ERC7739 内层签名、maker/signer/funder、三个签名域路由、六种 tick、三组金额、Builder、订单哈希与 SDK 实际 TypedData 相等，签名期间零 HTTP。新增覆盖 ACK 丢失、存储失败、跨标签页互斥、会话失效、未知腿不重试、不绑本地哈希、卖出原单恢复和官方拒绝分类。

真实业务市场/授权采样、生产 P50/P95、真实成交、官方 Builder 返佣和跨设备互斥均未用离线结果代替；发布前仍需相应验收。浏览器持久化恢复要求同一浏览器配置文件和支持 Web Locks 的安全上下文；不具备互斥能力时在发送前报告错误。

最终本机验证：`npm test` 的 13 个任务全部成功，包含边界、adapter 导出/导入、客户端共享包检查；前端 2690 项通过、1 项跳过，后端 318 项通过、16 项跳过，matcher 188 项通过。`npm run app:build`（含 vue-tsc）成功；保留已有大 chunk 提示。`npm ls` 确认三个消费者实际解析 CLOB 1.2.0、unified 0.12.0。测试日志位于 `output/pm-sdk-full-tests.log`，构建日志位于 `output/pm-sdk-build.log`。这些结果证明本机回归通过，未部署且未进行真实下单。

## 2026-10-07 实施后全面复查

[changmen 扩展] 本轮检查 SDK 升级、本地/VPS 提交、买卖状态、套利重试与补单、刷新恢复、归账和会话切换。检查发现实际缺口，已修复；不能用实施前的全绿测试证明没有边界错误。

| 问题 | 业务影响 | 修复与验证 |
| --- | --- | --- |
| 未知提交恢复只返回是否受理，丢掉已查到的成交证据 | 后续查询为空时可能按 BUY 超时策略判拒，造成补单重复敞口 | 已先用回归复现错误的 unfilled；现在传递并持久化公开成交证据，BUY 数量矛盾保持待确认；SELL 的确认份额和回款保留至归账完成 |
| 卖出落库失败后，乐观 closed 行被当成落库成功 | 提前清 closing 和提交记录；部分平仓恢复还可能重复计提同一笔卖出 | 保存原始待落库补丁，刷新后优先幂等重放，不按乐观行重新算盈亏；按精确卖单事件确认已归账，其他卖单关闭父单不能释放本次锁 |
| 恢复任务只有 accountId/父单号，没有用户和钱包绑定；等待期间会话可以改变 | 旧任务可能在新会话查询、保存或触发成功计数 | 任务保存用户/钱包 scope；提交取得 Web Lock 后再次校验；手动、失败减仓和锁利卖出在回调、落库与解除锁前核对会话；已补恢复及会话竞争回归 |
| 同资产未决 BUY 只比较双方都有值的 Link | 手动旧单可能被新套利或不同金额的请求采用，错误绑定本金、Link | 同时核对 Link（包括无 Link）、比赛、盘口、资产、方向和金额；不同业务请求在 POST 前阻断，只继续原单恢复 |
| 新持久化恢复与旧 session 任务同时存在 | 同一原单可能开启两个确认任务；旧任务还可能遗失 unknown 标记 | 按原单迁移并去重，使用 journal 的原时间、makerAmount、未知标记和业务恢复字段 |
| 明确停盘 503 未识别、重复订单错误或畸形响应被误分类 | 明确未受理单长时间被锁；已有原单或无有效 ACK 的请求可能被当成可重试失败 | 共享拒绝分类补入官方明确停盘/仅可撤单/仅 post-only 回执；重复错误及畸形 ID/error 字段保留未知；普通 5xx/网络超时仍保持未知 |

官方拒绝分类依据：[Error Codes](https://docs.polymarket.com/resources/error-codes)。其中官方 500 `order timed out` 明确表示入簿前拒绝；网络超时不等同该回执。503 的放行采用文档明确说明不受理新订单的具体文本白名单，未把所有 503 都当作拒单。

语义核对：

- 产品仍只支持 Deposit Wallet（signatureType=3）。通用签名兼容分支不代表新增钱包产品支持。
- 默认 VPS，本地选择只改变订单提交出口；BUY/SELL 的 FOK、Builder 字段、限价、微单位本金和费用口径保持。采集开关、其他场馆、A8 账号保存时序与客户端/服务端职责没有因本轮补修改变。
- 已知受理 BUY 的核验耗尽退出策略保持；它是用户授权的本地策略，仍非官方拒单，也没有消除迟到成交造成重复敞口的历史风险。已有成交证据不能被该策略覆盖。SELL 不应用 BUY 超时判拒。
- 无 ACK 的 submit_unknown 不等于拒单；不直接补单、不换出口重发、不用本地哈希绑成已受理单。success+有效 orderID 表示受理，unmatched/暂缺金额继续确认。这些是升级有意修正的状态语义。
- 升级前没有 scope 的会话，优先关联当前钱包的 journal；没有 journal 时，通过已有 Pm_GetSubmission 的服务端账号归属校验及原签名公共 maker 地址迁移。makerAddress 是可选兼容字段，旧快照仍可解析。拿不到原始签名证据或 maker 不匹配时保留记录，不按当前金额猜测恢复，也不自动重发。
- 同资产 SELL 要等原单归账完成才能继续卖其他父单；持久化不可用或浏览器没有安全上下文 Web Locks 时阻断提交。跨浏览器、跨设备互斥、页面关闭后的服务端跟踪及真实 Builder 返佣仍未验收。

本轮验证：前端 2714 项通过、1 项跳过；后端离线 318 项通过、17 项跳过（原有 16 项及另行排除的公网 GET /time）；生产构建、最终 vue-tsc、边界、导出/导入、catalog smoke 和后端 adapter layout 通过。保留已有大 chunk 提示。

完整 npm test 曾因现有公网 GET https://clob.polymarket.com/time 的 5 秒超时失败，独立重跑同样超时；因此本轮不宣称全量 npm test 全绿。随后完整前端回归、后端离线集合和其余检查分别通过，没有删掉该公网测试或改大超时掩盖结果。日志：output/pm-audit-frontend.log、pm-audit-backend-offline.log、pm-audit-backend-recheck.log、pm-audit-build.log、pm-audit-typecheck.log、pm-audit-checks.log。未部署、未真实下单；统一 SDK 订单迁移仍待阶段五验收。

## 发布准备与提交范围（2026-10-07）

[changmen 扩展] 本次发布范围为本地/VPS 下单选项、CLOB 1.2.0 适配、Deposit Wallet 买卖参数统一、提交结果分类及其恢复/归账修复。它包含异常业务行为调整，不是纯依赖升级。POD 跟单展示、历史调查、临时探针、浏览器配置文件和本机日志不随本次提交发布。统一 SDK 0.12.0 的高层下单迁移不在本次范围。

### delayed 与互斥的实际边界

- 有效 ACK 的 delayed BUY 仍是 `success=true,pending=true`。顺序套利继续提交第二腿，另一腿明确失败时保留原有即时换腿重试；成交确认前不能作为普通补单的成功锚腿。已受理 BUY 的核验耗尽退出策略保持，已有成交证据优先；该本地策略仍存在迟到成交风险。
- BUY 的同资产持久化阻断只针对 `dispatching`、`submit_unknown`，不针对已保存 `accepted` 的 delayed BUY。ACK 后存储失败会保留 dispatching，并按未知记录继续核验；不能把这种存储异常说成所有 delayed BUY 都串行。
- SELL 的同资产阻断覆盖 dispatching、submit_unknown 和 accepted，直到原卖单的终态与归账处理完成。确认超时保持 pending，不套用 BUY 判拒策略。
- 无有效 ACK 的提交不能冒充 delayed。原单查询取得受理/成交证据后再进入已受理流程；其间不因超时或查询为空自动补发。
- Web Locks 是当前浏览器下单的必要能力，持久化不可写时发送前中止。这是新增运行约束；HTTPS 部署和支持 Web Locks 的浏览器须在使用前确认。

### 公网冒烟复查

12:21—12:22 的失败是 Vitest 5 秒测试截止；该用例从 Windows 本机调用 GET /time，底层 GET 请求预算为 60 秒，不经生产 VPS。当前 Fake-IP 路径中的同一用例已恢复。随后完整后端 319 项通过、16 项跳过；完整 npm test 的 13 个任务成功，前端 2714 项通过、1 项跳过；与生产构建同时运行时 /time 连接约 246ms、完整响应约 507ms。未改大测试超时。原失败缺少连接阶段日志，无法确定当时是代理、建连还是上游响应延迟。复查日志：output/pm-time-concurrent-test.log、output/pm-time-concurrent-build.log。

### 发布步骤与观察

本机准备本地 commit，由用户自行 push。master 的 push 会同时触发前后端 GHA；前端流水线等待同一提交的后端成功后再发布。依赖由 npm ci 根据锁文件安装，后端生成 router，再进行回归；本轮不需要新增数据库 schema、轮换钱包或 API 凭证。

更新时保留当前浏览器的 localStorage/sessionStorage 恢复数据，勿通过清缓存解除待确认。先确认现有待确认/closing 原单，暂停发起新单后更新页面；旧页面继续持有旧代码，服务器发布不能替换其在内存中的执行逻辑。更新后核对 PM 下单配置、恢复任务和原订单状态，再恢复新下单。页面关闭后的服务端跟踪、跨浏览器/跨设备防重不属于当前保证。

部署后的实际 BUY/SELL、小范围 delayed 样本、真实 Builder 归因/返佣、生产 P50/P95 仍须使用实际业务证据验收。本次准备不执行真实下单、撤单、生产订单修改或部署。出现错误归账、重复提交或错误钱包/金额时暂停新提交，保留原单恢复数据；回滚 bundle 时不能用不识别未知状态的旧客户端直接恢复交易。

### 最终发布前验证

代码提交 `521a78db` 在单独的干净 checkout 中完成 `npm ci`（845 个包）；先执行发布流水线已有的 `compile:router`，再使用与生产相同的 Node 24.19.0 运行完整 `npm test`，13 个任务成功，前端 2706 项通过、1 项跳过，后端 319 项通过、16 项跳过，matcher 188 项通过。前端较混合工作区的 2714 项少 8 项，原因是未纳入 POD 展示改动。无 ACK、会话竞争、旧恢复记录、卖出归账及 Builder/签名向量回归随此次发布代码一起验证。Node 24 的 `app:build`（含 vue-tsc）成功，保留已有大 chunk 提示。

27 项发布范围、版本比较、流水线协调测试通过；WSL Linux 中的 release integration 通过，覆盖激活、旧 chunk 保留、过期 run 拒绝、失败重试、前后端回滚和 storage 隔离。Windows Git Bash 的 flock 不支持该测试的文件描述符场景，因此以 Linux 的成功结果为验收依据，未修改发布脚本规避检查。新 checkout 首次直接 npm test 缺少 gitignored 的 account_client_routes.js；按 CI 顺序生成 router 后全量通过，未把本机旧生成文件纳入 git。

`npm ls` 确认三个消费者均解析 CLOB 1.2.0、unified 0.12.0。HEAD 后端归档约 4.4 MiB，只包含已提交文件；排除本机日志、浏览器配置、历史调查及未提交的 POD 改动。变更分类为 full，未涉及数据库/schema/迁移文件。构建产物包含生产 API 地址 `https://api.changmen.fun`。

生产只读预检：网站 HTTPS 返回 200；实际浏览器处于安全上下文，支持 Web Locks、crypto.randomUUID 和 localStorage 读取，从生产站点浏览器 GET 官方 /time 返回 200。官方 POST /order 的 OPTIONS 返回 204，允许生产 Origin 与所需 POLY_* 请求头；这不代替真实签名 POST 验收。服务器 Node 24.19.0，八个启用进程 online、各为单实例，运行目录属于已有 53114c32 版本；内网后端健康接口返回 200。生产 Caddy 对 API 域名要求客户端证书，本次无证书公网 API TLS 失败符合该配置，不将它误判为后端故障；未改变证书或鉴权设置。上述浏览器能力验证来自独立检查配置，不能代替每位操作者当前浏览器的存储配额、原单状态或持久化记录检查。

证据保留在本机 output/：pm-release-clean-install.log、pm-release-node24-tests.log、pm-release-node24-build.log、pm-release-deploy-tests.log、pm-release-linux-activation-tests.log、pm-release-production-readonly.log。诊断目录不提交。

用户推送已有提交时在仓库根执行 `git push origin master`。当前还保留其他工作区改动；不要通过自动 git add -u 的批处理将它们混入本次发布。此次准备只创建本地提交，不执行 push 或触发部署。
