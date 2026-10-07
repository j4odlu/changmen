# PM 预检优化方案

日期：2026-10-07

状态：第一期代码已实施并通过本地验收；尚未部署或进行真实下单性能验收

范围：Polymarket 买入预检、自动套利提交、手动与补单入口；电竞和体育分别验收。

**预检负责判断能不能下，并确定本笔订单参数；下单负责按这些参数签名和提交。同一轮自动套利两腿预检通过后立即进入下单，PM 下单内部不再查询 Gamma 或重新拉订单簿。**

首批实施删除隐式复检、并行必要公开请求、增加直连失败冷却，并采用纯本地 OrderBuilder 构单，将 VPS 的逐单 `/time` 等待移出提交路径。整体超时沿用现有 `checkTimeout`；移除自动提交路径中以 1500ms 簿年龄触发复检的机制，不用新的 1500ms 整轮拒绝替代它。

新增流程均标记为 **[changmen 扩展]**。它们不是 PM 官方强制流程，也不以 A8 对齐名义引入新的前端门控。

## 第一期实施结果（2026-10-07）

[changmen 扩展] 本轮已完成表中第 1—6 项的代码接入与本地回归。下文的问题描述保留为改造前基线；实时性能基线、生产钱包/资产样本与上线对照仍须在实际环境采集，不能用单元测试耗时替代。

- `bet.ts` 用同一个 BetOption 绑定只读参数和私有内存准备状态；签名前同步消费，重复调用、伪造/复制结果、参数或钱包变更均不重新查询市场。同一对象不能再次预检；新尝试必须新建 BetOption。原 1500ms 分支已经删除。
- 网关保留原计划金额，避免把已换算场馆金额再次当作人民币。执行腿并行准备钱包、runtime、出口时钟和公开查询；9999 自动仅预检腿显式传递 `precheckOnly`，手动入口默认 `execute`。手动、正 EV、跟单和补单现有调用点均为新建 option → check → 提交。
- 三项 guard 请求按需并行、独立结算；公开 GET 只做在途合并并给调用者独立副本。vps/official 直连连续两次网络失败后冷却 30 秒，单探针恢复失败时退避 60/120 秒。`VITE_PM_PUBLIC_ROUTE_COOLDOWN=0` 可关闭冷却；429 等 HTTP 拒绝不触发回退。
- 本地构单改为 SDK 公开 `OrderBuilder`，移除买入路径的零费率占位和固定 SDK 版本缓存。合法 book 省略 version 使用域版本 2，`version="v2"` 使用域版本 3；资产 ID 必须与请求相符，其他版本在预检失败。runtime 使用精确内存凭据键、并发初始化合并和钱包失效代次。
- 新增 `Pm_PrepareSubmit` 契约，由服务端验证账号归属后准备自身时钟，客户端热准备复用最长 120 秒就绪租约。服务端冷校准后每 60 秒后台更新，默认最大样本年龄 300 秒、最大往返 2 秒，分别由 `PM_CLOCK_MAX_AGE_MS` / `PM_CLOCK_MAX_RTT_MS` 配置。墙钟跳变、过期或冷状态不在 POST 中补查。每笔订单仍生成新时间戳和准确正文 HMAC。共用出口的手动卖出已接入准备阶段。
- 六种 tick 已接入；电竞/体育浏览器流先处理 tick 控制事件，两套 Hub 在报价瘦帧和合并前单独转发控制事件。已知变更使冻结限价失效时仅返回本地失败，不改价、不拉簿。
- 保留 Serial/Parallel 与 `checkTimeout=0` 语义。双腿提交前汇总可见的本地准备失败；未新增当前轮次取消机制。订单受理后的 matched/delayed/未知结果确认沿用原实现。

指标已落地 `check`、`pair_check`、`book`（含失败直连等待及回退分段）、分来源 `gamma`、`runtime`、`clock`/`clock_sample`、`sign`、`prepared_wait`、`dispatch`、`serial_wait`、`upstream_auth`、`outbound_prepare`、`upstream_post`。执行与报价各保留 300 条，服务端保留校时样本。零构单网络、零提交前市场补查、零逐单 `/time` 已由请求拦截回归验证；不把写死的零值冒充生产请求计数。

本地验收包括：普通/neg-risk CTF 与新协议 × 4 签名类型 × 6 tick × 3 金额，共 216 组 SDK 签名/正文对照；EOA 域和签名验证；并发重复消费、失败不恢复、钱包失效、未知 book 版本、tick 变化、赛事异常隔离、路由冷却与 429、在途请求副本、校时就绪与正文 HMAC、9999 角色与重复换汇。类型检查、生产构建、客户端/服务端边界和 adapter 检查通过。电竞冻结面按本次明确的 PM 首期范围使用 `ALLOW_ESPORT_TOUCH=1` 放行，未修改冻结清单；quote-hub 契约回归通过。

复审回归结果：PM/编排相关测试 669 项通过、1 项原有跳过；后端与 Hub 相关测试 61 项通过；quote-hub 契约测试 29 项通过。复审后 `vue-tsc -b`、`check:boundaries`、`check:venue-adapter` 和 API 契约检查通过；首期实施时 `app:build` 已通过。

本次代码复审修复以下问题，均已加入回归测试：

- 预检入口即绑定账号 ID、目标、金额、币种、路由与深度配置，防止等待钱包期间的参数变化被记录为已检查。正常钱包解锁补齐私钥仍允许；签名凭据在钱包准备后另行绑定。
- 重复预检同一 option 会使该对象的在途检查失效，先发请求迟到后不能重新写入成功结果。这是重复调用防护，不新增用户取消当前轮次的功能。
- 无论是否有缓存 tick，REST book 自身的 tick 和最小份数字段都必须有效；缓存不能掩盖畸形响应。
- 后台校时网络失败仍按周期继续尝试，失败不会续期旧样本；失败采样也计入诊断记录。
- 扩展明确断连、尚未发出平台 HTTP 时，保留原有同次 VPS 回退：携带客户端当前秒级时间戳，服务端验证账号归属、校验时间戳类型并用所属账号为准确正文重新生成 HMAC。沿用扩展路径的客户端时钟，不调用 `/time`，不将该时间戳写入 VPS 校时缓存。常规 VPS 订单继续要求服务端校时就绪；网络超时或不确定结果不进入此回退。
- 提交收到服务端明确“校时未就绪”后，清除客户端对应就绪租约，使下一次新预检能重新准备；当前订单不自动重发。

构建仍提示已有的大 chunk 警告。尚未进行真实下单、部署、真实网络 P50/P95 对照或生产回退演练。发布需同时更新客户端、后端与两套 Hub；新客户端遇到不支持准备接口的旧后端会在预检失败，不会静默回到提交时补查。第二期完整 WS 深度未实施。

## 部署前最终审查（2026-10-07）

[changmen 扩展] 代码审查和本地发布检查通过，提交前收尾已完成；**待用户 commit、push 后由受审提交生成正式发布包**。本节记录本地审查结果，不代表已核验线上进程、生产钱包或真实下单。

