# 团队边界（单仓阶段 0）

changmen 仍为 **一个 monorepo**，通过目录归属、CODEOWNERS 与 `check-team-boundaries` 让**客户端团队**与**服务端团队**可各自维护，减少跨团队改坏对方代码。

**目录层级**（详见 [SPORTS_PRODUCT_LINES.md](./SPORTS_PRODUCT_LINES.md)）：**平台层**（`packages/`、`packages/venue-adapter/`、`server/backend/`…共用）→ **能力层**（`server/match/identity`、`ws_forward`、`value-bet`…可复用引擎）→ **产品线层**（`lines/{code}/` 仅 manifest + `line.json`，电竞代码仍在根目录）。整理目录时改 manifest/文档即可，不必为产品线复制平台包。

完整两仓 / 契约包路线见本文末尾「后续阶段」。

## 当前执行状态（2026-10-18）

[changmen 扩展] 单仓目录及依赖边界、HTTP 契约包已落地；源码隔离、Node 入口与安装验证、Actions 验收收口及文件夹首批迁移按四组完成本地提交，尚未 push 或取得本次 Actions 验收。精简安装、瘦包和进一步独立发布 C–E 暂缓，生产继续沿用原全量安装规则。本次提交以 `master` / `42b07aab` 为起点；下文按批次保留的旧安装统计与验证记录不代表当前提交已获 CI 或生产验收。

| 项目 | 当前状态 | 剩余工作 |
| --- | --- | --- |
| 阶段 0：单仓团队边界 | 目录归属、源码方向和数据库访问门禁已建立 | `.github/CODEOWNERS` 尚不存在，待确定真实负责人后启用 |
| 阶段 1：HTTP 契约 | `@changmen/api-contract`、OpenAPI、`VITE_API_BASE` 已完成 | 持续维护线协议兼容 |
| 阶段 2：客户端共享层与版本管理 | 已有私有 workspace `@changmen/client-core`，尚未完成独立版本发布流程 | 确认该包是否承接原 `client-shared` 目标，再制定版本及消费者升级规则 |
| 阶段 3：双仓库 | 未实施 | 保留 monorepo；不随本批收口启动拆仓 |
| 源码隔离首批 | 浏览器、Node、RDS、纯共享实现已有明确入口；已完成分组、本机回归与四个本地提交 | 推送前按正式发布流程确认，随后由 Actions 对精确提交验收；冻结目录仍有未迁项 |

前次分组与检查见[历史推进记录](audits/TEAM_BOUNDARIES_PROGRESS_20261018.md)；本次指纹补漏、提交范围与验证见[本地提交收口记录](audits/FOLDER_ISOLATION_LOCAL_COMMITS_20261018.md)。冻结混合目录、兼容入口、工具资源根及后端静态资源契约仍须保留。

[changmen 扩展] 后续已按用户选择推进[真实文件夹隔离](FOLDER_ISOLATION.md)：公共簿包移入 `client/packages/pm-market-data-browser`，前端维护工具移入 `client/devtools/venue-adapter`，共 19 个文件。旧实现目录移除，包名和旧 CLI 调用保持；整个 adapter、client-core、Chrome 扩展及 Node 构建工具仍有未迁项，不能视为四类物理隔离全部完成。

[changmen 扩展] [第二批](NODE_TOOLING_AND_FROZEN_MIGRATION_20261018.md)将两个 Node 工具及两份声明迁入独立 `devtools/runtime-tooling` workspace；旧 shared 导出归兼容 workspace，shared 声明保持无 Node 依赖。前端运行图 7 包、构建图 8 包、backend 15 包、RDS 4 包；实际 npm 仍可能链接构建包，不据此启用精简安装。剩余 888 路径已有规划清单；client-core/arb-core 和七个 adapter 入口仅完成迁移保护方案，冻结文件未搬动。

## 团队与目录

