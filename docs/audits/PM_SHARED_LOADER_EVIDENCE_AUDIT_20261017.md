# PM 可达共享 loader / DB 的20条记录收口

[changmen 扩展] 2026-10-17，`E:\River\arb\changmen`，提交基线 `abdfce46d46f562c208ea0d832b6cafc02fd2360`。承接[依赖声明与干净安装验证](PM_ADAPTER_DEPENDENCY_INSTALL_AUDIT_20261017.md)。本批只新增验证清单、检查器、负向测试和文档；不修改生产 loader、registry、DB、原行情、经典 FOK、依赖声明或实际发布规则。前几批未提交改动继续保留。本批未 commit/push、未部署。

后续[生产只读核对](PM_PRODUCTION_LOADER_READONLY_AUDIT_20261017.md)已为 shared-01/19/20 补充当前实际版本根、启动/配置输入、20个预加载文件及6个瘦包候选不存在的证据；43个文件与线上提交精确一致，运行身份与当前验收记录一致。下文保留本批本机证据的历史范围，原始20条和未认证标记不删除，独立发布条件仍按后续报告逐项判断。

再后的[5条参数记录只读追踪](PM_LOADER_PARAMETER_CALL_AUDIT_20261017.md)已按定义来源核对具名转导出、引用及预加载实际依赖：原5条都是当前未实例化的开放参数记录，唯一中央adapterRequire调用命中registry固定分支；probes另一同名backendRequire有3个固定包请求。没有发现本次范围内参数不明的实际调用，原计数与检查器不改；持续来源绑定门禁、旧树/构建及发布控制仍未完成。

## 结论

**20条记录已逐项解释为12条固定目标、3条环境/预加载相关、5条参数仍未知；全部原始记录保留，不能据此启用新的独立发布规则。** 固定目标表示模块名或相对目标已确定，不表示生产绝对路径已认证。12条中有8条仍继承 adapter/probes 根目录选择，另4条是固定 `pg` 名称的模块查找。

这20条不是20个独立执行入口：两处 PG 查找各记录内外两层调用；`reqS`、`backendRequire` 也各记两层；还有1条 loader 汇总契约。5条真正参数未知记录对应3个开放 API 分支。当前解析器识别到的 PM 调用集中没有 `reqS` / `backendRequire` 调用，唯一 `adapterRequire` 调用命中 registry 固定分支，但这不构成对任意间接 JavaScript 调用的全程序证明。

**纯浏览器簿修改不应因这些记录一概被认定需要发布后端。** 仍阻碍新独立发布能力的条件是：改动涉及固定 Node 目标/安装解析、根目录或 manifest 选择、引入通用参数调用，以及尚未实施的逐组件线上旧树比较、构建与发布控制。当前实际分类保持原样。

## 逐条清单

完整路径与源表达式登记在 `scripts/verification/pm-shared-loader-inputs.json`；下表 ID 与机器报告一一对应。