| 检查 | 本次结果 |
|---|---|
| 前端全量 Vitest（含 adapter / client-core） | 391 个文件通过；2,603 项通过，1 项原有跳过 |
| 后端标准 `test:backend` | 收尾后 11 个任务全部成功，其中 10 个使用缓存；backend 包 315 项通过、16 项跳过；PM 专项目录已纳入默认检查，含边界、adapter、client-core、API 契约及 catalog 检查 |
| PM 后端全目录及 Hub 专项 | 13 个文件、92 项通过 |
| quote-hub 契约 | 29 项通过 |
| 生产前端构建 | `app:build` 成功，含 `vue-tsc -b`；仅已有的大 chunk 警告 |
| 后端路由编译 | `compile:router` 成功；生成 JS 包含 `Pm_PrepareSubmit` 分支 |
| SDK / 锁文件 | 安装版本与 lockfile 均为 clob-client-v2 1.1.0；发布脚本采用 `npm ci --include=dev` |
| 差异检查 | `git diff --check` 通过；本轮审查未改动运行时代码 |
| 发布流程单元测试 | 27 项通过，包含配套发布等待、错误提交过滤、后端失败/超时阻止前端发布 |
| 发布与回退离线集成 | `release.test.sh` 通过，覆盖静态资源切换、旧 chunk 保留、过期发布拒绝、前后端回退、存储隔离与发布锁；网络和进程均为测试替身 |

本地检查日志：`output/pm-final-build.log`、`output/pm-final-web-tests.log`、`output/pm-final-backend-suite.log`、`output/pm-final-pm-backend.log`。这些日志不属于部署包。

提交前收尾日志：`output/pm-submit-backend.log`、`output/pm-submit-deploy-tests.log`、`output/pm-submit-release-tests.log`。PM 后端测试已接入标准测试命令；GitHub 前端 push 流水线读取后端真实触发路径，仅在本次 push 涉及后端时等待同一 SHA 的后端部署成功。后端失败、取消、跳过、查询失败或等待超时均不发布新前端。前端独立改动仍独立发布；手动 workflow_dispatch 和本机发布继续由操作者保证版本顺序。流水线只增加只读 Actions 权限，不触发订单操作。

### 发布阻塞与版本切换

1. **必须先形成包含全部首期文件的发布提交。** `scripts/deploy/publish.sh` 的后端包由 `pack-git-repo.mjs` 执行 `git archive HEAD` 生成，未提交修改与未跟踪文件均不会进入包。本次已将 PM 首期、全部新增运行时文件和测试、发布流程收尾纳入暂存区，保留既有 POD / 账号及后端仓库地址等无关修改在暂存区外。用户可直接提交本次暂存内容并 push；不要用 `git add -A` 混入诊断输出或其他未审查改动。本次未执行 Git 提交或部署。
2. **前后端按同一发布提交配套切换。** 先停止产生新下注轮次，等待已在途轮次按现有逻辑结束，再更新后端和电竞/体育两套 Hub，随后发布对应前端并刷新各操作端旧页面。旧页面不调用 `Pm_PrepareSubmit`，在新后端冷状态下可能提交失败；新页面搭配旧后端则预检失败。这是发布操作顺序，不新增运行时取消机制，也不取消已经受理的订单。
3. **首次恢复执行前验证新接口与进程。** 核对前后端发布版本、`changmen-esport` 单实例及两套 Hub 的版本，使用所属账号验证 `Pm_PrepareSubmit` 返回 ready/lease（仅校时，不下单），再验证新页面钱包准备和 tick 控制帧。首期本身不需要数据库迁移，新增校时环境变量均有默认值；实际线上环境尚未检查。
4. **回退必须恢复匹配版本。** 部署脚本的前端、后端各自自动回退不能替代本次跨组件回退；任一组件升级失败时不恢复新轮次，先恢复上一套匹配的前端、后端和 Hub 并刷新页面。已受理或结果未知的订单继续按原 orderId 核验，不能通过重新发单验证恢复。

形成发布提交后，应从该提交重新生成前端产物并打包后端，确保被发布的内容就是受审版本。真实环境的 P50/P95 和场馆拒单、单腿结果对照仍属于上线验收，不能由上述本地通过结果代替。

## 设计决定

| 事项 | 本方案决定 |
|---|---|
| 同一轮自动套利 | 两腿预检通过且现有整轮检查通过，立即按 betSorting 提交 |
| PM betting 内的 Gamma 和 book 查询 | 删除，不保留自动补查分支 |
| 1500ms 订单簿复用阈值 | 从本轮预检结果的消费判定中移除；簿年龄保留为指标 |
| 替代的快照年龄门槛 | 首版不新增；checkTimeout 保持原有配置语义 |
| 当前轮次的执行 | 停止自动下注等操作沿用现有行为；本次不新增中断当前轮次的取消机制 |
| 预检结果 | 保存与本次 attempt 绑定的只读订单参数，不能跨轮次借用 |
| 参数变化或结果缺失 | 明确失败，不能在 betting 内自行补预检 |
| SDK 和钱包初始化 | 在真实下单腿的预检期间并行准备，尽量移出提交关键路径 |
| 协议与签名路由 | 从本次 book 识别协议，按已验证映射选择域版本 2 或 3；未知或尚未验证的组合在预检拒绝 |
| 本地构单 | 使用 SDK 公开 OrderBuilder，显式传入本轮参数；删除零费率占位，不为绕过高层 SDK 读取而新增费用查询 |
| L2 时间戳 | 启动、后台或首次预检准备时钟；每单生成新时间戳与 HMAC，POST 前不再串行请求 /time |
| 金额与检测价生命周期 | 新动作从原始计划金额创建新 option；检测输入与预检结果分离，避免重复换汇或复用旧检测价 |
| 仅预检角色 | 编排显式传递角色；9999 自动仅预检腿免签名准备，同账号手动下注仍按真实下单准备 |
| tick 变更 | 补齐官方支持的档位，接收元数据变更；已知订单参数失效时本地失败，不拉簿、不改价重签 |
| 完整订单预签名 | 首版不做，不新增 prepared submission 框架 |
| 手动确认和补单 | 每次新的执行动作明确调用预检，再调用严格的提交函数 |
| WS 深度缓存 | 第二期可选，先旁路验证；首版继续实时 REST 拉簿 |
| Gamma 等状态缓存 | 首版不做跨轮次缓存，保留当前查询和拦截规则 |

去掉 1500ms 门槛，是用“同一次执行中的预检结果”替代“可反复使用但短时有效的簿缓存”。它不意味着任何历史 option.data 都可以提交。轮次结束后，新的下注、重新确认或新补单动作必须创建新的执行上下文；此规则不新增对正在执行轮次的取消操作。

## 当前事实与问题

### 现有预检校验

| 检查 | 当前语义 | 新方案 |
|---|---|---|
| 本地赛况 | 比赛结束、系列赛已决出、目标地图结束时阻断 | 保留 |
| 远程赛况 | 本地快照缺失或满足过期刷新条件时查询 Gamma 赛事 | 保留触发条件 |
| 市场状态 | Gamma 和 CLOB 检查关闭、停用、接单状态及结果 | 保留 |
| 概率软拒 | 本方 outcomePrices ≤0.10 且对方最高价 ≥0.90 时拒绝 | 保留项目现有规则 |
| 金额 | 使用已换算的场馆金额 | 预检后不重新缩放或调整 |
| 限价 | 锁定检测价，应用现有价格缓冲与 tick 处理 | 保留相同算法 |
| 深度 | 遍历 asks，检查整笔金额、最小份数及配置的深度倍数 | 保留 |
| 双腿协同 | 必须参与的腿全部预检完成后才下单 | 保留 |
| 提交内部复检 | 簿超过 1500ms 或不匹配时重新查询 | 删除该机制；不匹配明确失败 |

