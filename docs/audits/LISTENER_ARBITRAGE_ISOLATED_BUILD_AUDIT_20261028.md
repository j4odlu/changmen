# 监听套利独立构建方案全面审计

日期：2026-10-28。标记：[changmen 扩展]。对象：[独立构建方案](../LISTENER_ARBITRAGE_ISOLATED_BUILD_PLAN.md)。

历史阶段说明：以下保留设计期审计。后续已经完成本机集成、行为对齐及独立监听模块提取；当前实现和验收边界见 [实现记录](../../client/listener/LIVE_IMPLEMENTATION_REPORT.md) 与 [模块说明](../../client/listener/module/README.md)。当前两版均运行原 main.ts，原主循环宿主直接复用，早期对独立启动/生命周期的候选约束不代表现行实现。生产交付仍未验收。

本报告是基于当前工作区的设计/源码审计，不是实现、构建、真实交易或生产验收。没有运行监听服务，没有连接场馆，没有修改或发布业务代码。

## 1. 结论

双独立构建、原正式产物保留、试用独立入口，是目前最符合“原实现不改、现有用户不承担试运行”的方向。以下承诺不能直接成立：

- 只替换 `appSession` 就得到了只读或安全的交易宿主。
- 新文件放到独立目录就不会影响默认类型检查、CI 或正式发布。
- 停止 watcher、清空队列或检查外层世代号，就取消了原执行函数内部的异步工作。
- 新服务端白名单或只由新客户端遵守的租约，能约束未修改的旧客户端。
- 不改旧函数就已经证明原产物、原存储、共享服务和普通用户运行完全不变。

本次记录 15 项发现：8 项 P1、7 项 P2。均是方案需实现的约束或待验证问题，不代表已有监听实现出现了故障。方案已纳入可直接确定的修订，但尚无运行验证，不能将“写入约束”记为实现通过。

后续用户确认（2026-10-28）：同一用户不会同时打开新旧两个网页。A06 据此按使用前提接受，不再作为交易实施阻断项，不要求新增跨网页/跨设备互斥。保留原发现及技术依据，不把用户保证记为已经实现了客户端全局锁。

| 阶段 | 结论 |
| --- | --- |
| 本次文档 | 可交付；仅新增方案、报告和源码锚点证据 |
| S0 本机离线回放 | 可按修订设计进入本机实现；须验证独立入口、依赖和构建路径 |
| S1 实时只读 | 暂不通过接入；鉴权/拓扑、数据来源、存储和流量预算未定案 |
| S2 真实交易 | 暂不通过；在途执行/失效及完整维护语义未证明；A06 已按用户确认接受 |
| 任何线上发布 | 暂不通过；独立 CI、制品、发布目标及失败回滚尚未建立 |

## 2. 基线与证据范围

- 审计时 HEAD：`094770d46640b11a98e2008230c12aabdd5482b3`。
- 工作目录：用户指定的 `E:\River\arb\changmen`；没有新建/切换工作区。
- 既有 tracked 修改：`packages/shared/package.json`、`scripts/catalog-smoke.mjs`。既有未跟踪的审计、reference 和 catalog 文件保留。不能把这些既有变化算成本次方案改动。
- 保存了 [37 个源码锚点的工作区原始字节 SHA-256](LISTENER_ARBITRAGE_SOURCE_BASELINE_20261028.json)。这不是完整依赖图，不覆盖部署中的产物、未列入文件或生产配置。
- 本次定位并审读了入口/路由、登录恢复、会话初始化、store/bridge、完整套利管线及副作用、赔率监听、Cookie/CSRF、构建/类型检查和自动发布代码。
- 对版本匹配、网络行为、性能、场馆故障及生产配置没有执行动态验证；对应结论只到“源代码显示存在该约束”。

后续实施必须保存自己的完整输入清单和干净候选身份，不能在 HEAD 改变后仍沿用本报告的锚点指纹作为通过证据。

## 3. 发现

### A01 / P1：仅映射会话入口不能保证只读

证据：[main.ts](../../client/web/src/main.ts) 会安装 bridge、挂载 `App`；[App.vue](../../client/web/src/App.vue) 在 setup 阶段安装 GTC/RAY 监控、GTC 同步和单边策略。[installClientCore](../../client/web/src/runtime/installClientCore.ts) 还注册行情写入/平台 API/log bridge，并启动元数据及预检维护。