| ID | 所在位置 / 输入 | 分类 | 解释及剩余边界 |
| --- | --- | --- | --- |
| shared-01 | `loader/adapter_paths.mjs` 的 loader-contract | 环境相关 | 汇总根目录覆盖契约，不是一次额外加载 |
| shared-02 | `balance_provider.js` → PB/node/session.js | 固定目标 | 默认 probes/pb/session.js；probes 根可覆盖 |
| shared-03 | 同上 → HG/node/session.js | 固定目标 | 默认 probes/hg/session.js；probes 根可覆盖 |
| shared-04 | 同上 → OB/node/session.js | 固定目标 | 默认 probes/ob/session.js；probes 根可覆盖 |
| shared-05 | 同上 → RAY/node/session.js | 固定目标 | 默认 probes/ray/session.js；probes 根可覆盖 |
| shared-06 | 同上 → RAY/node/core.js | 固定目标 | 默认 probes/ray/core.js；probes 根可覆盖 |
| shared-07 | `esport-api/store.js` → adapterRequire(registry, feeds.js) | 固定目标 | 命中已初始化 registry 缓存；不是通用路径分支 |
| shared-08 | `server/db/pg_pool.js` → 外层 require(resolve(...)) | 固定目标 | 与09共同表示一次固定 pg 模块加载 |
| shared-09 | 同上 → require.resolve("pg", paths) | 固定目标 | 名称与搜索起点固定；安装布局、Node祖先搜索仍影响结果 |
| shared-10 | `server/db/resolve_database_url.js` → 外层 require(resolve(...)) | 固定目标 | 与11共同表示另一次固定 pg 模块加载 |
| shared-11 | 同上 → require.resolve("pg", paths) | 固定目标 | 同09；不涉及本次修改数据库 URL 或连接行为 |
| shared-12 | loader → reqS 外层 require(resolve(entry)) | 参数未知 | 与13为同一开放 API 的两层记录 |
| shared-13 | loader → reqS 的 resolve(entry) | 参数未知 | 调用者提供 shared 模块后缀；当前识别调用数0 |
| shared-14 | loader → backendRequire 外层 require(resolve(specifier)) | 参数未知 | 与15为同一开放 API 的两层记录 |
| shared-15 | loader → backendRequire 的 resolve(specifier) | 参数未知 | 调用者提供模块名；当前识别调用数0 |
| shared-16 | loader → import(pathsUrl) | 固定目标 | 固定 registry/paths.js，继承 adapter 根选择 |
| shared-17 | loader → import(feedsUrl) | 固定目标 | 固定 registry/feeds.js，继承 adapter 根选择 |
| shared-18 | loader → adapterRequire 的通用 path.join(...segments) | 参数未知 | registry 固定分支外的开放路径；当前识别调用数0 |
| shared-19 | loader → initEsmPlatformBackends 的 import(fileURL(abs)) | 环境相关 | manifest、probes 根、局部 package.type 和顶层文件集合共同决定 |
| shared-20 | loader → loadPlatformModule 的 require(abs) | 环境相关 | 私有加载转发器；当前5个 requirePlatform 字面量请求可解释，实际根与缓存仍有条件 |

`probes/` 在表中指 `devtools/platform-probes/`；`loader/` 指 `packages/venue-adapter/loader/`。没有删除、豁免或把20条原始 unknown 改成0；每条仍为 `closed:false`。

## 根目录与安装证据

| 选择器 | 覆盖输入 | 默认场景证据 / 未认证部分 |
| --- | --- | --- |
| loader adapter root | `CHANGMEN_ADAPTER_ROOT` / `GAMEBET_ADAPTER_ROOT`；backend 根影响兼容回退 | 检查外部根的 registry manifest 后，可选外部根；否则 workspace / 包自身 / backend兼容路径。只验证当前仓库默认 registry 文件 |
| registry 实现 adapter root | workspace `VENUE_ADAPTER_ROOT` 是否存在，否则 registry 自身目录 | 与 loader 的 `getAdapterRoot()` 是不同选择器：即使选中外部 registry，仍可能优先使用 workspace adapter 实现。不能把单个覆盖变量解释为所有实现都随之切换 |
| platform Node root | `CHANGMEN_PLATFORM_PROBES_ROOT`、`GAMEBET_PLATFORM_PROBES_ROOT`、`CHANGMEN_NODE_ROOT`、`GAMEBET_NODE_ROOT` | 还受 `setPlatformNodeRootForTests` 程序覆盖影响；默认优先 devtools/platform-probes，再回退 backend/platform_node；不执行 setter |
| shared / backend 模块查找 | `CHANGMEN_BACKEND_ROOT` / `GAMEBET_BACKEND_ROOT`、安装布局、`NODE_PATH` / `NODE_OPTIONS` | 后端根 node_modules、仓库 node_modules 及 Node 自身查找；通用模块参数仍未知 |
| PG 模块查找 | 固定 pg 名称、安装布局、`NODE_PATH` / `NODE_OPTIONS` | 两文件相同搜索起点：apps/backend/node_modules、根 node_modules、server/node_modules；Node还进行祖先搜索。本机解析到 node_modules/pg/lib/index.js，版本8.21.0，与精确 lock 记录一致 |

机器报告只输出审计进程中已设置的**变量名**，不输出变量值，不加载应用 `.env`，不读取远端环境，不跟随用户配置的外部目录。本机审计时这些覆盖键均未设置，这只能支持一个默认场景，不能认证生产环境。程序覆盖、不同部署形态或外部瘦包仍需真实输入证据。

默认场景取得7个去重直接文件的相对路径、realpath 与 SHA-256：五个 probes/session/core 文件、registry/paths.js、registry/feeds.js；另记录 manifest、PG解析结果与版本。文件与 realpath 必须留在仓库及声明根目录内。

