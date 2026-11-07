# PM 用户直连行情：官方 SDK 接管评估

[changmen 扩展] 2026-11-07。状态：**基础能力已验证，完整接管尚未具备无差异替换条件**。本轮仅评估、离线实验与文档，不改运行代码，不调整项目依赖，不提交、push 或部署。用户暂缓的报价时钟/迟到 HTTP 改造继续暂缓。

## 1. 决策结论

建议采用官方 SDK 承担用户直连行情的协议、订阅、心跳、重连与事件标准化；但不能立即把现有 `ws.ts` 替换成一次 `client.subscribe()` 就宣告完成。

已经验证的能力足以支撑卖一展示。尚需闭合的是 CHANGMEN 对连接取消、实际连接状态、回退互斥以及本地簿旁路的依赖。**建议下一批先验证 SDK 会话适配原型，不直接切换生产主链路。** 若原型不能保证这些行为，就保留既有 transport，不能以移除原功能来获得表面上的迁移成功。

“SDK 能广泛使用”是功能覆盖结论；“当前版本能否完整接管现有链路”还包含应用兼容性与生命周期要求。两者不能混为一谈。

## 2. 评估范围与版本

目标保持为同一 token 的官网订单簿卖一，经现有缓存持续更新到页面。只评估主行情官方直连；转发回退需保留兼容，但不改 VPS。独立体育 transport、HTTP 全面迁移、账户、签名、FOK/GTC 提交及订单确认不在本批迁移范围。

| 对象 | 本轮事实 |
| --- | --- |
| 项目当前统一 SDK | `@polymarket/client@0.12.0`，已用于钱包准备，未接管主行情 |
| 官方当前发布版 | 查询 npm 官方 registry 的 latest 得到 `0.17.0`，仅装入忽略的独立评估目录 |
| 版本隔离 | 项目根、web、行情包 package.json 与根 package-lock.json 的前后 SHA-256 一致 |
| 事件与连接实验 | 两版各 14 项，合计 28 项通过；包含对限制行为的断言，通过不代表所有接管条件都满足 |
| 浏览器构建 | 两版独立入口均能构建为 browser ESM；没有把 Node 入口用于浏览器 |