代码依据：

- [bet.ts](../packages/venue-adapter/polymarket/bet.ts)：`checkBet`、`diagnosePolymarketBuyCheckReuse`、`resolvePolymarketExecutableBuyForBet`、`betting`。
- [pmBetGuard.ts](../packages/venue-adapter/polymarket/pmBetGuard.ts)、[pmMarketGuard.ts](../packages/venue-adapter/polymarket/pmMarketGuard.ts)、[pmSportGamma.ts](../packages/venue-adapter/polymarket/pmSportGamma.ts)。
- [checkArbLegs.ts](../client/web/src/stores/betting/autoBet/phases/checkArbLegs.ts)、[placeArbLegs.ts](../client/web/src/stores/betting/autoBet/phases/placeArbLegs.ts)。
- [betGateway.ts](../client/web/src/stores/account/betGateway.ts)：上层 `requirePreparedQuote` 目前只阻止 data 缺失时的自动预检，不能约束 PM adapter 内部的复检。

### 隐式复检扩大两腿提交时差

当前 PM 的 book 可能很快返回，但 Gamma 或另一腿还在等待。两腿汇合时 book 超过 1500ms，PM betting 会先查询市场状态，再拉簿，然后才签名提交；对侧此时可能已经提交。

新增一次查询只能取得更新的快照，无法保证之后提交时流动性不变。目标是保留预检阶段的完整校验，将最终限价和 FOK 写进订单，在同一执行链中立即消费，不在提交阶段重新做市场判断。

移除复检后，一部分旧实现会再次检查或拒绝的订单将直接按原限价提交。这是明确的行为变化；最终仍可能因深度消失、市场关闭或 tick 改变被 PM 拒绝。不得把“减少本地拒绝”当作成交保证。

### 公开请求存在可消除的串行等待

现有 book 与 guard 并行；guard 中 Gamma market 和 CLOB market 先并行结束，之后才按需查询 Gamma event。eventId 已在 option 中时，event 查询可以立即开始。

另有异常路径：event 请求抛错会进入外层 catch，跳过已经获得的市场关闭结果。请求独立捕获错误后，应保留已知拒绝证据。

### 路由与准备时间

[pmTransport.ts](../packages/venue-adapter/polymarket/pmTransport.ts) 在 HTTP 为 vps、行情源为 official 的特定组合下，book 先直连最多 800ms，公开市场查询先直连最多 1500ms，然后回退 VPS。网络长期不通时可能每次重复等待。

此处的 1500ms 是公开请求直连超时，与 book 复用年龄阈值是两个独立配置。本方案移除的是提交时的簿年龄门槛，不顺带删除网络超时。

SDK 预热当前在 PM 预检成功后才发起；上层 checkBetting 在调用 adapter 前先 await `ensureSharedVaultKeyForAccount`，placeBet 又会等待一次。准备前移必须同时调整网关：把真实下单腿的钱包准备与公开预检并行，并在返回成功前汇合，不能只提前 adapter 内的 import。

[clob_proxy.js](../server/backend/core/integrations/polymarket/clob_proxy.js) 的 VPS L2 请求每次先查询 `/time`（超时上限 8 秒），之后才发送订单。当前没有复用校准结果；仅消除 Gamma/book 查询，仍会留下这段提交前等待。

## 目标执行流程

### 自动套利

```text
创建本次 attempt 和执行角色，从原始计划金额建立新 option
金额只换算一次，锁定本轮检测输入
    ├─ PM 预检
    │    ├─ book
    │    ├─ Gamma market
    │    ├─ CLOB market
    │    ├─ Gamma event  仅按既有规则需要时
    │    ├─ 本地钱包、signer 与 OrderBuilder 准备  仅真实下单腿
    │    └─ 提交出口时钟就绪  仅真实下单腿；冷启动必要时在此校准
    │    → 原有校验
    │    → 保存本笔最终订单参数
    └─ 对侧原有预检
         ↓
两腿汇合
原有 checkTimeout 检查
本轮结果和最终输入的本地一致性检查
         ↓
并行模式：立即调用两边 betting
顺序模式：按现有顺序调用
         ↓
PM betting：消费本轮参数 → OrderBuilder 本地签名
提交出口：用就绪时钟生成新时间戳与 HMAC → POST /order
```

图中的本地一致性检查并入现有汇合逻辑，不增加异步预检阶段，不调用网络，也不重新计算市场风险。PM 规则归 adapter 所有，编排只消费检查结果。

“立即提交”指不插入新的市场查询、逐单远程校时、轮询或人为等待；本地签名、请求鉴权和实际网络传输仍有耗时。客户端发请求、VPS 发上游 POST、收到 ACK、确认成交应分开计时。已就绪出口不增加每轮校时 RPC；冷启动准备纳入本次预检与现有 checkTimeout。

### 一次预检确定一次订单

扩展已有 `PolymarketBuyCheckData`，必要时在内存中保存不可变的附属数据。概念字段如下，具体命名沿用项目现有类型：

| 信息 | 用途 |
|---|---|
| attemptId 与提交角色 | 区分本次执行、真实下单腿和仅预检腿 |
| accountId、gateway、conditionId、tokenId | 绑定账号、出口及市场 |
| 输入版本或快照 | 绑定检测价、金额、价格缓冲、深度倍数与账户凭证版本 |
| apiBetMoney、side、orderType | 确定 BUY FOK 金额和类型 |
| detectionMaxPrice、fillPrice、limitPrice | 保存按现有算法得到的最终价格参数 |
| tickSize、minOrderSize、negRisk | 保存签单需要的交易参数 |
| marketProtocol、chainId、signingDomainVersion、exchangeAddress | 从已验证的市场协议确定签名路由，区分市场版本与签名域版本 |
| builderCode、signatureType、maker/funder、signer 身份与准备版本 | 绑定构单归因及钱包配置，提交不读取可变全局默认值；不保存私钥 |
| planBetMoney、stakeCurrency、stakeExchange、stakeRate | 区分原始计划额与已换算场馆额，证明本次只换算一次 |
| bookFetchedAt、checkedAt、bookSource | 诊断数据来源和年龄，不作为本轮 1500ms 提交门槛 |

最终限价应使用当前 `polymarketFokLimitFromDetection` 等同源算法在预检中确定，并用回归测试证明 tick 对齐、深度和金额精度行为不变。betting 不再从最新 fo、全局配置或新 book 重算价格与金额。

本地一致性检查比较本轮最终输入与预检绑定的输入；参数改变时失败并交回调用方。凭证只用可失效的版本或内存引用绑定，不把 secret、私钥或签名写进诊断记录。

新动作的输入和结果按下节规则分离。清理旧预检输出不能删掉本轮刚锁定的检测输入；多轮并发不得共享可写 option，迟到响应不得覆盖更新轮次。同一结果只允许一次提交调用：在异步签名前同步占用，防止两个调用同时通过“未使用”检查；签名失败、已发送或结果未知均不得自动恢复为可重复消费。提交结果未知时沿用原订单核验，不能重新 check 后盲目再次提交。这是防重复提交约束，不是取消机制。

### 新动作的金额与检测价

当前 [betGateway.ts](../client/web/src/stores/account/betGateway.ts) 会原地将 `option.betMoney` 从计划金额转换为场馆金额；[attachDetectionQuote.ts](../client/web/src/domain/polymarket/attachDetectionQuote.ts) 则复用 data 中已有的检测价。不能简单对旧 option 再调一次 checkBetting，或进入 adapter 就无差别清空 data。

