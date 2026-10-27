# 共享包如何划分前端与后端

[changmen 扩展] 2026-10-20 catalog 配置分离：`packages/shared/catalog/game_catalog.ts` 不再读取 `process.env`，筛选函数显式接收可选配置字符串，省略时选择全部电竞条目。服务端环境读取位于 `server/storage/game_catalog.ts`，由 `@changmen/storage/game_catalog` 公开；7 处 ESM 与 2 处 CJS 消费点已迁移，每次调用仍读取最新的 `AGGREGATE_GAME_CODES`。静态映射、浏览器入口和 catalog JSON 不变。原生对照测试覆盖未设置、空值、通配符、大小写、分隔符、未知值及导入后修改配置；源码基线保持原值。

[changmen 扩展] 2026-10-20 入口退役：595 个旧浏览器源码及测试入口已删除，Web 直接依赖 `@changmen/venue-browser`；旧 Vite/TS 别名和浏览器 exports 已移除。历史完整源码验证继续核对同一批客户端实现，真实目录与依赖检查禁止旧入口回流。以下迁移记录按历史保留。

[changmen 扩展] 2026-10-20 当前源码位置：`packages/venue-adapter` 剩余的 180 个浏览器实现/注册模块已归入 `client/packages/venue-browser/adapter/`，183 个测试正文随实现迁入。此前迁出的 PM 实现继续使用原客户端路径；旧包中的浏览器源码只保留转导出及测试入口。Node loader/registry 主实现仍在 `server/packages/`，旧包的 Node 资源根与打包工具继续保留。此处只收尾物理归属，不调整生产发布选择或数据库维护流程。逐文件位置、完整正文和 import 调整证明接入 `check:boundaries`，原冻结与 551 项源码基线不变；以下按日期保留历史调查。

[changmen 扩展] 2026-10-17 后续方案见 [PM 模块解耦与验证、发布流程精简](./PM_MODULE_DECOUPLING_AND_RELEASE_PLAN_20261017.md)：区分浏览器/Node/双端入口，以实际消费者证据分别选择验证、构建、发布。仅设计，尚未修改目录、分类器、运行版本指纹或发布流程；下文历史调查继续保留。

第四轮依赖核对，2026-10-15，代码基线 `9aa9159c`。本轮不拆包、不移动代码、不调整发布分类。

共享包不需要复制为前后端两套。优先保留同一份协议与纯逻辑，将浏览器专属实现、Node 专属实现和双端共用内容通过明确入口隔离。包名和目录名不能作为“只需发布前端”的证据。

## 已核对的入口

[2026-10-17 源码隔离批次](SOURCE_FILE_ISOLATION_20261017.md)已把真正共用的队伍身份/ID/时间窗实现迁到 `packages/shared/match-identity`；旧 identity 包是兼容入口，resolver 仍属于后端。RDS 直接消费共享规则；浏览器诊断与 RDS 维护实现也已有明确物理子树。源码归属检查不替代安装隔离，冻结 Node 入口、旧资产及工具仍有保留项。

| 包或入口 | 消费证据 | 判断 |
| --- | --- | --- |
| `api-contract` | `client/web/src/api/client.ts` 使用 envelope 和 URL；backend workspace 声明依赖并消费 action/DTO | HTTP 协议继续共享，不能复制成可能漂移的两套定义 |
| `shared` | package exports 提供 catalog、时间、赔率、账号与订单公共规则；Node loader 的 `requireShared()` 动态解析这些入口；Vite 将其打入共用 chunk | 按入口核对，不能将整个包归为浏览器专用，也不能仅凭存在 `.browser.ts` 宣称无 Node 关联 |
| `shared/catalog/game_catalog.browser.ts` | 转导出纯 `game_catalog.js` 的子集；环境读取已迁至 `@changmen/storage/game_catalog` | 浏览器和共享计算无宿主环境读取；服务端通过公开配置入口保留原筛选语义 |
| `client-core` | `client/web/src/api/client.ts` 使用 `shared/a8Axios`，adapter 声明依赖 | 面向客户端的能力有独立归属；不能据此假定其每个文件都已经证明只被浏览器消费 |
| `venue-adapter/loader` | backend 的 `core/shared/adapter_paths.js` 经新 `venue-node-loader` workspace 转导出原 loader 定义；loader 动态提供 `requirePlatform` 和 `reqS` | Node 加载入口，源码与旧入口保留，不能搬成前端独占包 |
| `venue-adapter/contract`、`registry`、共享 manifest | 浏览器 runtime 使用 contract，客户端注册 adapter；Node loader 使用 registry/manifest；resolver 的 adapter 声明仅供辅助 scraper 开发工具使用 | Node registry 公开入口已单独登记；相邻浏览器 TS 和 manifest 共用关系仍在，实际发布分类仍保守处理 |
| 平台 adapter 的采集/下注实现 | 浏览器 Vite alias 指向整个 adapter 包，按场馆产生 chunk；部分平台 shared 子目录也允许 Node 消费 | 只有追踪实际 import、动态加载和构建输入后，才能逐文件认定浏览器专属 |
| adapter 的瘦包构建 | `scripts/sync-backend-bundle.mjs` 会复制 registry、loader、shared、contract 等基础目录；可选参数还能包含浏览器源码 | 搬目录或裁剪发布必须检查生成产物，不能只搜索静态 import |
| `@changmen/db` | `server/db` 独立数据包；backend 通过公开领域入口消费 | 已经是服务端专属；浏览器不得依赖其实现或 RDS 结构 |