触发：监听构建只映射 `@/runtime/appSession`，仍直接使用原 bootstrap 和 App。即使新套利执行器未启用，旧监控/同步也已进入运行。RAY 延迟拒单模块可以写日志并入补单队列，见 [autoMakeup](../../client/web/src/runtime/rayOrderMonitor/autoMakeup.ts)。

影响：不能证明只读入口无业务写入，也不能保证在名单验证前没有加载交易能力。

关闭条件：S0/S1 用新只读 bootstrap/root，安装最小的只读 odds bridge；禁止加载原 App/完整交易安装器。以依赖图加网络/bridge 调用记录证明没有下注、卖出、补单、保存、上报和外部消息。只拦截 fetch 不足以覆盖 XHR、WebSocket 与扩展代理请求。

设计处置：已写入方案 4、5、7；实现验证待完成。阻断 S0 只读验收、S1、S2。

### A02 / P1：默认构建有正式目录清理及旁路输出

证据：[clean-dist-assets](../../client/web/scripts/clean-dist-assets.mjs) 直接递归删除 `client/web/dist`；[package.json](../../client/web/package.json) 在 prebuild 调用该脚本及图标生成；[默认 Vite 配置](../../client/web/vite.config.ts) 还包含 dts、分析输出和构建身份等配置；[正式发布脚本](../../deploy/scripts/release-frontend.sh) 会切换正式 dist 指针。

触发：用默认 npm build 再附加一个 outDir，或直接继承全部旧配置/plugin。

影响：构建命令尚未使用新 outDir，prebuild 就可能先触碰正式目录；路径与缓存的其他输出也可能重叠。

关闭条件：专用命令绕过默认 prebuild；在任何文件操作前核对 realpath、祖先、软链接、outDir/cacheDir/dts/TS build info/publicDir；构建失败注入后验证正式目录和资源清单未变。监听制品禁止交给正式激活脚本。

设计处置：已写入方案 3、9；待专用构建和故障测试。阻断构建/发布验收。

### A03 / P1：新目录当前会进入 full 分类及现网发布链

证据：[classify-deploy-scope](../../scripts/deploy/classify-deploy-scope.mjs) 的 frontendRoots 没有 `client/listener/`，未知目录保守归 full；[release workflow](../../.github/workflows/release.yml) 在 master push 运行并按计划调用正式前后端发布 workflow。

本次直接调用现有函数得到：`client/listener/runtime/session.ts → deployScope=full`；验证计划为 `router-compile, backend, frontend, build`。

影响：新目录、独立输出、本机测试通过，都不能阻止提交推送后被现行控制面当作正式应用变化处理。

关闭条件：实现代码进入自动发布链前，单独审查候选归属、边界门禁、CI/制品和试用发布目标。不得全局忽略新目录、降低未知输入规则，或让试用制品占用正式制品身份。当前只允许本机实现，不把“可以编码”解释为“可以推送/发布”。

设计处置：方案 3、9 已明确；独立流水线未设计/实施。阻断源码自动发布。

### A04 / P1：原页面停止接口无法等待原执行器收尾

证据：[HomeView](../../client/web/src/views/HomeView.vue) 在退出函数中先同步调用 stop，再直接 await `user.logout()`；[原 stopAppSession](../../client/web/src/runtime/appSession.ts) 为 void 并清理 store；[executeArbBet](../../client/web/src/stores/betting/autoBet/executeArbBet.ts) 没有会话/取消参数。[placeArbLegs](../../client/web/src/stores/betting/autoBet/phases/placeArbLegs.ts) 内部还有等待首腿后提交次腿及失败重试。

触发：执行预检、首腿或成交观察时退出、切用户或强制会话失效。

影响：外层只在调用前检查世代号不能证明后续提交与收尾仍归属原用户；单纯延迟清队列也不能撤销已交场馆的请求。这是新宿主需要解决的复用契约，不将其表述为本次已经引入的旧系统缺陷。

关闭条件：新交易宿主控制异步退出/路由离开，明确停止新任务、在途收尾、失败/超时与缓存重置的顺序；强制失效另做故障注入。仅新增编排调用旧阶段函数也须覆盖阶段内部的异步分支。不能满足时不开放 S2，不偷偷修改旧执行器或强制取消对冲腿。

设计处置：方案 4、5、7 已限制交易宿主；强制失效及完整复用契约未解决。阻断 S2。