1. 自动首次执行、手动最终确认、新跟单和新补单各自创建 attempt。默认从该动作的原始计划金额、新选项和检测输入创建新 option，不从上轮 `betMoney` 反推原始金额。补单计划额来自现有补单算法，不复用原单场馆额作为计划额。
2. 新 option 不携带旧预检输出、旧检测价或旧提交资格。本轮 attach 锁定检测输入后，校验阶段完整保留该输入；将执行结果存为独立结构，或在现有 data 内用明确字段和类型区分二者。
3. `checkBetting` 执行一次币种及账号比例换算，记录 `planBetMoney/stakeExchange/stakeRate/stakeCurrency`，预检后场馆金额不变。手动入口继续 `skipAccountRate: true`，不能改变现有手动金额语义。
4. 只有调用方明确持有已换算金额时才使用现有 `skipStakeResolve: true`，并校验币种、账号、金额来源及本轮检测价。它不是所有确认或重试入口的默认设置；`skipAccountRate` 不能代替它防止重复换汇。
5. 预检可能更新 `option.odds/newOdds`；本地绑定校验使用独立保存的检测输入和最终执行参数，不能将正常回填的赔率、orderIndex 或诊断字段变化误判成用户改价。

### betting 的单一职责

PM betting 只执行：

1. 同步校验本次结果存在、属于当前账号和 attempt、参数一致、未被用于另一笔提交，并在第一次 await 前将其标记为提交中；重复调用明确失败。
2. 使用预检确定的参数和已初始化的公开 OrderBuilder 本地签名。
3. 调用提交传输，以新时间戳和准确请求体生成 L2 HMAC 后发单，回传 BetResult，沿用提交后处理。

必须移除的路径包括：`resolvePolymarketBetBlockReason`、`pmGetBook`、`resolvePolymarketExecutableBuyForBet` 中的拉簿兜底，以及通过 SDK 隐式查询 market metadata 的遗漏路径。不能仅删除最外层 if，而保留 helper 内部补查。

签名过程中必要的本地计算可以保留；预检已确定的价格、深度判定不得以新的 fo 或新配置重做。首版不做订单预签名、不新建通用准备协议。若后续实测本地签名仍占主要耗时，再独立评估是否提前签名。

SDK 或凭证准备失败尽量在 PM 预检结束前暴露；提交瞬间仍可能发生锁定、资源或网络异常，必须正常回传失败，不能承诺所有失败都一定发生在双腿提交之前。

## 不同入口如何使用预检结果

| 入口 | 执行规则 |
|---|---|
| 自动套利并行 | 本轮两腿通过后直接提交；book 年龄超过 1500ms 本身不触发复检或拒绝 |
| 自动套利顺序 | 保留 betSorting；PM 为第二腿时仍使用同轮参数，等待第一腿不会触发年龄复检 |
| 9999 仅预检腿 | 按现有配置参与盘口检查；不签单、不提交，不强加真实下单腿的钱包准备要求 |
| 手动直接下单 | 最终点击提交的执行动作内显式 check，再调用 betting |
| 手动预览后确认 | 预览不授予未来提交资格；确认时发起本次执行的预检，UI 明确显示预检阶段 |
| 修改金额、选项或账号 | 作废原预检结果，在新的执行中显式 check |
| 新补单 | 只有既有逻辑允许新单时，按补单参数显式 check，再提交；使用新的 attempt |
| 原单结果未知 | 查询原单，不创建新单来代替查询 |
| 直接调用 provider.betting | 没有本次执行的有效结果就失败，调用方不得依赖内部补查 |

实施前枚举自动、手动、正 EV、跟单、补单及测试中全部 PM provider 调用方。上层 placeBet 对非 PM 场馆的原有 data 缺失兜底保持原语义；PM 调用方必须完成显式接入，不能把 adapter 删除的补查搬到上层 betting 中继续隐式执行。

### 显式传递真实下单与仅预检角色

当前 checkBetting 无角色参数：包括 9999 腿在内都会等待钱包准备，PM 缺私钥时直接拒绝。因此“不要求 9999 腿准备钱包”是本次明确调整的行为，不是当前已满足的条件。

编排使用现有 `isSingleLegPrecheckOnly` 判定，向网关及 PM adapter 传递 `precheckOnly` 或 `execute` 角色（具体字段命名沿用项目风格）。未传角色的真实下单入口默认 `execute`。仅预检腿保留当前账号筛选、金额、盘口、赛况和协议结构检查，不准备私钥、signer 或提交时钟；其结果不能被 betting 当成下单许可。

角色取决于本次动作，不只取决于账号比例。9999 账号的手动下注仍是 `execute`，必须准备签名；不能为了让仅预检腿通过而放宽真实下单腿的私钥要求。网关对 execute 将钱包准备与公开查询并行，完成两者后才返回成功；已知准备失败先于双腿提交暴露。

`checkTimeout` 保持现有含义和配置行为。为 0 或关闭时不新设隐藏默认值；若用户希望增加独立的盘口年龄限制，应作为另一个业务策略单独设计和验证。本方案只记录年龄。

顺序模式可能因等待第一腿而更容易遇到价格或深度变化；保留用户选择，由限价、FOK 与既有善后机制处理。不将顺序模式改成强制并行，也不添加 PM 特有的第二腿定时拒绝。

停止自动下注、页面操作和挂起恢复沿用现有行为，本次不推导它们应终止正在预检或下单的轮次，也不新增取消状态、取消令牌或提交前取消检查。预检失败或 checkTimeout 超时时按现有规则不下单；两腿预检通过且原有整轮检查通过后，按 betSorting 立即进入下单。新执行动作不能借用历史结果；已发出的订单继续按既有流程确认。

## 预检请求如何提速

### 同时发出独立查询

预检先进行本地快速阻断，然后固定是否需要补赛况，有 eventId 时立即发出 event 请求。网络耗时结构从：

```text
max(book, max(gammaMarket, clobMarket) + gammaEvent)
```

变为：

```text
max(book, gammaMarket, clobMarket, gammaEvent)
```

每个来源独立记录成功与失败，最终按既有原因优先级判定。没有 eventId 或事件返回不可用对象时，继续使用 Gamma market 内嵌赛事；事件抛错不再吞掉 CLOB 已知停盘结果。

当前 guard 查询故障并非全部阻断。首版保留其余兼容行为，只明确修复“其他请求失败掩盖已知拒绝”的异常路径。已有概率软拒、赛况和 CLOB 检查都不能以提速为由删掉。

### 合并在途公开请求

同一 endpoint、gateway、token 或 condition/event，以及相同传输上下文的在途请求可共享。完成或失败后清理，不作为跨轮次状态缓存；每笔按自身金额和限价计算，不共享通过结论。

一个等待者结束等待，不能终止其他等待者仍需要的共享 GET。共享响应不能原地修改。多笔同时看见同一深度不代表这部分流动性已为各笔预留。

### 公开读取失败冷却

仅在现有自动直连回退路径中增加按域名的健康状态。手动指定 direct 或 extension 的模式语义不因本次优化被悄悄重写；现有模式降级行为另行保持。