按现有预加载规则枚举 manifest 对应平台、局部 `package.json` 为 module 的目录，当前顶层预加载 JS 共20个，分布在 ob、ray、tf、ia、pb。规则是顶层 `.js` 且不以下划线开头，不能自行假设会排除所有测试命名。仅读取元数据与文件 hash，不 import 这些模块、不追踪它们内部的完整依赖、不递归历史 scripts。此库存是启动预加载输入证据，不是“PM会业务调用这20个模块”的证明。

## 新增检查的作用

`pm-shared-loader-evidence.mjs` 接入现有 `pm-dependency-audit.mjs` 和 `check:boundaries`：

- 按源文件、加载种类、表达式、识别的 loader 身份和参数核对20条记录；新增、缺失、重复、改向都失败，行号变化不会造成伪变化。
- 对7处根目录/registry/PG选择源码登记 token 契约；规则变化后原分类失效，不继续输出默认目标证据。PG只绑定加载相关部分，不把无关查询函数视作加载规则。
- `sourceContracts` 只是额外约束解释与源码的一致性；注释/空白可忽略，**不替代或改变原551项精确全文保护**，不能更新此清单来放行 FOK 回归。
- 保留全部原始 unknown、`runtimeRootsCertified:false`、`moduleDependencyClosuresCertified:false`、`safeToNarrowPublishScope:false` 与 `publishScopeOptimizationEnabled:false`。

复现命令：

```sh
node scripts/verification/pm-dependency-audit.mjs --json
npm run check:boundaries
```

完整本机报告在已忽略的 `output/pm-shared-loader-audit-20261017/report.json`。检查器从源码和登记清单重建报告，不依赖该 output 文件。

## 对独立发布的具体影响

| 候选变化 | 需要补的证据 | 本批结论 |
| --- | --- | --- |
| 仅浏览器本地簿/Worker实现，loader、manifest、协议、依赖与已识别调用不变 | 候选及线上旧树的消费者、浏览器构建与组件控制 | 20条共享记录本身不构成永久双端依赖；当前不新增 frontend-only 权限 |
| 固定 probes/registry 目标、PG安装版本/布局/搜索规则变化 | 实际 Node解析、消费者兼容和相关验证 | 阻碍仅凭浏览器证据缩小范围；不代表每次读取共享文件都要重新部署两端 |
| 根目录覆盖、manifest预加载、外部瘦包内容变化 | 真实选择结果、manifest/package.type、文件库存与内容来源、必要运行证据 | 本机默认清单不足以认证，仍阻碍独立发布判定 |
| 新增 reqS/backendRequire/adapterRequire通用分支或间接调用 | 绑定调用参数与目标，补消费者和根目录证据；新记录须评审 | 当前5条保留未知；不得用“当前识别调用0”直接放行新调用 |
| root lock、共享SDK及其安装关系变化 | 两端真实解析闭包与安装效果 | 前批有限干净安装对比仍有效，但不能覆盖未来任意升级 |
| 逐组件发布、来源身份和线上旧树比较 | 解耦方案C/D批次的控制与演练 | 仍是启用新独立发布规则的直接缺口；本批不改选择器、workflow、远端激活或完整来源指纹 |

## 验证与保持项

| 检查 | 本批结果 |
| --- | --- |
| 入口/动态依赖/共享loader/安装解析及原设置、行情流、执行观察边界负向测试 | 7文件共123项最终通过；新增共享loader23项、动态依赖24项 |
| `npm run check:boundaries` | 通过；PM直接未知0、原始共享unknown20，分类12/3/5；无违规 |
| `node scripts/verification/verify-fok-execution-parity.mjs` | 通过；180组对比、20个确认故障场景、45个原门控场景 |
| `npm run check:fok-vps` | 原551项全部通过，原manifest/固定hash未改；等价、共享边界、GTC隔离子检查通过 |

首轮7文件122项中121项通过，1项发现新增解释检查器的独立分词不能正确处理模板插值，导致末尾注释被当作变化。已改为解析后的token树，并增加模板/正则之后代码变化的回归；受影响2文件47项重跑全部通过，其余5文件76项保留首轮通过结果。未修改生产文件、业务时间门槛或原保护基线。修正后的 `check:boundaries` 已再次通过，机器报告已重新生成。

本批未修改生产行为，所以不重复干净安装、应用构建或真实行情长测。原行情、经典FOK、实际HTTP预检及价格/金额/深度/双腿/成交确认规则保持；本地订单簿与旁路继续默认关闭。检查通过只完成本批证据治理，不构成生产旁路灰度或新发布规则的批准。未 commit、push 或部署。