| 团队 | 拥有目录 | 职责 |
|------|----------|------|
| **客户端** | `client/web/`、`client/packages/`、`client/devtools/`、`chrome-extension/`、`packages/venue-adapter/` | UI、采集、下注、插件、浏览器包及前端工具；旧 adapter 内仍有双端入口 |
| **服务端（核心）** | `server/backend/`、`server/match/`（identity / resolver / matcher）、`server/db/`、`server/storage/` | API、合并、RDS、本机 JSON 路径、代理/余额、运维脚本 |
| **服务端（库，backend 挂载）** | `server/ws_forward/`、`server/realtime-hub/` | WebSocket 转发、Changmen Socket.IO 推送（由 backend 进程加载，非独立主链路进程） |
| **服务端（扩展守护进程）** | `server/collectors/`、`server/value-bet/` | VPS 采集 daemon；详见 [collectors/README.md](../server/collectors/README.md) |
| **开发工具** | `devtools/platform-probes/` | 可选：直连各平台探针 CLI（非主链路） |
| **产品线** | `lines/`、[docs/SPORTS_PRODUCT_LINES.md](./SPORTS_PRODUCT_LINES.md) | 对称锚点 `lines/{code}/`；电竞主栈在仓库根；棒球见 `lines/baseball/` |
| **共同协商** | `packages/shared/`、`packages/api-contract/`、`packages/client-core/`、`docs/TEAM_BOUNDARIES.md`、`.github/CODEOWNERS` | 跨端工具、catalog、HTTP 契约、web/adapter 共用 TS |

服务端包索引：[server/README.md](../server/README.md)。

已移除的遗留目录（勿再创建）：`server/platform-node`、`server/platform-probes`、`packages/venue-adapter/node/`、`packages/venue-adapter/{platform}/backend/`。探针源码仅在 `devtools/platform-probes/`；瘦包同步产物为 `server/backend/platform_node/` 与 `server/backend/platform_adapter/`。

`packages/venue-adapter` 内的 `loader/`、`registry/`、`scripts/` 属**适配器基础设施**（`reqS` / `backendRequire` 在 `loader/adapter_paths.mjs`）；各平台 `{platform}/shared/` 为**浏览器采集**内部模块（collect / markets / parse 共用），**不同步**到瘦包。

`packages/venue-adapter` 整体仍有**双端入口**（浏览器 + Node）。2026-10-17 后端已通过嵌套 workspace `@changmen/venue-node-loader` 消费原 loader 定义，其依赖 `@changmen/venue-node-registry` 的 Node 清单读取入口；原源码、manifest 及旧入口保持。resolver 始终属于服务端；OB/PB/Ray 辅助 scraper 现也消费该 Node 包根，开发依赖已移除整个 adapter，原静态/动态加载时机保持。registry 相邻浏览器 TS 保留父 adapter 兼容入口，不纳入 Node exports/files。根目录从 `client/` 迁至 `packages/` 的历史为 2026-09-20。

`check:boundaries` 另检查 backend / resolver / Node loader 的生产声明闭包及 backend/resolver 开发工具闭包，拒绝重新引入整个 adapter、浏览器簿、client-core、Vue / Pinia 或未知本地依赖。声明门禁本身不证明实际安装隔离；早期定向安装曾保留浏览器链接和 Vue，见[原 Node 入口依赖记录](audits/PM_NODE_ENTRY_DEPENDENCY_AUDIT_20261017.md)。最新候选的真实安装证据以下文及源码隔离记录为准，实际发布安装规则保持。

[changmen 扩展] 后续门禁已覆盖 resolver 的 8 包工具声明闭包及三个具体 loader 消费者；临时 14 包后端宿主安装可排除浏览器宿主，原生 Node 加载兼容通过。原根统一安装未改，不能从这项实验推导生产已独立安装。三个 scraper 的既有语法错误仍保留，未认证 CLI 可运行。当前结果见[消费者与依赖收口](SOURCE_FILE_ISOLATION_20261017.md)。

[changmen 扩展] 2026-10-18：backend 的打包/验证开发依赖已改为现有 `venue-adapter-tools`，原同步函数和复制规则不变；Node registry 的浏览器类型宿主声明由父 adapter 现有直接声明承担。完整根 workspace 配置下单选 backend 的干净开发安装为 393 包/15 个 Node workspace，没有 adapter/client-core/浏览器簿链接，Vue/Pinia 及实际子路径不可解析；七包前端类型/19 项浏览器解析及原打包布局通过。冻结物理位置、工具原资源根、瘦包资产和实际发布规则仍保留，见[本批证据与限制](SOURCE_FILE_ISOLATION_20261017.md)。