| 情况 | 建议初始行为 |
|---|---|
| 直连健康 | 维持现有超时与回退机制 |
| 同域名连续两次网络失败或超时 | 冷却 30 秒，公开预检 GET 直接走 VPS |
| 冷却结束 | 只允许一个恢复探测，其余继续 VPS |
| 恢复探测成功 | 恢复直连优先 |
| 恢复探测失败 | 再冷却，可退避到最多 2 分钟 |
| 用户切换模式或网络变化 | 清理相应状态或重新验证 |

数值为灰度调参起点，不是官方要求。按域名、出口隔离状态；429、认证与业务拒绝不当成普通网络失败。尊重限流，不以双出口重复请求规避限流。

支持 abort 时中止已超时或回退后废弃的公开 GET；不支持时隔离迟到响应。这只清理传输请求，不终止下注轮次。首版不默认竞速两个出口，不修改 POST 重试策略。后续只有数据证明必要时才评估公开 GET 延迟备用请求。

### 钱包与 SDK 提前准备

真实下单腿在网络预检进行时并行准备钱包、SDK 和 signer。复用已有 runtime cache，并避免同一个 runtime 并发初始化多次。

初始化只完成到“可以本地签名”，不提前创建订单，不额外添加余额、授权或私有接口轮询。book 提供交易约束，账号提供钱包配置，builderCode 来自现有配置；下节的 OrderBuilder 直接消费这些参数，不使用高层 ClobClient 的费用缓存补查。

账号锁定、凭证改变、会话结束时清理缓存；在途初始化不能在清理后重新写回旧 signer。上层 ensureSharedVaultKeyForAccount 的热路径应可复用已完成准备；需要重新解锁时使本次执行失败，不在另一腿提交后弹出等待解锁。

## 签名路由、构单与提交准备

本节与前述金额生命周期、执行角色共同构成首期实施要求。审计对照仓库安装的 `@polymarket/clob-client-v2` **1.1.0**；官方主分支只作参考，本地支持能力以安装包、离线验证和接入测试为准。

### 协议识别和签名路由