### A05 / P1：URL 隔离不等于鉴权和浏览器存储隔离

证据：[browser_session](../../server/backend/core/auth/browser_session.js) 使用 HttpOnly、`Path=/`、SameSite Cookie；[web_session_security](../../server/backend/core/auth/web_session_security.js) 校验 Origin 和 CSRF；[pmVault store](../../client/web/src/security/pmVault/store.ts) 使用 IndexedDB；[retainedPmSession](../../client/web/src/security/pmVault/retainedPmSession.ts) 使用 localStorage 和锁事件。

影响：同源 `/listener/` 与原页面共享多种持久状态；独立 origin 则不能假设沿用原登录 Cookie、密钥与允许的 Origin。专用浏览器配置文件也不能自动隔离扩展/场馆/服务端的账号状态。

关闭条件：S1 前明确选定拓扑，验证 Cookie、认证恢复、Origin/CSRF、证书/插件门控、WS 握手、钱包和登出影响。只读版不加载/解锁真实钱包。不得为接入新域名放宽既有普通用户的鉴权规则。

设计处置：方案 8 已写入约束；具体拓扑及验证未完成。阻断 S1/S2。

### A06 / P1：新客户端自己的锁不能约束旧入口或其他设备

证据：[betTiming](../../client/web/src/shared/betTiming.ts) 同时使用模块内存和 sessionStorage；原执行链还可经平台 adapter/扩展直连场馆。旧客户端没有新增运行时租约协议。

触发：同一个场馆账号同时在正式页、试用页或另一设备运行；仅锁合并盘口 ID 也可能漏掉两个不同合并 ID 对同一来源盘口的竞争。

影响：新运行时“最多一笔执行”只保证自己的串行，不能证明账户全局互斥。

处置依据：用户明确保证同一用户不同时使用新旧网页，方案接受这一使用前提。本次不实现跨网页/跨设备的分布式互斥，不修改旧客户端，不要求服务端租约，也不再要求先证明跨入口自动互斥才能实施。原账号 owner 隔离保持不变。

设计处置：按用户确认接受，不再阻断 S2。新网页内部的任务去重、重复启动防护和单执行器仍按方案验证；它们不属于跨网页互斥。

### A07 / P1：原主循环维护语义必须在新宿主完整对照

证据：[mainBetLoop](../../client/web/src/stores/match/mainBetLoop.ts) 包含列表失败早退、30s 列表门控、60s 补单 prune、10min 初赔、自动开启与附加任务；[runArbBetRound](../../client/web/src/stores/betting/runArbBetRound.ts) 在补绑后套利、再按最新队列处理补单/待确认原单。[checkArbLegs](../../client/web/src/stores/betting/autoBet/phases/checkArbLegs.ts) 设置账号 active；[balanceRefresh](../../client/web/src/stores/account/balanceRefresh.ts) 据此跳过账号；原 finally 清 active。

影响：只用事件触发 execute，会漏维护；后台周期清 active 又会使交易中账号被余额刷新。复制“套利前”和“套利后”几行不证明时序一致。

关闭条件：维护责任表逐项有实现、失败路径和测试；执行、维护、余额和补单共享明确的调度边界。App 已启动的监控不能重复安装。原 100ms 循环不用于给监听执行“顺便收尾”。

设计处置：方案 7 提供核对表；尚无实现。阻断 S2。

### A08 / P1：后台名单需要服务端准入、能力区分和撤销合同

证据：当前只有既有鉴权 API，没有本方案的监听准入端点。原 `Client_GetUserInfo` 客户端忽略未认识字段，无法据此约束旧客户端；原 `Setting` 可以通过更新接口修改。

影响：前端名单/新响应字段不是服务端准入；允许进入预览不应自动获得真实交易能力；撤名单也不会自动停止已初始化的任务。

关闭条件：仅新入口调用的服务端身份核验，明确 `observe/execute`、用户/会话/构建身份、配置版本及失效/撤销规则；依据服务端真实身份匹配。S0 不需要生产端点；S1/S2 不修改旧 GetUserInfo/Setting 协议，也不假设所有场馆直连都受新端点拦截。

设计处置：方案 5、8 已明确；准入服务与撤销合同待定。阻断 S1/S2。

### A09 / P2：独立源码必须同时隔离默认类型检查和验证输入

