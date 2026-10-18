# PM 浏览器订单簿模块拆分（批次 B）

[changmen 扩展] 2026-10-17，工作目录 `E:\River\arb\changmen`，提交基线 `abdfce46d46f562c208ea0d832b6cafc02fd2360`。承接[解耦与发布方案](../PM_MODULE_DECOUPLING_AND_RELEASE_PLAN_20261017.md)的批次 B。**浏览器核心拆包、宿主注入和相关回归已在本机完成；未 commit/push、未部署，C–E 未实施。**

本批保留此前 A 及依赖收口的未提交内容。工作树中另有 `server/realtime-hub/README.md`、`pm_maintenance.js`、`pm_maintenance.test.mjs` 的并行改动，本批没有编辑或回退。后端回归覆盖当前工作树，但本报告不审议这些并行业务改动的设计或生产发布资格。

## 实际改造

| 部分 | 现在的归属和行为 |
| --- | --- |
| 公共簿核心 | 新 workspace `@changmen/pm-market-data-browser`：归并、被动 feed、历史、完整/展示读取、服务、FIFO 与协议 |
| 服务宿主 | web 的 `pmMarketData.ts` 显式注入只读 source、Worker 工厂、授权与单调时钟；原登录、模式、账号、线路门控保留 |
| 原行情源 | adapter 新入口 `polymarket/orderBookSource` 只封装既有 `observePmMarketStream` 和 esport 资产查询；没有订阅、发送或重连方法 |
| Worker 核心 | 新包 `workerRuntime.ts` 处理原 FIFO、输入位置、读期限、深度和 ACK；纯 Worker 入口没有诊断消费者或 HTTP |
| 动态消费者 | `wsBook/workerDiagnostics.ts` 装配原 `WsBookShadowRuntime`，只获得公共 BookReader、generation 和自身输出通道 |
| 兼容入口 | adapter 旧核心/FIFO 路径转导出新包，旧 service 构造签名通过薄适配器注入原 source；原 `orderBook.ts` 工厂继续有效 |
| 协议 | `marketStreamProtocol` 和 `serviceProtocol` 只有新包一份定义，旧路径兼容转导出；宿主回调不跨 Worker 传输 |

HTTP 元数据、公开 HTTP probe、新鲜度、完整读取后的只读执行模拟和原观察插槽继续属于 adapter 浏览器消费者，没有搬进纯核心或改动实际预检返回值。web 使用独立 source 入口，避免为取得只读行情源而带入旧 Worker 工厂。带诊断的 web Worker 和旧兼容 Worker 共用组合实现，每个授权服务仍只创建一个 Worker。

可选诊断的构造、消息或停止异常不终止公共簿；撤销后的诊断通道拒绝迟到输出，不能投递到后续 scope。该隔离只在新 Worker 组合端口内，不触及原 HTTP/FOK 决策或订单链路。

## 保持的行为与边界

- 归并、资产级失效、资产代次、快照证据、全部输入 FIFO、16 资产及现有资源限制保持；完整读仍为原 20ms 截止时间、最多 3 次重读。
- 新包不导入 Vue、Pinia、账号、HTTP、签名、下单或 adapter；`@polymarket/client/actions` 仅为开发类型依赖，构建后无 SDK JavaScript。
- 原 `realtime/ws.ts`、quote Hub、`marketStream.ts`、经典 FOK、动态开关安装器和实际 HTTP 预检未改。经典/default/非法模式和总开关关闭继续不启用簿；旁路卸载保留公共簿。
- 原 551 条 manifest、基线提交和精确源码保护不变，未重新录制、未加目录豁免。实际发布分类、change-plan、workflow、远端激活与完整来源指纹实现均未改。
- 本地簿与旁路仍默认关闭，生产旁路仍 NO-GO。本轮没有实现快照恢复，也没有修改新鲜度政策。

一次性迁移比对确认 7 个核心/协议/FIFO 文件只改变相对导入位置；服务从 `private send` 起的全部读取、准入、撤销、超时、失效、释放主体，在还原注入时钟名称后与拆分前一致。证据保存在 `output/pm-browser-module-20261017/migration-equivalence.json`，不作为后续业务实现冻结清单。

## 边界和安装