当前 `fetchOrderOptions` 丢弃 book 的 `version`，runtime 又固定设置 `cachedVersion = 2`，无法证明它选中了目标市场要求的签名域。官方区分新协议 book 的 `version: "v2"` 与省略该字段的 CTF book；前者使用签名域版本 `"3"`，后者使用 `"2"`。**市场协议版本与 EIP-712 签名域版本不是同一个字段。** 依据：[Place Orders](https://docs.polymarket.com/trading/place-orders)。

`book.version` 是已有 `/book` 响应中的市场协议标记，不是盘口更新序号或数据年龄，不需要为读取它新增请求。路由映射为：

| 合法 book 的协议信息 | OrderBuilder 版本 / 签名域版本 | 合约配置 |
|---|---|---|
| version 缺省，neg_risk 为 false | 2 / "2" | exchangeV2 |
| version 缺省，neg_risk 为 true | 2 / "2" | negRiskExchangeV2 |
| version 为 "v2" | 3 / "3" | exchangeV3；tokenId 携带对应 Position ID |

解决方式：

1. `fetchOrderOptions` 保留并校验协议标记、资产标识、tick、neg-risk 等字段。只有 book 结构完整、资产与请求匹配时，缺省 `version` 才按官方 CTF 语义解释；错误响应、空对象和未知版本不能默认为旧协议。
2. 增加显式的签名路由解析函数，输出链、签名域版本及交易所合约。CTF 普通与 neg-risk 使用各自的官方合约；协议配置从经过核对的 SDK/官方配置获得，不在多个 helper 中复制常量。
3. 本地 SDK 已有版本 3 构单分支，不把所有 `version: "v2"` 市场统一拒绝。按上表实现显式路由，并验证项目资产标识与实际钱包类型；未知协议、畸形响应或尚未验证的资产/钱包组合在 checkBet 明确拒绝。真实下单腿的支持判定必须在放行前完成。
4. 删除 runtime 的固定 `cachedVersion` 设置和对 ClobClient 全局版本缓存的依赖。每次向 OrderBuilder 显式传入已确定版本，避免并发市场互相覆盖；钱包 runtime 继续按账号及凭证配置隔离、失效。
5. 预检结果保存路由；签名与序列化严格消费该路由，验证 `verifyingContract`、domain version、token 和 neg-risk 一致。`orderType: FOK` 同时校验在 POST 外层，不能误以为它包含在订单签名里。

协议与 tick 的结构检查也适用于 9999 预检腿，但不要求该腿初始化钱包。此项增加本地解析，不增加一次网络复检。

### 公开 OrderBuilder 纯本地构单

当前仅填 tick、neg-risk 并不足以阻止本地 SDK 的所有读取：缺少对应缓存时，`createMarketOrder` 可查询 token 对应市场、市场元数据以及 builder 费率。当前 `feeInfos = { rate: 0, exponent: 0 }` 和 builder 的零费率是人工填充，不能作为平台实际不收费的证据。依据：[官方 SDK](https://github.com/Polymarket/clob-client-v2)、[Trading Fees](https://docs.polymarket.com/trading/fees)、[Builder Fees](https://docs.polymarket.com/programs/builders/fees)。

首期使用 SDK 公开导出的 `OrderBuilder`，不再以高层 `ClobClient.createMarketOrder` 加内部缓存填充作为买入构单路径。依据：[官方 OrderBuilder 源码](https://github.com/Polymarket/clob-client-v2/blob/main/src/order-builder/orderBuilder.ts)。具体规则为：

1. 在真实下单腿预检期间初始化本地 signer 与 OrderBuilder，保存经过验证的钱包身份、signatureType、maker/funder 和 builderCode。现有默认 builderCode 继续保留，不能因绕过 ClobClient 丢掉订单归因。
2. 提交调用 `buildMarketOrder(userOrder, options, version)`，显式传入 tokenID、BUY、apiBetMoney、最终 price、builderCode、tickSize、negRisk 及订单版本。该低层接口不代替市场校验：合法价格区间、tick 整数倍、金额、最小份数及深度检查仍在首次预检完成。
3. 删除 `feeInfos` 和 `builderFeeRates` 的零占位，不再为构单维护 60 秒费用缓存，不把 `/markets-by-token`、`/clob-markets`、`/fees/builder-fees` 加为新的必经查询。原有 Gamma/CLOB guard 请求照常保留，不能因本地构单而省略。
4. 采用本地 SDK 对应序列化方法，将已签订单封装为 FOK；验证版本 2/3 的完整正文、builder、资产 ID、maker/taker amount 以及签名域。价格与金额不从新行情重算，舍入继续使用已验证的 SDK 算法。
5. 不读取 SDK 私有缓存、不绕过项目 HTTP 路由，也不调用隐含创建加提交或版本更新重试的高层方法。必要参数缺失时明确失败，不能回到 ClobClient 自动查询。以拦截 fetch、Axios 及其他实际传输的离线测试约束构单零网络行为，依赖升级需重跑契约测试。

金额语义保持现状：`apiBetMoney` 是 BUY 名义金额，不是含所有手续费的总支出。使用低层构单不会免除平台或 builder 收费，也不能将未知费率当作零；实际费用以场馆执行为准。本次不引入 `userUSDCBalance/maxSpend` 或暗中缩小订单。费用查询若用于独立的收益计算或含费预算能力，应另行定义其数据要求和失败语义，不为了满足高层 SDK 的读取而增加预检前置条件。

2026-10-07 已使用本地 SDK、测试密钥和模拟数据验证普通 CTF、neg-risk CTF、新协议的三组 EOA 构单：域版本及合约映射正确、签名验证通过、FOK 外层和 builder 保留、名义金额不变，构单网络请求为零。该证据验证 SDK 能力；项目接入、其他实际钱包类型和生产资产识别仍须验收，未发送真实订单。

### 将逐单 /time 等待移出提交路径

当前 VPS 的 `handlePmSubmitOrder` 经 `executePolymarketHttpRequest` 每单执行 `/time → /order`。模拟连续两单已复现重复校时。官方 L2 规则要求每次用当前 Unix 秒级时间戳、HTTP 方法、路径和准确的序列化正文生成新 HMAC，并未要求每单请求 `/time`。依据：[官方 API 鉴权](https://docs.polymarket.com/getting-started/api#authentication)。

1. 在实际生成 L2 头的进程内维护时钟就绪状态。VPS 独立校准，浏览器 direct/extension 路径独立验证本地时间来源；不能直接复用客户端时钟偏移给服务器。首期优先消除已确认的 VPS 逐单等待，不向其他出口增加原本没有的 `/time` 请求。
2. 使用可验证的已同步系统时钟，或在启动和后台通过 `/time` 维护偏移。校准记录来源、采样时间、往返耗时与不确定度，按 CLOB origin 隔离并合并在途请求；失败不更新有效样本。允许样本年龄、不确定度等配置需在上线前根据实测确定，不冒充官方固定容忍窗口。
3. 若冷启动尚无可靠时钟，在首次真实下单预检中通过明确的出口准备步骤完成校准，与 book/guard 并行，受现有超时约束。已有就绪状态的出口无需每轮再发就绪探测；不能把原有逐单 `/time` 原样搬成每轮串行预检请求。
4. 发单时根据可靠时间来源生成新的时间戳，以实际发送的同一份序列化 body 计算 HMAC。复用的是校准偏移和就绪状态，不是旧时间戳、旧请求签名或旧鉴权头；POST 路径不等待后台校准，也不临时补查 `/time`。
5. 进程重启、已检测到的时钟跳变或来源失效时使相应就绪状态失效。已知问题尽量在双腿放行前返回明确准备失败；若提交时才发现不可用则正常回传本地失败，不声称能保证另一腿尚未发送。没有可靠时间来源时不盲用旧偏移，亦不新增订单 POST 自动重试。
6. 给校准与最终鉴权分别计时，验证模拟慢 `/time` 不阻塞已就绪的提交。后台任务拥有独立的超时和生命周期，失败不触发订单重放。此项是时间源与请求准备优化，不改变订单确认和未知结果核验语义。
7. 后台刷新失败必须继续调度且不续期旧样本；客户端收到服务端明确校时失效错误时清除就绪租约，只在下一次新预检恢复。扩展在平台 HTTP 发出前明确断连的既有回退使用客户端当前时间戳、服务端所属账号鉴权，不依赖冷 VPS 校时，不影响常规 VPS 的时钟就绪要求。

### 补齐 tick 支持和已知变更处理

官方当前列出的 tick 包含 `0.1`、`0.01`、`0.005`、`0.0025`、`0.001`、`0.0001`。本地 `pmTickPrice` 缺少 `0.005`；安装的 SDK 已具备该档及 `0.0025` 的舍入配置，现有“SDK 不支持 0.0025”的注释也需要更正。依据：[Place Orders](https://docs.polymarket.com/trading/place-orders)、[Real-Time Data](https://docs.polymarket.com/market-data/realtime-data)。

解决方式：

1. 类型、normalize、限价对齐和测试覆盖全部六档，使用整数刻度或可靠十进制计算判断倍数，避免浮点取模误判。未知 tick 在预检明确拒绝，不能降级成 `0.01`。
2. 最终限价在预检中按 tick 计算一次，并检查合法价格区间、方向性舍入与检测价上限。支持 `0.005` 是修复合法输入覆盖，其余既有档位保持算法回归。
3. 官方流在提取最优价前消费 `tick_size_change`；Hub 路径在瘦帧、按 token 合并之前识别并转发此类元数据控制消息。此项属于首期元数据兼容，独立于第二期完整深度 reducer；相应契约需版本化并测试旧客户端兼容。
4. tick 变化更新后续预检使用的元数据。对当前 attempt 不改金额、不换限价、不重拉簿；若已收到的可信变更使冻结限价不再合法，在汇合与提交入口的同步检查中明确失败。仍合法的参数继续原样提交。此检查由具体变更触发，不能演变成年龄超时复检。
5. 变更若在另一腿提交后才到达，不能声称已保证双腿一起终止；按既有单腿失败善后处理。断线或旧 Hub 未提供事件时，也不能把“没有收到”当作 tick 未变的证据；REST 预检之后的变化仍可能表现为官方拒单，不新增下单前查询来补齐此窗口。

### 小金额最小份数问题的处理级别

实际下注不进入极小金额边界区间。因此“按成交档位估算份数与按最终限价签单份数不同”的问题列为 **非阻塞边界测试**，不作为本轮提速方案的前置改造，不引入额外查询或小金额执行分支。保留既有最小份数检查；未来扩大金额范围或修改份数算法时再处理。该降级不影响本方案其他首期交付要求。

## 观测和验收口径

先补计时并取得基线，再实施行为变更。每次预检关联 attempt 和现有下注轮次，区分以下时间点：

| 指标 | 含义 |
|---|---|
| checkTotalMs | PM checkBet 入口到返回 |
| pairCheckMs | 双腿本轮预检开始到汇合与现有检查结束 |
| bookTotalMs | 包含直连尝试及 VPS 回退的拉簿总耗时 |
| gammaMarketMs、clobMarketMs、gammaEventMs | 各来源请求时间，标明是否实际执行 |
| runtimePrepareMs、signMs | 本地初始化与签名耗时 |
| localBuildNetworkReads | OrderBuilder 构单期间的网络读取次数，冷/热启动都必须为零 |
| clockPrepareMs、clockSource、clockSampleAgeMs | 时钟就绪准备耗时、来源与样本年龄，区分后台校准和首次预检 |
| l2AuthMs、prePostTimeReads | 生成新时间戳与 HMAC 的耗时，以及提交路径同步 /time 请求次数 |
| dispatchGapMs | 并行模式汇合后到各腿客户端提交发起 |
| serialWaitMs | 顺序模式等待第一腿结果的时间，单独统计 |
| outboundPrepareMs | VPS 接收请求到上游 POST 的准备时间 |
| bookAgeAtSubmitMs | 提交时簿年龄，仅诊断 |
| postCheckMarketReads | PM betting 开始后、订单发出前的 Gamma/book/SDK 行情读取次数 |
| reasonCode、route、fallback、requestCount | 失败原因、出口及请求量 |

正常 PM 提交的 `postCheckMarketReads`、`localBuildNetworkReads` 和 `prePostTimeReads` 都应为零。上游请求鉴权与提交后的查单不计作市场复检，也不能被该指标隐瞒；另设分段耗时。后台 `/time` 不算逐单提交请求，但必须独立计数，证明没有把每单校时伪装成后台操作。

当前 book 回退指标漏计前面的直连等待，需要同时统计总耗时与各尝试。执行记录与高频行情记录分离，避免 300 条共享窗口被行情覆盖。计时采用单端单调时钟，跨端用关联 ID 对齐阶段，不直接减两台机器的墙上时间。不记录凭证、签名正文或私钥。

按成功与失败、模式、赛况补查、冷与热启动、电竞与体育分别给出 P50、P95 和样本数。提交后拒单率、单腿成交情况也要观察，避免把原先复检拒绝改为场馆拒绝后误报为无代价提速。

## 第二期 可选完整 WS 深度

只有首期数据表明 book 仍是主要瓶颈时推进。Gamma 查询若占主导，仅消除 book 未必缩短总预检。

官方 market WS 提供完整 book、档位变化与 tick 变更；best_bid_ask 本身没有整笔成交深度。见 [官方实时数据文档](https://docs.polymarket.com/market-data/realtime-data)。

两条接入路径：

- 官方 WS：浏览器在最优价提取前，将完整消息交给订单簿 reducer。
- changmen Hub：在瘦帧和同 token 消息合并之前重建完整簿，再向候选订阅者下发完整快照。

[pm_market_hub.js](../server/ws_forward/core/pm_market_hub.js) 既瘦帧又合并消息，关闭瘦帧仍不足以保留所有深度增量。允许合并最新完整快照，不能只留下最后一条档位变化。电竞与体育 Hub 分别验证。

WS 簿用于“本次 checkBet 选择哪个数据源”，不在 betting 中重新选数据源。完整性、连接代次、必要元数据、源时间和本 token 数据新鲜度不合格时，在预检阶段回退 REST。候选阈值可以从 500ms 旁路验证开始，但这是预检数据源选择条件，与被移除的提交后 1500ms 复用阈值不同。

不能用心跳或其他 token 的更新刷新本 token 年龄；接收时间不等于源时间。没有连续官方序号时不能宣称可严格证明上游零遗漏。断线、解析失败、来源切换、元数据不确定时失效并重新初始化；REST 与 WS 的并发快照衔接不明确时不能任意覆盖。

先旁路运行，正式预检继续 REST；在相同金额和限价下记录深度与结果差异，并保留采样时间区分市场变化和重建错误。验证后才小范围启用，不合格自动回 REST。

缓存只覆盖候选 token，设置容量、闲置淘汰和带宽上限。Hub 协议版本化并协商能力，旧客户端保持原行情路径，新客户端遇旧 Hub 回 REST；不由服务端接管客户端下注判断。

首期不引入跨轮次 Gamma 放行缓存。若以后要做，必须独立定义赛况、接单状态和概率价格的有效期。收到 resolved 可以阻断，但没收到不能证明开放；体育推送也不替代现有全部检查。

## 官方依据与策略边界

官方 [Place Orders](https://docs.polymarket.com/trading/place-orders) 说明 book 中的交易约束、FOK 全部成交或不成交，以及估算快照在提交前可能变化。它支持保留限价和整笔深度计算，不提供“预检结果只能使用 1500ms”的要求。

官方 [Prices and Order Books](https://docs.polymarket.com/market-data/prices-order-books) 提供批量订单簿等公开读取能力。可以用于后续候选预取，但不能为了凑批而延迟当前预检。

官方 [Real-Time Data](https://docs.polymarket.com/market-data/realtime-data) 提供市场及体育流，并说明体育数据可能延迟、遗漏或有误。WS 来源及缓存策略必须自行验证，不能作为无条件省略状态检查的依据。

官方页面核对日期为 2026-10-07。当前仓库使用 clob-client-v2，不将本次优化与官方统一 SDK、交易协议迁移捆绑。移除提交内部复检是本项目的执行设计决定，不是官方承诺更高成交率。

## 实施顺序与文件范围

| 顺序 | 主要位置 | 交付 |
|---|---|---|
| 1 | pmExecutionMetrics.ts、pmTransport.ts、pmBetGuard.ts、服务端 clob_proxy.js | 完整耗时基线，修复回退漏计，分离校时与最终鉴权耗时 |
| 2 | bet.ts、PM check data、pmTickPrice.ts、betGateway.ts、checkArbLegs.ts、attachDetectionQuote.ts 和各 PM 调用入口 | 本轮参数与检测输入分离、一次金额换算、显式执行角色、协议路由、完整 tick 支持、严格 betting 和入口接入 |
| 3 | pmBetGuard.ts、pmSportGamma.ts | 必要赛事并行、错误隔离、在途请求合并 |
| 4 | pmTransport.ts、建议新增 pmReadRouteHealth.ts | 公开请求失败冷却 |
| 5 | pmOrderClientCache.ts、本地 OrderBuilder 适配、钱包准备及 checkBet 接入；ws.ts、sportMarketWs.ts、Hub 与契约 | 纯本地构单、零费率占位与固定版本缓存移除、签名准备并行、tick 控制事件转发与失效处理 |
| 6 | server/backend/core/integrations/polymarket/clob_proxy.js、pm_client_handlers.js、出口时钟状态及必要就绪契约 | 启动/后台校准、冷启动预检准备、逐单 /time 移除、新时间戳和准确正文鉴权 |
| 7 | 建议新增 pmOrderBookCache.ts、ws.ts、sportMarketWs.ts、server/ws_forward 与契约包 | 可选 WS 旁路验证和版本化完整快照 |

未写目录的 PM 文件位于 `packages/venue-adapter/polymarket/`。严格 betting 和调用方改造必须作为同一个完整交付，不能先删兜底再让旧入口运行失败。顺序 2 是首期核心，不应排在大型 WS 项目之后。

表中是开发拆分顺序，不是允许逐行独立上线：第 2 项的严格 betting 必须与第 5 项本地构单及首期 tick 处理一起验收、发布。第 6 项校时优化属于首期端到端目标，客户端与实际鉴权出口需兼容联调；第 7 项完整 WS 深度仍可后置。新增出口准备接口如有必要须纳入 API 契约，服务端只维护自身传输/时钟，不接管盘口预检。

只在需要时扩充已有类型和可选的本地一致性检查能力，不新增跨场馆 prepared submission 框架。遵守 [TEAM_BOUNDARIES.md](./TEAM_BOUNDARIES.md)，平台规则留在 adapter；HTTP/WS 契约变更更新相应版本与兼容测试。

[ARB_VENUE_ORCH_CONTRACT.md](./ARB_VENUE_ORCH_CONTRACT.md) 的混合对章节仍有临下单重锁及强制并行描述，与当前 placeArbLegs 代码和回归测试存在差异。实施时同步修订为最终行为，不根据旧章节恢复 OB、TF 等探测型预检的重复调用。本次设计文档不将那些旧描述作为当前事实。

[esport-freeze.json](../packages/venue-adapter/esport-freeze.json) 登记了 bet.ts、pmBetGuard.ts 等路径。实施按本次范围显式放行检查，保留冻结登记。新增 parity 注释使用规定标签。

## 测试矩阵

| 类别 | 必测断言 |
|---|---|
| 本轮直接提交 | 参数一致的预检结果超过 1500ms 仍能提交；betting 中 Gamma/book 请求数为零 |
| 整轮超时 | checkTimeout 生效时沿用现有终止；关闭时不新增 PM 隐藏年龄门槛 |
| 参数绑定 | 更换账号、token、金额、限价、配置或 attempt 后明确失败，不能静默补查 |
| 下单参数 | POST 的金额、限价、tick、neg-risk 与预检结果一致；fo 后续变化不改变订单 |
| 协议路由 | 普通 CTF、neg-risk CTF、新协议的资产映射、签名域和合约正确；实际钱包类型覆盖；未知或未验证组合及畸形 book 在预检拒绝；并发市场不会串版本；POST 外层为 FOK |
| 本地构单 | 使用实际安装 SDK 拦截所有构单网络请求，冷/热启动均为零；不注入费用缓存；builderCode 和金额保留；序列化与签名向量通过；低层接口未覆盖的约束由预检验证 |
| 费用与金额 | apiBetMoney 保持名义金额，不暗改或自动按含费预算缩量；保留项目配置的 builderCode，不把零缓存移除解释为免手续费 |
| 输入生命周期 | 新动作从原始计划额创建新 option，币种与比例只换算一次；显式 skipStakeResolve 不二次换汇；本轮检测价不被清理、旧检测价不跨轮继承；正常赔率和 orderIndex 回填不误触发参数失败 |
| 时钟与鉴权 | 连续两单不逐单查询 /time；冷启动准备纳入预检；后台慢请求不阻塞就绪提交；秒级新时间戳、准确 body 和 HMAC 正确；重启、跳时、校准失败与出口隔离；无自动 POST 重试 |
| tick | 六档 normalize、舍入、价格边界；未知档拒绝；tick 控制帧不被瘦帧/合并丢弃；已知失效本地失败且不补查，合法限价原样提交 |
| 预检算法 | 最小份数、FOK 深度、深度倍数、价格缓冲、精度与 tick 对齐回归 |
| 结果生命周期 | 轮次结束后，新确认、新补单不能使用旧结果；迟到响应不污染新轮次 |
| 防重复提交 | 同一结果并发调用时，在第一次 await 前只允许一个调用占用；最多发出一次订单 POST；失败或未知不自动恢复提交资格 |
| 执行行为 | 停止自动下注等操作保持原有语义，不新增当前轮次取消分支；预检和原有整轮检查通过后按配置下单 |
| 并行双腿 | 汇合后立即调用两腿；无新增远程复检，也不重复对侧 checkBet |
| 顺序双腿 | 保持 betSorting；PM 第二腿不因等待导致 1500ms 自动拒绝或重查 |
| 9999 | 显式仅预检角色免钱包和提交时钟准备，仍保留盘口/账号规则；结果不能用于 betting；同账号手动下注必须按 execute 准备私钥 |
| 手动与补单 | 新执行动作显式 check；原单未知时只核验原单，不误发新单 |
| guard 并发 | 必要 event 立即发出；不需要时不查；event 失败不掩盖 CLOB 停盘 |
| guard 兼容 | 保留赛况、概率软拒和其他现有错误策略 |
| 路由 | 冷却、单恢复探测、域名隔离、429 分类、废弃公开 GET 的中止和迟到响应隔离 |
| 初始化 | 冷启动与热启动；钱包锁定、凭证变化、在途初始化不能复活旧缓存 |
| 提交异常 | 本地签名失败、网络错误、POST 超时、matched、delayed 回传契约保持 |
| WS 可选项 | 多档增量、完整替换、空簿、重连、代次、tick 变化和旧 Hub 回退 |

测试中的“未正式提交”指未进入真实金额的 place 指令；OB、TF 现有 checkBet 可能访问下注端点，不把它们误算为本次新增的真实下单。

极小金额导致的最小份数差异另记为非阻塞边界用例，不以该业务外场景阻塞首期发布；既有业务范围内的最小份数及深度回归仍执行。

运行相关 PM、网关、手动/补单和编排测试，再完成：

```text
npm run typecheck:frontend
npm run check:boundaries
npm run check:venue-adapter
```

触及冻结路径时，在已确定范围内使用 `ALLOW_ESPORT_TOUCH=1` 显式放行，不删除冻结列表。涉及 Hub 时补跑：

```text
npm run test:quote-hub-contracts --workspace=@changmen/venue-adapter
```

后端变更执行对应服务端测试，发布构建执行 `npm run app:build`。文档修订本身只检查内容、链接及差异。

## 上线验收与回退

首期完成标准：

- 同轮 PM betting 的市场复检次数为零，包括 SDK 隐式读取。
- 普通 CTF、neg-risk CTF 和新协议按已验证映射选择签名路由；未知或未验证组合在预检明确拒绝。
- 公开 OrderBuilder 纯本地构单，零费率占位和固定版本缓存已删除，未新增强制费用查询。
- VPS 已就绪提交不再串行查询 /time，新时间戳和准确请求体 HMAC 验证通过；冷启动校准成本单独统计。
- 新动作金额只换算一次、本轮检测价正确绑定；9999 仅预检与同账号手动下注角色分别通过。
- 六档 tick 与变更处理通过，当前订单不会在提交内部被改价或重新预检。
- 正常执行不因 book 年龄超过 1500ms 新增本地拒绝。
- 不新增当前轮次的取消机制；同一预检结果在异步签名前占用，防止并发重复提交。
- 原有价格、金额、深度和赛况检查回归通过。
- 调用方全部接入显式预检，手动确认和补单不复用历史结果。
- 并行模式的汇合到发请求间隔改善，顺序等待单独统计。
- 对照成功路径 P50/P95、请求量、直连回退、场馆拒单和单腿结果；样本不足时不声称确定收益。
- 不改变 POST 重试、订单确认和补单触发的既有策略。

路由与 WS 来源可以单独开关；模式切换仅作用于新轮次。严格 betting、执行角色、金额/检测输入结构和本地构单作为一个完整版本发布、回退，不在某一轮内部静默切换回“自动补查”。校时实现与出口就绪契约保持版本兼容；回退旧版逐单 /time 时须记录恢复的提交延迟，不能把它算作仍满足首期性能验收。

WS 关闭后回到预检阶段 REST；路由冷却关闭后恢复原出口策略。无论回退哪个版本，已经发出的订单继续按原 orderId 核验，不因为回退重新下注。

## 交付检查表

- [x] 本地分段指标和请求拦截回归。
- [ ] 实际环境的完整性能基线。
- [x] 本轮预检参数快照与调用方生命周期绑定。
- [x] 异步签名前同步占用结果，并发调用只提交一次；保持现有执行控制语义。
- [x] 原始计划额与场馆额分离、本轮检测输入保留及重复换汇回归。
- [x] 显式 precheckOnly/execute 角色，9999 自动与手动路径分别验收。
- [x] PM betting 中全部市场复检及年龄复检分支移除。
- [x] 手动、跟单、正 EV、补单入口显式接入。
- [x] 赛事请求并行与 guard 异常隔离。
- [x] 公开读取失败冷却及恢复探测。
- [x] SDK 和钱包初始化前移与缓存失效。
- [x] 协议识别、普通/neg-risk CTF 与新协议路由及四种签名类型离线验证。
- [ ] 生产钱包和真实资产标识的联调验收。
- [x] 公开 OrderBuilder 接入、零费率占位与固定版本缓存移除、纯本地构单契约验证。
- [x] 出口时钟准备、逐单 /time 移除、新时间戳及 HMAC 验证。
- [x] 六档 tick、控制事件转发及已知参数失效处理。
- [x] 编排契约的过时章节同步修订。
- [x] 回归、边界、类型检查与构建。
- [ ] 成功路径性能及提交后拒单与单腿结果对照。
- [ ] 可选 WS 完整簿旁路验证及按需灰度。
- [ ] 完整版本回退与原单持续核验验证。