证据：[tsconfig.app](../../client/web/tsconfig.app.json) 包含所有 src TS/Vue 与测试；[tsconfig.node](../../client/web/tsconfig.node.json) 包含现有 vite、scripts；[默认 Vitest 配置](../../client/web/vite.config.ts) 同样扫描默认路径。

影响：正式代码不导入新增文件，也可能因默认类型检查、生成声明或测试加载而失败。新目录放在外面后，原类型检查又不会自动验证它。

关闭条件：新增目录在上述扫描范围外；专用 app/node/测试配置严格检查新增内容，构建缓存和 dts 独立；记录真实的复用源解析及所需声明。不修改根 workspace/lock 来图省事。

设计处置：方案 3、9、10 已纳入；未实施验证。阻断 S0 构建验收。

### A10 / P2：构建映射及模块单实例需要解析证据

证据：原配置用通用 `@` 指向 `client/web/src`，已有 client-core 等路径映射；store 与 bridge 内部有模块级状态和全局注册。[matchStore](../../client/web/src/stores/matchStore.ts) 静态导入原 mainBetLoop。

影响：在通用映射之后追加精确映射可能失效；宽泛替换或重复解析能生成两份 Pinia/store/bridge。静态包含旧循环代码不等于旧循环已启动。

关闭条件：专用配置精确且顺序确定；TS/Vite/测试一致；导出签名核对；解析图与运行 spy 共同证明只启动一个调度器。不得映射整个 stores/betting 来隐藏原行为变化。

设计处置：方案 4、V03 已明确；未有构建证据。阻断构建/运行验收。

### A11 / P2：独立路径需要自己的路由、资源和刷新合同

证据：[router](../../client/web/src/router/index.ts) 使用 `createWebHistory("/")`；默认 Vite base 为 `/`；存在 `/sports`、管理页、登录重定向和 [chunkReload](../../client/web/src/shared/chunkReload.ts) 的全页刷新行为；部分 `/esport2/assets/` 资源由 backend 提供。

影响：只改 Vite base 后，新页仍可能导航到旧首页，最终启动旧循环；懒加载失败后的刷新可能落入错误静态回退。

关闭条件：新入口、history base、资源 base、深链接、WS/API 路径、图片/字体、错误刷新全部验收。原入口和路由保持不动；第一版不可支持的导航在新宿主明确限制，不能静默跳入旧交易页。

设计处置：方案 8、9、V07 已记录；S1 拓扑未定。阻断 S1 发布验收。

### A12 / P2：仅监听价格或使用尾部 debounce 会漏触发/饥饿

证据：实时读赔使用 store/bridge；[PM tick 元数据维护](../../client/web/src/runtime/pmTickBufferQuotes.ts) 会失效报价规则；[现有旁路盯盘](../../client/web/src/extensions/arbMarketWatch/marketWatchLoop.ts) 使用全量订阅加尾部 debounce 和兜底，它不是逐盘口调度器。

影响：规则/盘口对象变化、解封、账号恢复或时间门槛可能在价格不变时出现机会；持续推送可能推迟尾部处理；按 betId 保存旧对象会继续检测已替换盘口。

关闭条件：结构/报价/规则/账号/配置/时间触发清单，有界最大等待、合并去重、公平调度、当前对象校验、连续行情压力与定时恢复测试。对照测试使用相同平台范围和账号利润覆盖，不能把全市场展示范围当作可执行范围。

设计处置：方案 6、V04 已纳入；未验证。阻断检测正确性验收。

### A13 / P2：复用纯检测与复用业务编排必须分开

证据：[detectArbLegs](../../client/packages/arb-core/src/arbitrage/detectArbLegs.ts) 读取模型报价并缓存快照；[prepareArbAttempt](../../client/web/src/stores/betting/autoBet/phases/prepareArbAttempt.ts) 会 updateOdds、随机改 config.betMoney、选号并触发执行占位/进度；[watchSinks](../../client/web/src/extensions/arbMarketWatch/watchSinks.ts) 能调用消息发送；现有采集链可能上报平台数据。

影响：在 watcher 中调用 prepare 可因自身写入重复唤醒；只读模式复用“盯盘”或完整 collector 也可能产生保存和通知；持续机会可能无界重试，或只跨阈值一次导致永久不再尝试。