`devtools/platform-probes/{platform}/shared/` 为**探针/CLI** 内部模块（如 RAY 的 CJS `save_bets.js`），与浏览器 `shared/` 分离，由探针包 `sync:backend-bundle` 打入 `server/backend/platform_node/`。

服务端通过 `requirePlatform(..., "node")` 加载探针；**不得**引用各平台根目录下的采集/下注 ts（`packages/venue-adapter/{platform}/shared/` 亦不在瘦包内）。

## 新增平台（摘录）

完整三类清单见 **[ADD_PLATFORM_CHECKLIST.md](./ADD_PLATFORM_CHECKLIST.md)**。归属速查：

| 类型 | 主要改谁 |
|------|----------|
| browser | 客户端 `venue-adapter`；可选服务端 `platform_sync` / proxy |
| plugin | 客户端 + `chrome-extension` |
| vps-house（`vps_http_ws`） | 服务端 `server/collectors` + ecosystem；客户端仅报价/下单 adapter |

`collectionMode` 写在客户端 manifest，前后端门控同源；**禁止**在 Save* 路径再硬编码馆名。

## 唯一集成面（HTTP）

客户端 **只** 通过 HTTP 使用服务端能力（禁止在 `client/web/src` 里 `import` 服务端或 DB 包）：

| 方向 | 端点（示例） | 说明 |
|------|----------------|------|
| 上报 | `POST /esport/API_SaveMatch` | 平台原始比赛 |
| 上报 | `POST /esport/API_SaveBet` | 平台原始赔率 |
| 上报 | `POST /esport/API_SaveLiveTimer` | OB 局数/计时 |
| 拉取 | `POST /esport/Client_GetMatchs` | 合并后比赛列表（真相源） |
| 拉取 | `POST /esport/Client_GetData` | KV / 配置 |
| 辅助 | `POST /esport/http-relay` | 插件/跨域代发 |
| 鉴权 | `POST /esport/*`（带 `token` 头） | JWT 会话 |

实现参考：`client/web/src/api/`、`@changmen/api-contract`。改响应形状须升契约包版本并通知对方团队。