## 后续执行顺序

1. 为候选“浏览器专属”入口建立消费者清单：静态 import/re-export、动态 loader、Vite alias、瘦包同步、workspace 和 lockfile。
2. 先限制入口和依赖方向，再考虑是否拆成不同 npm workspace。双端纯逻辑只有一份；Node 连接池、文件系统、鉴权密钥与浏览器 DOM、采集会话各归所属端。
3. 用负向样本证明：浏览器专属实现一旦新增服务端或构建消费者，检查会失败，发布分类不能继续省略后端。
4. 最后按实际消费者调整发布范围，保留共享协议、manifest、loader 与未知路径的保守规则。

当前 `check:boundaries` 已限制服务端访问平台实现并检查各层方向；2026-10-17 的批次 A 进一步加入 22 个入口清单、双向源码闭包和消费者记录，能拒绝 Node 经共享 barrel 到达浏览器入口，也限制浏览器到达已登记 Node 入口。`registry/adapters` 单独属于浏览器入口，不能因 `registry` 目录整体获准而绕过。该检查仍不是完整的发布依赖证明：动态 loader、未知别名、安装与构建效果及线上旧树尚未全部收口，实际发布分类继续保守处理。详见 [批次 A 验证记录](audits/PM_COMPONENT_ENTRY_BOUNDARY_AUDIT_20261017.md)。

`packages/venue-adapter/package.json` 仍同时包含客户端和服务端依赖。B 后已用原目录内的 Node workspace 收口 backend 的入口声明，resolver 主运行依赖也已剥离整个 adapter；声明闭包有持续门禁，但真实定向安装仍带浏览器链接和 Vue，尚未取得安装 / 发布独立性。见 [Node 入口依赖验证](audits/PM_NODE_ENTRY_DEPENDENCY_AUDIT_20261017.md)。仅把文件夹改名为 frontend/backend 无法消除这种耦合。

PM 范围的动态输入已进一步登记53处，并核对其最近安装副本和lock位置；前轮发现的 hash、Vue、builder SDK 宿主/传递声明问题已在[依赖声明与干净安装验证](audits/PM_ADAPTER_DEPENDENCY_INSTALL_AUDIT_20261017.md)中处理：3个直接运行依赖保持原解析版本，Vue由web提供optional peer，两次干净安装30项解析一致。四个SDK仍为两端源码共用，20条共享loader/DB查找不确定记录继续保留。哪些变化影响独立发布、哪些只是浏览器构建职责，见[动态依赖专项](audits/PM_DYNAMIC_DEPENDENCY_AUDIT_20261017.md)；实际发布分类保持原状。

这20条已在[共享loader证据批次](audits/PM_SHARED_LOADER_EVIDENCE_AUDIT_20261017.md)逐项分为12条固定目标、3条环境相关、5条参数未知，保留 `closed:false`。固定相对目标不等于固定生产根目录；原loader与registry还有不同根目录选择。外部覆盖、manifest预加载及开放API仍按候选变化判断；不能据此永久否决纯浏览器改动，也不能绕过旧树/构建/发布控制证明。

独立修改、独立验证与独立发布应分别判断：数据库查询内部变化通常无需修改前端，但仍需验证既有接口；只有证据充分时才省略另一端发布。详见[解耦方案批次 4](FRONTEND_BACKEND_RDS_DECOUPLING_PLAN.md#批次-4-缩小发布范围)。

[changmen 扩展] [B批浏览器模块拆分](audits/PM_BROWSER_MODULE_EXTRACTION_AUDIT_20261017.md)已完成：`packages/pm-market-data-browser` 独立承接公共簿核心和Worker循环，宿主显式注入只读行情源，adapter保留兼容入口及HTTP/模拟消费者。新包没有运行时adapter、Vue、账号、HTTP或下单依赖；纯核心隔离门禁已接入原边界检查。首次workspace/lock变更仍按原保守范围完成安装与两端验证，不启用C–E或缩小实际发布范围。