关闭条件：只读阶段仅用新的只读报价适配和纯检测；记录允许依赖/操作清单。明确机会保持、失败冷却、成功后再检与账号历史门槛的合同，不改变正式版规则。相同输入的检测一致不代表相同下单资格。

设计处置：方案 5、6 已收紧；未实现验证。阻断 S0/S1 只读及 S2 调度验收。

### A14 / P2：独立前端仍可能影响共享服务和账号

证据：API、市场 hub、浏览器采集与 RDS 有共享链路，见 [AGENTS](../../AGENTS.md) 和 [独立部署](../INDEPENDENT_DEPLOYMENT.md)。VPS 平台独占写规则、内嵌 matcher 和现有进程布局必须保留。

影响：逐盘口立即重试可能增加预检/下单/日志负载；为试用启动完整后端可能额外运行采集和 matcher；新入口仍可能用同一浏览器扩展、场馆限额或生产数据。

关闭条件：S0 零网络；S1/S2 在接入前给定连接、QPS、并发、队列、超时、重试和熔断预算并测量。不开新生产采集器/matcher，不使用生产 storage 启动另一套完整 backend，不把“新目录”当作资源隔离。

设计处置：方案 1、5、9、V10 已明确；实际预算未知。阻断 S1/S2 接入。

### A15 / P2：冻结旧源码不能替代制品和工作区证据

证据：审计时工作区已有他人修改；默认构建仍读取同一批共享包、Node/npm 和安装依赖；正式发布另有运行身份及版本指针。此次锚点 JSON 只覆盖 37 个文件。

影响：仅比较 Git HEAD 或几个旧文件，可能忽略既有未提交差异、依赖/配置变化、错误产物路径和部署版本；不能把本次文档审计视为业务回归已通过。

关闭条件：实施前完整工作区/候选输入清单、依赖身份、正式部署文件清单与模块图；构建/运行/发布证据分别记录。禁止为了通过审计重置他人修改、改旧冻结基线或声称已验证生产。每次实施更新基线而不是修改历史锚点来隐藏变化。

设计处置：方案 1、3、9、V01/V02 已明确；当前仅有设计锚点。阻断正式隔离验收。

## 4. 本次已经执行的核查

1. 读取相关源码、配置、发布与鉴权实现，核实上文证据。
2. 调用现有 `classifyDeployScope` 和 `validationPlan`：

   | 输入 | 部署范围 | 验证计划 |
   | --- | --- | --- |
   | 本次新增的三个 docs 文件 | noop | docs，checks 为空 |
   | 假设新增 `client/listener/runtime/session.ts` | full | router-compile、backend、frontend、build |

3. 保存并复核 37 个源码锚点指纹，全部未变；检查两份 Markdown 的 48 个本地相对链接，无缺失目标、无行尾空白；发现数核对为 15 项（P1 8 项、P2 7 项）。
4. 运行 `npm run check:change:plan`，命令成功返回 plan-only，`accepted=false`（未执行验收）。整个工作区计划为 full，原因是既有 `packages/shared/catalog/venues/ray.ts`、`ray.test.ts`、`packages/shared/package.json` 和 `scripts/catalog-smoke.mjs` 变化；本次三个 docs 文件单独分类仍是 docs/noop，不触发代码检查。没有通过改参数降低全工作区的分类，也没有把这些既有变化的代码检查记为已通过。

本次是文档变化，按 AGENTS 不执行前后端代码回归、构建或历史 FOK 全量审计。工作区其他已有代码修改不因这次文档审计而获得测试通过结论。

## 5. 后续实施前的关闭顺序

1. 按新只读入口落实 S0 的输入/依赖/输出合同，避免直接导入原 App/交易启动链；完成独立类型与回放测试。
2. 审查新目录的边界与 CI 归属，证明不会借 master 自动发布正式系统；这一步先于任何自动发布推送。
3. 为 S1 确定实际入口和鉴权/存储拓扑、只读行情来源及请求预算，做失败注入和网络副作用验证。
4. 为 S2 关闭 A04/A07/A08：在途与强制失效、维护语义和准入撤销。A06 已按用户不并行使用新旧网页的确认接受，不再要求额外互斥实现。其他条件不能满足则继续只读，不修改旧函数补救。
5. 为独立试用发布建立制品身份、路径保护、健康检查和回滚证据；普通用户仍使用原产物。

本轮交付仅为方案、全面审计及证据锚点。没有实现、提交、推送或部署新模式。