资料：重新查阅 [官方 TypeScript SDK](https://docs.polymarket.com/getting-started/typescript)、[实时行情](https://docs.polymarket.com/market-data/realtime-data)、[迁移指南](https://docs.polymarket.com/migrate/clob-sdk-to-unified-sdk)。官方 GitHub main 也显示版本 0.17.0；本轮运行判断以实际安装的两个发布包为依据，没有把 main 源码当作已安装版本。

后续原型可先以项目已安装的 0.12.0 为基线。0.17.0 用于确认发布新版是否已解决接口缺口；当前没有证据要求先升级整个项目 SDK。若后续选择升级，钱包准备、共享 bindings 类型等另列兼容范围。

### 2.1 是否需要现在升级项目

**针对本次卖一实时显示与行情接管：暂不需要，先保持项目 0.12.0。** 两版已验证相同的所需行情能力，也有相同的取消及观测缺口，单纯升级不能替代适配。

进一步核对 [官方 SDK 更新记录](https://docs.polymarket.com/changelog/sdks)：0.14 增加的是 HTTP/RPC 的 fetch、signal、重试和超时控制，不能据此认为 Market WS 已有取消接口；0.15 有受保护市场买单的份额/金额修复；0.17 有活动类型兼容及导入后保留堆内存优化。它们有独立升级价值，但未发现本次行情接管必须先升级的要求。

跨版本也存在 API/类型变化，包括 0.14 的服务请求及依赖变化、0.16 移除 accounting snapshot、0.17 活动类型变化。是否影响 CHANGMEN 要逐项核对实际调用，不能仅凭版本号认定兼容或必然不兼容。当前统一 SDK 用于钱包准备、授权和相关 signer；当前主订单构建还使用 clob-client-v2，不能把统一 SDK 市场订单修复直接宣称为已修复本项目现有下单实现。

建议顺序：先验证行情会话适配；项目依赖升级另列批次，核对钱包准备、认证/签名适配、授权缓存和 SDK 类型，并跑对应回归。不是永久冻结旧版，也不把当前 28 项隔离行情实验当作整个项目升级验收。

## 3. SDK 可以接管的部分

| 功能 | 离线验证结论 | 接入后的分工 |
| --- | --- | --- |
| 初始订阅、多资产并集 | 使用同一个 client 时复用一个 Market socket | SDK 管协议与服务端集合；应用决定当前资产 |
| 增订、退订、共享资产 | 只发送实际新增/移除；最后一个引用退出才退订 | 移除自建官方差集发送逻辑，保留业务消费者登记 |
| 更新资产集合 | 先取得包含新集合的 handle，再关闭旧 handle，保留资产不重订 | 应用串行协调 handle 替换、输出所有权和清理；SDK 管报文 |
| BBO、price_change、book | 标准化事件可消费；无 book 时 price_change 也能提供有效 ask | 应用按事件类型提取卖一，写现有报价入口 |
| 明确空卖盘 | 空 asks 被完整交付；bestAsk=1 原样交付 | 应用必须让旧可买价失效，SDK 不替应用清缓存 |
| tick_size_change | 输出 assetId、新 tick 与源时间 | 适配到现有 tick 管理，保留预检规则 |
| 心跳与失活重连 | 10 秒 PING；安静但有 PONG 不重连；PONG 失活后重连 | 由 SDK 执行，不叠加第二套心跳/重连循环 |
| 重连恢复 | 当前订阅并集恢复，原 handle 继续读事件，旧 socket 价格不串入 | SDK 管恢复；应用仍须获知连接边界以维护现有业务 |
| 已取得 handle 的正常关闭 | 最后 handle 正常关闭后结束迭代并停止重连 | 应用负责退出、换源时释放所有 handle |

两版运行中 `timestamp` 均被标准化为数值，价格仍为十进制字符串。应按对应安装版本的公开类型及运行结果接入，不能照搬网页示例中的字符串时间，也不能把标准化 camelCase 事件送给当前只读 snake_case 的解析器。

## 4. 完整接管的三个缺口

### 4.1 连接状态与重连边界没有公开通知

两版 `MarketSubscription` 的公开参数仅包括市场主题、资产集合和自定义事件开关；返回 handle 提供事件迭代及 `close()`。没有 Market 连接开闭、原始帧或重连代次回调。SDK 初次 subscribe 成功返回能表明初始连接已建立，但不能提供此后的每次断开/重连状态。

实验主动关闭 socket：SDK 自动创建新连接并恢复订阅，原 `iterator.next()` 持续等待，既不返回断线事件也不抛出临时断线错误；只有下一条行情才继续返回。这对持续消费行情有用，但无法直接驱动现有连接状态逻辑。

真实受影响入口：

- [ws.ts](../client/packages/venue-browser/polymarket/ws.ts)：状态角标、连接/首帧指标、连接超时、自动回退。
- [pmTickState.ts](../client/packages/venue-browser/polymarket/pmTickState.ts)：连接恢复后触发 tick 补查。
- [marketStream.ts](../client/packages/venue-browser/polymarket/marketStream.ts)：向只读消费者提供实际连接身份、开闭状态及帧顺序。
- [pmMarketClientMetrics.ts](../client/packages/venue-browser/polymarket/pmMarketClientMetrics.ts)：连接次数与连接耗时，不应以收到报价的时间冒充。

不能把安静盘口无价格变化当断线，也不能把每一条 book 当作新连接。`PublicClient` 对象中标记 `@internal` 的 webSockets 管理器及 SDK 私有类不是本方案允许依赖的稳定公开接口。

### 4.2 外层超时不等于取消连接

两版实验保持握手既不成功也不报错：外层 15 秒 `Promise.race` 已超时，推进至 60 秒后 SDK subscribe 仍在等待；随后模拟合法的迟到 open，原 SDK 仍会发送 market 订阅。

这说明：直接在 race 超时后启动 relay，不能证明官方连接已经释放，存在两条线路同时运行的可能。实验没有真的启动第二条 relay，也没有声称生产必然发生双连接；它证明了 race 不提供取消保证。

另一个实验延迟 native close 事件：handle.close() 也会持续等待，外层超时同样不能证明释放完成。SDK 内部连接类有可选超时，但本轮核对的 Market manager 和公开配置没有把相应取消/超时能力开放出来。升级至 0.17.0 未消除此限制。

接管前必须证明：连接中取消、换源、退出以及关闭迟迟未完成时，旧会话都不会再订阅、广播或继续重连。不能用超时后仅忽略 Promise 的方式代替清理。

### 4.3 原始流旁路需要等价衔接

现有 [pm-book-source-host.ts](../client/packages/venue-browser/pm-book-source-host.ts) 复用唯一主行情流；[passiveBookFeed.ts](../client/packages/pm-market-data-browser/src/passiveBookFeed.ts) 和 [service.ts](../client/packages/pm-market-data-browser/src/service.ts) 依赖 raw、连接 epoch、open 和连续 sequence，在断线或缺帧后使旧簿失效。

SDK 公开事件提供标准化内容，没有原始帧及断线边界。标准化事件可以通过明确的新契约适配，但重新 JSON.stringify 并不能证明还原了原始帧、原始接收时刻和连接身份。即使旁路默认关闭，也不能在迁移时静默删除已存在的可选能力。

## 5. 方案选择

| 方案 | 判断 |
| --- | --- |
| 直接使用公开 subscribe 替换全部官方 transport | 卖一基础路径可行；当前完整功能不等价，不建议直接上线 |
| SDK 负责协议，专用会话适配层负责宿主生命周期及既有观测接口 | 推荐继续做隔离原型；先证明取消、单连接和重连观测，再决定正式迁移 |
| 保留旧官方 socket，再开 SDK socket 接主价格 | 不采用；存在双连接与重复输入，无法满足唯一行情所有者要求 |
| 直接引用 SDK 私有类或 internal 管理器 | 不采用为默认实现；容易把版本内部结构当作稳定接口 |
| 只升级 SDK 到 0.17.0 | 不能自动解决上述三个缺口；共享钱包及类型还需独立兼容验证 |

专用 Worker 是会话适配原型的一个候选：让 SDK 在专用 Worker 中成为唯一直连所有者，在该隔离环境验证 native socket 的观测、关闭和整个 Worker 的结束，向宿主转发真实生命周期与事件。它不要求改 SDK 协议源码，也不应在 window 上替换全局 WebSocket。**这只是待验证候选**，不是本轮已经证明可用于浏览器生产的方案；隔离环境中的 WebSocket 包装也属于应用需要维护的适配，不能宣称完全无自有代码。

另一候选是使用官方后续明确支持的连接观测与取消接口。若选择升级或补丁，须重新核对具体发布包；本轮不默认修改或 fork SDK。

## 6. 下一批原型的具体任务与验收

1. **会话生命周期原型。** 只用一个 PublicClient，验证连接中取消、正常关闭、close 迟到、退出后迟到 open、失活重连和换源。将待连接 socket、handle、迭代器和 Worker 的所有权列清；确认清理失败时不能同时启动第二条业务行情线。
2. **观测与控制事件原型。** 从真实连接边界驱动现有状态、tick 重连补查及 marketStream；区分实际连接状态与报价是否可用。若采用 Worker 观测，须在浏览器验证，不能把本轮 Node 内存 socket 测试当作 Worker 验收。
3. **报价适配原型。** 将 SDK 的 book/BBO/price_change/tick 事件接到现有语义入口；覆盖单侧初始化、有效升降价、空盘、缺字段、恢复与重连。handle 更换时明确谁能输出，覆盖并发资产变更和旧迭代器迟到输出，避免重放覆盖新价。
4. **旁路与转发兼容。** 验证本地簿开关前后、断线使簿失效、帧顺序及缓冲限制。relay 仍使用原协议并保持互斥；也覆盖先前审计 R1 的同版本目录切源问题。此处不改 VPS。
5. **浏览器与包体实测。** 核对 Worker 创建、CSP、构建路径、后台恢复、消息转发开销，以及实际页面首屏新增字节。保留 SDK 懒加载；不能把钱包路径已有 SDK 依赖误当作首屏必然零增加。
6. **接管验收。** 原型全部闭合后才安排运行代码迁移，按实际范围执行仓库所属模块门禁及构建，覆盖来源切换、快照、tick、页面范围、冻结尝试和 FOK/GTC 相关行为。现场只读对照同一 token 的官方卖一与缓存/页面，不使用真实订单。

应用报价时钟/迟到 HTTP 修复不并入本批；现有连接身份的等价保留是 transport 兼容要求，不代表用户已恢复授权实施新的报价排序算法。R2 空盘问题必须在报价适配中单独验收；SDK 会交付空盘，但不会自动清除 CHANGMEN 的旧缓存。

## 7. 实验结果与证据

两版各 14 项实验覆盖：共享连接与引用、集合替换、BBO 标准化/错误输入、price_change 初始价、空 asks、bestAsk=1、tick、心跳、失活恢复、静默重连、最终关闭、握手 race 不取消、close 等待以及自定义 endpoint。自定义 endpoint 仅证明配置可用，未证明 CHANGMEN relay 与 SDK 差集协议兼容；0.12.0 的 forkEnvironmentConfig 还标记为 experimental。

| 独立浏览器 ESM 入口 | 0.12.0 | 0.17.0 |
| --- | --- | --- |
| 压缩后 JS 字节 | 799,663 | 956,496 |
| gzip 字节 | 196,442 | 233,124 |

这是 esbuild 0.28.2 对 `createPublicClient()` 独立入口的构建结果，**不是 CHANGMEN 首屏实际增量**，也不是实际浏览器运行或性能验收。与现有 SDK chunk 的复用和业务导入时机尚未测量。

可复核证据：

- [版本、用例结果、包体和源码指纹](./audits/2026-11-07-pm-sdk-evaluation/results.json)
- [独立离线用例](./audits/2026-11-07-pm-sdk-evaluation/sdk-evaluation.test.mjs)
- [专用 Vitest 配置](./audits/2026-11-07-pm-sdk-evaluation/vitest.config.mjs)
- 本机完整日志、两版发布包及隔离安装记录位于被忽略的 `output/pm-sdk-evaluation/`。

仓库根执行本机 0.12.0 用例：

```powershell
npm exec -- vitest run --config docs/audits/2026-11-07-pm-sdk-evaluation/vitest.config.mjs
```

0.17.0 在 `output/pm-sdk-evaluation/sdk-0.17/` 中独立安装，使用 `--workspaces=false --ignore-scripts --package-lock=false`，未修改项目依赖。指定 `PM_SDK_EVAL_ENTRY` 为该包 `dist/index.js` 的绝对 file URL、`PM_SDK_EVAL_VERSION=0.17.0` 后运行同一配置即可复现；用例会校验实际加载版本。运行完恢复这两个环境变量。

本轮没有修改客户端运行源码，因此不为评估文档和隔离实验重跑整套业务门禁；上一轮 7,951 项前端通过保留为上次运行代码的检查记录，不计作 SDK 迁移验收。真实网络、官网延迟、浏览器 Worker 适配、既有全链路兼容均尚未验收。