各 action 的**内存 vs RDS 读写策略**（M→A / M→S / R 等）见 [DATA_STORAGE.md § API 数据策略](./DATA_STORAGE.md#api-数据策略memory-first-与-rds)。改 Save* / GetMatchs / 订单 / 鉴权相关 API 时须对照该表，避免把强一致路径改成 fire-and-forget。

### `@changmen/api-contract`（阶段 1）

| 导出 | 用途 |
|------|------|
| `EsportAction`、`ESPORT_ACTIONS` | 与 `router.ts` 同步的 action 名 |
| `ClientMatchDto` 等 | 共享 DTO |
| `buildEsportUrl` / `buildHttpRelayUrl` | 前端 `VITE_API_BASE`、脚本联调 URL |
| `openapi.yaml` | OpenAPI 索引 |

分离部署（**可选**）时前端设置 `VITE_API_BASE=https://api.example.com`（见 `client/web/.env.example`）。单机同源 `http://IP/` 时未设置即可，仍用相对路径 `/esport/...`。

## 允许 / 禁止的源码依赖

### 客户端（`client/web/src`、`chrome-extension/src`）

| 允许 | 禁止 |
|------|------|
| `@changmen/venue-adapter/*` | `@changmen/db`、`@changmen/match-identity`、`@changmen/platform-probes` |
| `@changmen/shared`（展示、时间窗、账号倍数等） | `server/backend`、`server/match` 任意路径 |
| `@changmen/api-contract` | |
| `@/` 应用内模块 | |

`client/web/scripts/`：允许 `@changmen/match-identity` 做离线 parity 测试；仍禁止 `@changmen/db` 与直接引用 backend。

### 各平台 `packages/venue-adapter/{platform}/`（根目录 ts，不含 `shared/`、`scripts/`）

| 允许 | 禁止 |
|------|------|
| `@changmen/venue-adapter/contract`、`@changmen/venue-adapter/shared`、同平台 `shared/` | `@changmen/db`、`client/web`、`server/backend` |
| `@changmen/shared` | `@changmen/platform-probes`、`@changmen/match-identity` |

### 服务端（`server/backend`、`server/match`、扩展守护进程）

| 允许 | 禁止 |
|------|------|
| `@changmen/db`、`@changmen/match-identity`、`@changmen/shared`、`@changmen/storage` | `packages/venue-adapter/*/`（平台根目录 ts 与 `shared/`） |
| `@changmen/venue-adapter/loader`、`registry`、`requirePlatform` → **node** | `client/web/src/**` |
| `@changmen/platform-probes`、`@changmen/polymarket-sports`、`@changmen/realtime-hub`、`@changmen/ws-forward`（backend 依赖） | |
| `server/value-bet` 仅依赖 `@changmen/db` + `@changmen/shared` + `@changmen/storage` | |

`server/collectors/`（`@changmen/polymarket-sports` 等）、`server/value-bet` 为独立 Node 进程，**只**通过 `@changmen/db` 与 HTTP 通知 backend 集成，不得 `import` `client/*`。

### matcher 与 backend 的内部边界

`server/match/**` 禁止导入 backend 源码或 `@changmen/backend`。backend 通过
`@changmen/matcher/runtime_ports.js` 注入采集快照、提交后发布、人工结束的内存失效和面板鉴权。
适配器归属 `server/backend/core/matcher/`，在 backend 采集 store 构造完成后安装。
独立人工 UI 由 `server/backend/scripts/matcher-ui.mjs` 装配后启动；直接运行 matcher UI
却未装配鉴权时拒绝访问，开发环境仍保留原有显式跳过开关。

列表读取共用 `@changmen/db/client_match_snapshot.js`，仅缓存已确认的活跃行及其不透明版本。
合场身份与关联需要已结束行，使用一次 `fetchClientMatchesAll({ snapshot: true })` 的完整生命周期视图。
两个视图范围不同，不能按 `built_at` 大小互相替换。版本只用于判断相等，进程内失效代次负责阻止旧请求覆盖新状态。

### backend 业务与数据库访问

已收口的登录元数据、在线信息和管理用户业务通过 `@changmen/db/profile_metadata.js`、`@changmen/db/admin_users.js` 及既有公开业务方法访问数据。验证输入、权限、API 错误文本和缓存刷新属于 backend；连接池、SQL 和既有事务实现属于 `server/db`。

`npm run check:boundaries` 用 TypeScript AST 检查 backend core 的连接池导入、数据库内部路径、SQL 执行、别名、动态导入及 re-export。历史例外精确登记在 `scripts/verification/backend-db-access-exceptions.json`，每处必须可追溯到固定已发布提交 `d3fd4a0a` 的原语法节点；允许减少，不允许新位置或新增次数。五个已迁移模块不能登记例外。

正 EV 仪表盘通过 `@changmen/db/value_signals.js` 读取信号与聚合，诊断计算仍在业务层。Predict.fun 体育 relay 通过 `@changmen/db/relay_identity.js` 选择原有用户身份，通过公开 `@changmen/db/jwt.js` 使用原签发器；token 优先级、缓存和请求策略不变。

当前仅剩 1 个诊断文件、8 个历史访问位置：`admin_maintenance.js` 受订单冻结保护。运行版本观察的 SQL、指纹与缓存已迁至 `server/db/runtime_schema.js`，backend 仅组合结果；该文件不得重新登记数据库访问例外。边界规则是工程门禁，不替代运行时鉴权。

### 探针（`devtools/platform-probes`）

| 允许 | 禁止 |
|------|------|
| `@changmen/shared`、`@changmen/db` | `@changmen/venue-adapter`（含各平台 `shared/`） |
| 同平台 `shared/`、`core.js`、CLI 脚本 | `client/web`、`packages/venue-adapter/{platform}/` 根目录 ts |

## 本地校验

```bat
cd changmen
npm run check:boundaries
```

CI 在 `npm test` 前执行。违规时根据报错移除跨边界 `import`，或把共享逻辑下沉到 `packages/shared` 并经双方评审。

### PM 入口环境检查（2026-10-17，批次 A）

`scripts/deploy/component-inputs.json` 为首轮 22 个 PM/adapter 入口登记 `browser`、`node` 或 `universal`；混合包继续逐入口管理，不搬目录。浏览器聚合入口 `registry/adapters.ts` 与双端元数据入口 `registry/index.ts` 分开，`registry/paths.js`、`feeds.js` 属于 Node 路径。

`check:boundaries` 保留原规则及数据库精确例外检查，同时调用 `scripts/verification/component-entry-boundary.mjs`。新增检查沿源码 import/re-export、require/字面量动态 import、已知别名及 workspace exports 递归检查两个方向，输出违规位置和依赖链。类型导入也作为依赖边界处理；独立测试可以读取浏览器源码，生产代码导入测试时仍追踪其依赖，不按测试文件名放行。

运行 `node scripts/verification/component-entry-boundary.mjs --json` 可查看消费者、Node/浏览器源码扫描统计及 unknown 明细。语法诊断保留恢复出的依赖并显式登记不确定性；动态 loader、计算路径、未解析输入不成为无依赖证据。静态违规使检查失败；unknown 会报告而不使既有全量流程失败，本阶段始终返回 `safeToNarrowPublishScope: false`。旧发布分类及完整551保护继续有效，清单未接入任何实际发布选择器。见 [实施与验证记录](audits/PM_COMPONENT_ENTRY_BOUNDARY_AUDIT_20261017.md)。

PM 后续收口增加了 `--scope pm` 与 `pm-dependency-audit.mjs`，后者也在 `check:boundaries` 中执行。53处动态加载由 `pm-dependency-inputs.json` 逐目标、种类和次数登记；新的计算式加载、未登记目标、直接未知输入及安装/lock/子路径证据不一致会失败。宿主/传递依赖风险和20条共享运行源码不确定记录仍显式保留，不扩大到其他历史脚本整治，也不授予缩小发布范围的资格。详见 [PM专项记录](audits/PM_DYNAMIC_DEPENDENCY_AUDIT_20261017.md)。

adapter 的 PM 直接运行依赖已补齐，Vue 以与web相同范围的 optional peer 由宿主提供；直接未声明导入、私有Vue及peer/宿主范围不一致会拒绝。`pm-install-resolution.mjs` 可对指定的隔离安装比较 Node ESM/CJS 与真实 Vite client 目标和hash；两次干净安装未发现30项解析漂移。实际发布规则与20条共享loader/DB不确定记录仍保留，见[依赖声明验证](audits/PM_ADAPTER_DEPENDENCY_INSTALL_AUDIT_20261017.md)。

后续[共享loader/DB逐条核对](audits/PM_SHARED_LOADER_EVIDENCE_AUDIT_20261017.md)将这20条保留记录分类为12条固定目标、3条环境相关、5条参数未知，并接入 `check:boundaries`。新增/删除/改向记录或已核对的根目录/模块选择规则变化会失败；本机默认目标与manifest顶层预加载库存有hash证据，外部根、生产环境及通用参数入口仍未认证。此附加解释契约不替代551项固定全文保护，也不改变实际发布范围；不治理其他历史脚本。

三条环境记录又取得了[生产只读证据](audits/PM_PRODUCTION_LOADER_READONLY_AUDIT_20261017.md)：当前主栈选路位于 `abdfce46` 的受管版本内，20个预加载文件可核验，6个候选瘦包位置均不存在；43个文件与发布提交一致，运行身份匹配验收记录。该时间点证据不认证任意程序内覆盖或未来外部瘦包，也不替代候选/旧树比较、构建与组件发布控制。

剩余[5条参数记录已只读追踪](audits/PM_LOADER_PARAMETER_CALL_AUDIT_20261017.md)：中央reqS/backendRequire与adapterRequire通用分支当前未用，唯一adapterRequire请求是固定registry分支。将实际预加载依赖纳入有限分析后，发现probes另一同名backendRequire的3个字面量包请求，生产解析均与lock一致。未扫描历史scripts、未改loader/检查器/发布规则；此人工来源绑定证据不等于已实施持续独立发布门禁。

该人工证据已在下一批落实为[来源绑定持续检查](audits/PM_LOADER_BINDING_GATE_AUDIT_20261017.md)：`pm-loader-bindings.mjs` 与专用policy接入既有边界命令，按8个真实函数定义绑定9处已审调用，覆盖显式别名、ESM/CJS转导出、namespace和有限解构。未知参数/来源、逃逸、未解释的预加载依赖、环境覆盖或契约偏移均使检查失败；902文件有界闭包不以历史脚本为种子。原20条及551精确保护保留，发布范围授权标记仍为false，实际发布规则未改。

### PM 浏览器公共簿（2026-10-17，批次 B）

`@changmen/pm-market-data-browser` 已作为浏览器专属 workspace 承接簿核心、服务、FIFO、协议及通用 Worker 循环；B 批原位置为 `packages/pm-market-data-browser`，后续真实目录隔离已迁入 `client/packages/pm-market-data-browser`。web 注入 source/Worker/授权/时钟，adapter 的旧路径保留兼容，动态 HTTP 对照仍属于独立浏览器消费者。Node 生产入口不得到达新包；Node 离线测试可以测试它。

入口库存现为27项，PM动态目标54处、来源绑定闭包916文件。`isolatedBrowserRoots` 禁止纯核心向宿主/adapter/外部运行库或未知加载逃逸，只允许列明的SDK类型导入；类型开发依赖不能掩盖后续运行使用。原20条共享记录、9处来源绑定调用、完整551保护及保守发布规则均保留。结果见[B批拆包验证](audits/PM_BROWSER_MODULE_EXTRACTION_AUDIT_20261017.md)。C–E尚未实施，本地簿继续默认关闭。

## 四类源码归属（2026-10-17）

本轮已将 10 个浏览器实现迁入 `venue-adapter/browser`，4 个维护实现及运行结构观察迁入 `server/db`，8 个公共身份实现迁入 `packages/shared/match-identity`。resolver / matcher 保持服务端；原 identity 路径仅保留兼容入口。数据层直接消费 shared 身份规则，不再导入 match 业务目录。

`check:boundaries` 通过同一解析器执行 frontend / backend / RDS / shared 方向检查，并拒绝兼容入口重新增加实现。冻结目录、旧 CLI/SQL 资产及包级安装耦合仍有保留项，详见 [源码隔离与剩余清单](SOURCE_FILE_ISOLATION_20261017.md)。

后续工具收尾已迁出 adapter 的 3 个前端维护工具和 1 个跨端验证工具至 `devtools/venue-adapter/`；它们是 Node 执行的 tooling，不是运行库。RDS 结构检查、初始化命令及观察表维护实现统一位于 `server/db/maintenance`，旧 backend 命令只转导出或分派。门禁精确扫描新工具目录并检查 CLI 薄入口形状，不扩大到历史脚本。后端瘦包同步实现、历史 SQL/基线、冻结源码和安装耦合继续保留。

`retained-source-boundaries` 将上述保留项固定为 6 组、明确退出条件，并拒绝兼容入口静默退役、有效 SQL 资产遗漏、冻结路径退登和 DB 例外扩大。`component-install-inputs` 同时核对前端/后端/RDS 的声明闭包，当前为 7/14/3 个 workspace，后端含开发工具为 15 个；前端 9 包且带入 DB/storage 的结果属于早期批次，后续已解除。临时安装实验已验证后端生产 workspace 集合可排除浏览器依赖，RDS 定向安装也无浏览器依赖；生产配置未采纳精简安装，源码/资产布局仍有保留约束，详见[真实安装证据](SOURCE_FILE_ISOLATION_20261017.md)。

RDS 维护资产后续已归入 `server/db/assets/`，维护实现统一按自身包位置读取；backend 原 SQL/基线是 44 份生成的兼容副本，内容/checksum 不变。资产一致性检查接入保留边界，不允许主资产缺失时回退 backend。独立维护验收必须复制完整 RDS 运行时闭包：DB/shared/storage，加上 storage 依赖的 `devtools/runtime-tooling`，完全没有 backend 目录；测试同时核对包链接和实际源码存在，不能把 npm 创建的悬空链接视为安装成功。旧消费者、历史脚本和生产发布流程仍保留，见[资产独立记录](SOURCE_FILE_ISOLATION_20261017.md)。

## CODEOWNERS

将 `docs/CODEOWNERS.example` 复制为仓库根 `.github/CODEOWNERS`，把占位符换成真实 GitHub 用户或 team slug：

```bat
copy docs\CODEOWNERS.example .github\CODEOWNERS
```

当前只有模板，尚未启用。模板路径以本仓根目录为起点；共同维护项并列登记双方负责人，实际审查要求另由仓库规则配置，不应将模板存在视为审查已经强制生效。

## 开发习惯

1. **客户端**改采集/下注 → 只动 `venue-adapter` + `client/web`；用 Save* API 验证，不直连 RDS。
2. **服务端**改合并 → `server/match/matcher` / `resolver`；表结构主资产维护在 `server/db/assets/migrations`，backend 旧资产仅作兼容副本。公共身份规则归 `packages/shared/match-identity`，旧 identity 包保留入口；用 `Client_GetMatchs` 契约测试或 web 冒烟验证。
3. **`packages/shared`** 变更：谁改谁提 PR，另一方扫一眼受影响 API 字段/展示。
4. 生产发版按现有组件流程选择 frontend / backend / full；共享协议及当前隔离候选仍按保守范围、后端先行验收。构建、封包、切换和回滚规则见 [INDEPENDENT_DEPLOYMENT.md](INDEPENDENT_DEPLOYMENT.md)，`app:build` 或手工重启不能代替发布验收。

## 阶段路线与完成情况

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | `@changmen/api-contract`（OpenAPI + TS 类型）、`VITE_API_BASE` | 已完成（monorepo workspace） |
| 2 | 原计划 `packages/client-shared` 从 `shared` 拆出并 semver | 部分具备：已有 `client-core`，独立版本管理及升级流程未完成；不另建同职能包 |
| 3 | `changmen-client` / `changmen-server` 双仓库 | 未实施，本轮不启动 |

### 第四轮兼容演练与包边界

数据库升级流程与隔离 PostgreSQL 演练见 [DATABASE_UPGRADE_COMPATIBILITY.md](DATABASE_UPGRADE_COMPATIBILITY.md)。共享包保留统一协议和纯逻辑，环境专属能力按入口隔离；当前消费者证据与后续拆分顺序见 [SHARED_PACKAGE_BOUNDARIES.md](SHARED_PACKAGE_BOUNDARIES.md)。本轮未修改生产结构或业务协议，也未改变发布分类。

## 客户端基础包真实目录隔离（2026-10-19）

[changmen 扩展] `@changmen/client-core` 和 `@changmen/arb-core` 的唯一实现已归 `client/packages/`，原包名/导出保持。旧 `packages/` 路径仅保留 36 个源码转发及 3 个 CLI 分派，不再是 workspace。边界命令核对全部旧入口与 canonical 完整内容，原 551 基线与电竞冻结清单不改。包名、Vite alias、类型路径、锁链接和测试发现均使用新实现；实际发布范围仍保守处理，不启用精简安装。详见 [本轮迁移与验证](CLIENT_PACKAGE_ISOLATION_20261019.md)。

## Node 基础包真实目录隔离（2026-10-19）

[changmen 扩展] `@changmen/venue-node-loader` 与 `@changmen/venue-node-registry` 的 workspace 和三个运行实现已归 `server/packages/`。原路径转导出同一实现，包名和 exports 不变；瘦包内展开原实现，保持资源定位。浏览器 adapter、共享 catalog 的主资产和原资源根仍保留；Node catalog 导出副本受逐字一致性检查约束。新目录仍按原保守范围发布，未启用精简生产安装。详见 [第二轮迁移与验证](NODE_PACKAGE_ISOLATION_20261019.md)。

## 平台 catalog 单源维护（2026-10-19，第三轮）

[changmen 扩展] 平台目录的唯一维护源现为 `packages/shared/catalog/venue_manifest.json`，公共导出为 `@changmen/shared/catalog/venue_manifest.json`。`npm run sync:venue-manifest` 生成 `packages/venue-adapter/registry/manifest.json` 和 `server/packages/venue-node-registry/manifest.json`，后两者只作运行兼容资产。`npm run check:venue-manifest` 及既有 `check:boundaries` 只读检查三者逐字一致，不自动修复。

浏览器元数据、图标生成、Node registry 及资源根探测仍使用原路径，loader 的环境覆盖、缓存和初始化规则不变。默认瘦包从共享主资产取 catalog；显式外部源保留自己的 catalog。发布范围与生产安装规则不变，旧资源目录尚未退役。详见 [第三轮实施与验证](VENUE_MANIFEST_ISOLATION_20261019.md)。