入口清单从首批 22 项扩展到 27 项；新增纯核心隔离规则，禁止其经导入/转导出到达宿主、adapter、外部运行库或未知加载，只允许明确列出的 SDK 类型。Node 生产入口不能到达新浏览器包，离线 Node 测试仍可测试浏览器源码。PM 清单现为 54 处动态目标、916 个来源绑定有界文件；原 8 个 loader 定义、9 处调用及 20 条共享记录（12 固定、3 环境、5 参数）均保留。

依赖检查区分实际纯类型的开发依赖与运行使用；同一 SDK 子路径后续出现运行导入时必须升级为运行依赖，不能保留 type-only 身份；移除新包自己的类型依赖声明也不能借用宿主安装通过。显式 `backendRequire`、`adapterRequire`、`requirePlatform` 指向新浏览器包同样拒绝，不只保护旧 adapter 目录。新增负向样例验证这些行为。web 深路径清单只将这两个宿主文件的旧工厂入口替换为 `orderBookSource`，未开放整个 PM 目录。

使用 Node 24.20.0、npm 11.16.0 在忽略目录执行一次隔离 `npm ci --offline --ignore-scripts`，安装 847 个包，不复制 `.env`。相对 B 批开始时的 lock，仅增加新 workspace/link 及 root、web、adapter 的 workspace/引用记录，没有已有依赖版本或安装位置改变。主工作区只登记新 workspace junction，没有重装已有依赖。

原 30 项 Node ESM/CJS、Vite client 解析与前批干净安装证据完全一致；新增 5 项浏览器包、Worker、source 和 SDK 类型解析均落在隔离目录，总计 35 项，web/adapter 仍共用一份 Vue。纯簿 Worker 的 5 个构建输入全部来自新包；带诊断 Worker 有 16 个输入，没有从隔离目录逃逸到主工作区依赖。最终解析和 bundle 输入逐项核对当前源码，原安装 lock 未变化，因此没有为源码入口整理重复安装。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 首轮宿主、核心与真实隔离 Worker 专项 | 5 文件 39 项通过 |
| 验证工具及原设置/行情/执行观察边界集合 | 8 文件 207 项通过；收尾补强新包 loader 目标和自身类型声明检查后，再复验 PM 专项 35 项全部通过（与前述集合有重叠，不累加为独立用例数） |
| 前端完整行为回归 | 512 文件通过，3 文件按既有配置跳过；4526 项通过、3 项跳过，未新增 skip |
| `npm run app:build` | 通过，包含 `vue-tsc`；只执行一次完整生产构建，约 58 秒 |
| 生产 Worker 产物 | 一个 `pmMarketData.worker-6o1jiZ-N.js`，24149 字节；宿主产物一个 Worker 创建入口 |
| 后端完整任务集合 | `turbo run test --filter=./server/**...`：12 个任务成功，其中 8 个按既有 Turbo 规则命中缓存，4 个重新执行 |
| API 契约、catalog、client-core、adapter 检查 | 全部通过；adapter exports/internal/web imports 和 esport-freeze 均通过，冻结路径命中 0 |
| `npm run check:boundaries` | 通过；27 入口、54 动态目标、916 文件、原 20 条共享记录保留 |
| 独立 FOK 等价命令及 `npm run check:fok-vps` | 通过，原 551/551；共享边界及 GTC 隔离通过，`fullReleaseAccepted:false` |

早期 adapter 入口检查提示尚未登记新 source 子入口，已将两个既有宿主的精确目标更新后通过；没有扩大路径豁免。正式前端回归和构建均一次通过，未因该工具清单调整重跑应用全量。

可复核日志、隔离安装和源码报告位于忽略目录 `output/pm-browser-module-20261017/`。这些本机记录不替代 CI 对精确提交的发布验收；后端已有缓存结果也不作为新的生产发布批准。

## 完成结论与下一批

**B 批完成：公共簿已有独立浏览器包，平台源和应用授权由宿主注入，原行情和经典 FOK 的固定保护及行为回归通过。**

C 仍需候选与线上各组件旧树的输入比较，分离 validate/build/publish 并输出新旧计划对照；D 需要统一发布控制、版本组合及发布/回滚演练；E 的验证去重未实施。当前 `safeToNarrowPublishScope:false`、`publishScopeOptimizationEnabled:false`、`runtimeRootsCertified:false` 均保持，实际发布范围没有缩小。

本批没有重跑持续真实行情、后台冻结和性能长测；旧版本的覆盖率或性能证据不自动认证这个新产物。结构拆分及离线回归通过，不改变生产旁路 NO-GO 的结论。
