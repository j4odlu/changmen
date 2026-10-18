# PM 共享 loader 三条环境记录：生产只读核对

[changmen 扩展] 2026-10-17，承接[20条共享loader/DB记录核对](PM_SHARED_LOADER_EVIDENCE_AUDIT_20261017.md)。本批通过既有 SSH 连接只读查看生产进程、有限文件与当前发布证据；本地仅补文档和忽略目录中的证据文件。没有执行生产 loader、瘦包同步、安装、构建、PM2命令、重启、配置或业务数据写入，没有 commit/push 或部署。没有展开历史 scripts。

后续[参数调用只读追踪](PM_LOADER_PARAMETER_CALL_AUDIT_20261017.md)进一步核对了预加载文件的实际依赖，区分中央loader与probes两个helper的同名函数：原5条是未实例化分支，另有3个固定Node包请求，生产解析与lock一致。本记录保留三条环境记录的时间点范围，不把顶层库存冒充完整运行闭包。

## 结论与证据适用范围

**三条环境相关记录已取得当前生产版本的选路输入、manifest文件清单和瘦包候选证据。当前生产使用受管版本内的完整 monorepo，未使用所核对候选位置的外部瘦包。** 此前“只知道本机默认路径、不知道生产选路”的缺口得到补充；不能把这份时间点证据当作未来任意配置/瘦包的永久认证。

当前尚不具备启用新 PM 包独立发布规则的完整条件。开放参数路径、候选与线上各组件旧树的输入比较、安装/构建闭包及发布控制仍需处理，见末表。原20条分类12/3/5及 `closed:false` 保留，不改机器检查器的范围授权标记或实际发布规则。

主要采集时间 **2026-10-17 17:16:09（Asia/Taipei）**；补读当前验收记录时间17:17:50，结束前状态复核时间17:20:38。目标为现有生产 `47.57.10.202`，应用根 `/root/changmen`。前后端成功记录均为 Actions代次 `39015482088`、提交 `abdfce46d46f562c208ea0d832b6cafc02fd2360`。

以下用 `R` 表示实际后端版本根：

```text
/root/changmen/.releases/backend/backend-abdfce46d46f562c208ea0d832b6cafc02fd2360-39015482088-1
```

`/root/changmen/backend-current` 指向 `R`；前端实际入口指向 `.releases/frontend/frontend-abdfce46d46f562c208ea0d832b6cafc02fd2360-39015482088-1`。本地尚未提交的依赖声明和检查工具不属于这次已发布版本，不能混同验收身份。

## 生产身份与根目录

从 `/proc/<pid>/cwd`、初始环境白名单、入口路径和启动ticks核对8个主栈进程，均在 `R` 内。`changmen-esport` PID为2009911，cwd为 `R/server/backend`，入口为 `R/server/backend/scripts/start-db.mjs`；其余进程为 PM足球collector、PM体育状态、PM电竞collector、PF collector、PM电竞hub、PM体育hub和PF hub。主采集前后全部PID、启动ticks、cwd及入口一致，两个成功记录及 `.env` 元数据也一致。

| 项目 | 当前生产证据 |
| --- | --- |
| loader 模块来源 | backend共享包装入口 → `@changmen/venue-adapter/loader/adapter_paths.js` exports → `R/packages/venue-adapter/loader/adapter_paths.mjs` |
| workspace包实际链接 | 最近 venue-adapter 链接落在 `R/packages/venue-adapter`；loader/registry 最近 storage 链接落在 `R/server/storage`，均未指向旧根目录或外部包 |
| loader 选中的 adapter 根 | `R/packages/venue-adapter` |
| registry 实现 adapter 根 | `R/packages/venue-adapter`；当前两选择器结果相同，仍保留它们规则不同的事实 |
| platform Node 根 | `R/devtools/platform-probes`，存在预期 OB/session 文件 |
| backend 根 | `R/server/backend` |
| 根目录覆盖 | 8个进程初始环境中未设置 CHANGMEN/GAMEBET 的 adapter、backend、platform-probes、Node 根覆盖键；未设置 `NODE_PATH`、`NODE_OPTIONS` 或 preserve-symlinks 环境项，也未发现 Node命令行标志 |
| 应用 `.env` | `R/server/backend/.env` 链接到 `/root/changmen/server/backend/.env`；白名单覆盖键在该文件全文中均未出现。matcher附加 `.env` 和版本根 `.env` 均不存在 |

只读核对了实际启动入口和 `loadChangmenEnv` 的顺序。Linux `/proc/environ` 主要反映初始环境，不能单独代表 dotenv 后的 JavaScript 环境；因此同时核对了实际 `.env` 链接、覆盖键是否出现及启动源码。未导出原始环境、任何凭据值、数据库URL或完整 `.env` 内容，也未保存 `.env` 内容hash。

这些是**生产输入与已核对选择逻辑推导出的根目录**，没有注入调试器、读取 JavaScript heap、ESM缓存或调用生产 getter。程序内临时覆盖与任意间接调用不能仅靠这些输入排除；若以后引入这类调用须补证，不能把当前推导升级为任意动态执行的证明。

## 三条记录的对应证据

| 原记录 | 本批补充 | 仍保留的边界 |
| --- | --- | --- |
| shared-01：loader-contract | 进程真实版本根、workspace链接、启动环境与dotenv无覆盖键；loader、registry、storage选路源码与发布提交一致 | 它是根目录契约汇总，不是独立加载操作；外部覆盖或其他部署形态变化后证据失效 |
| shared-19：manifest驱动ESM预加载 | 实际选中的17项manifest、各平台package.type与顶层文件库存；5个ESM目录、20个JS逐文件hash一致 | 这是当前规则确定的启动预加载输入，不是直接读取缓存所得的“当前缓存20项”；未追踪这些模块内部全部依赖或执行其代码 |
| shared-20：loadPlatformModule(abs) | 5个已识别字面量请求均落在当前probes根并存在；PB/session、OB/session、RAY/session、RAY/core属于ESM预加载库存，HG/session继承probes父包commonjs | 不证明每个懒调用已经发生，也不证明未来任意abs参数；共享loader的ESM缓存与CJS回退实现没有改动 |

## manifest 与预加载实际清单

实际 manifest 为 `R/packages/venue-adapter/registry/manifest.json`，共17个平台条目。SHA-256：

```text
4d6b1c5689a3cb3ac1b963cd534386029cdddd726e0eff050c6247fde70bd43a
```

沿现有规则：manifest所列dir → 该目录存在package.json且type=module → 仅顶层 `.js`、排除下划线开头 → 必须是文件。当前结果如下；每个文件均已取得realpath及SHA-256：

| `R/devtools/platform-probes/` 下目录 | 顶层预加载文件 | 数量 |
| --- | --- | ---: |
| ob | core.js、session.js | 2 |
| ray | collect_credentials.js、core.js、ray_game_ids.js、session.js、ws.js | 5 |
| tf | auth.js、collect_credentials.js、core.js、game_ids.js、session.js、ws.js | 6 |
| ia | collect_credentials.js、core.js、game_ids.js、session.js、ws.js | 5 |
| pb | core.js、session.js | 2 |
| 合计 | 只枚举以上顶层文件，不递归scripts | 20 |

其余manifest项不满足当前局部module预加载条件。Polymarket条目存在于manifest中，但没有因此得到一个PM浏览器簿的Node预加载项。预加载某平台文件也不代表PM业务会调用该平台全部模块。

库存指纹使用 `JSON.stringify` 等价的紧凑UTF-8 JSON，对排序后的 `[版本内相对路径, 文件SHA-256]` 列表再做SHA-256：

```text
0078fda690900b00ac6b0f5699e1397b3bcb1b5a2fed8d66095cd8ba01d11627
```

## 外部瘦包：当前未启用，候选不存在

只检查现有选择规则涉及的候选位置，不搜索整台机器的备份或历史目录：

| 基目录 | platform_adapter / platform_node 候选 | 结果 |
| --- | --- | --- |
| 当前版本 `R` | server/backend/platform_adapter、server/backend/platform_node、platform_adapter | 3个均不存在 |
| 持久应用根 `/root/changmen` | server/backend/platform_adapter、server/backend/platform_node、platform_adapter | 3个均不存在 |

没有根目录覆盖配置，实际包链接也在当前版本内，因此当前主栈没有选中这些外部瘦包。**不存在的瘦包没有可核对内容；本结论是当前未使用，而不是其他机器或未来瘦包内容已通过认证。** 未运行sync、打包器或瘦包冒烟，不追踪无关备份、历史脚本或未选中的其他目录。

## 内容与运行身份的一致性

43个去重文件覆盖17个选路/当前入口/manifest来源文件、20个预加载JS、5个module包元数据和未被预加载库存覆盖的HG/session；均与已发布 `abdfce46` 的精确Git blob SHA-256一致。probes父包package.json另核对一致，type=commonjs。所核对43个文件及实际 `.env` 的mtime/ctime均早于主进程启动时间，未发现启动后的这些文件变更。

唯一HTTP请求为本机 `GET /api/runtime-version`，返回200、`restartRequired:false`，后端启动时间 `2026-10-17T08:02:46.288Z`（台北16:02:46）。运行commit、完整来源指纹与契约指纹均与当前 `.deploy-state/backend-evidence.*.json` 和 `backend-verification.*.json` 一致；当前验收记录为 `passed:true`、`sourceStable:true`、`immutableFokEntries:551`。

来源指纹 `e441c5dcea4d2a6c94c178df64bd2d7be0e5d11bb4376bdd504d3c9ee21d013b`；契约指纹 `fdb45e1709e0ae9dd7de89e654e2b234a95edd26592ca84e519d269993df31a9`。运行接口的 `dirty:null` 是版本目录模式的既有结果，不能写成Git工作区clean；一致性由上述指纹和有限文件精确比较共同支持。这不是对进程heap或整台机器所有文件的审计。

本机完整证据在忽略目录 `output/pm-production-loader-audit-20261017/`：`collect.py`（通过SSH stdin执行、未安装到服务器）、`production.json`、`compare.py`、`comparison.json`、`release-acceptance.json`、`final-state.json`、`verdict.json`。最后一份记录各证据文件hash和身份断言；不包含原始凭据环境或 `.env` 内容。结束前复核确认两端入口、8个进程PID/启动ticks/cwd/入口、成功记录和manifest hash与主要采集时一致。

## 还缺哪些独立发布条件

| 条件 | 本批进展 / 剩余工作 |
| --- | --- |
| 当前生产实际部署输入 | 已有当前版本、进程、根目录、manifest与候选瘦包证据；未来根覆盖、manifest或外部内容变化须重新核对 |
| 5条参数未知记录 | 仍对应reqS、backendRequire和adapterRequire通用分支；当前识别PM调用未实例化，新增/间接调用须绑定具体参数和消费者，不能因本次生产无覆盖而放行 |
| 各组件线上旧树与候选的双向比较 | 已取得当前线上提交和身份；尚未实施候选/旧树输入闭包取并集，以及删除、重命名、旧入口和未来不同前后端版本的判定 |
| 安装、共享SDK与构建输入 | 前批两次干净安装30项一致只覆盖那一批声明变化；本批没有认证任意SDK/lock升级、完整第三方运行闭包、瘦包安装或未来浏览器构建副作用 |
| 发布范围与完整来源绑定 | 原规则仍按原范围处理packages；尚未实施组件输入证据与统一计划、workflow、远端激活的一致消费；完整来源指纹、archive身份和551保护不能删除或替换 |
| 独立发布及回滚演练 | 尚未完成新规则下前端独立更新、后端无制品/无重启且保留自身身份，以及下一次发布/回滚仍正确比较的演练；本批不执行发布演练 |

因此可继续评审下一批候选/旧树及组件控制方案，**不能据本报告直接开启新的PM包frontend-only规则或生产旁路灰度**。三条环境记录的当前生产证据不再只是本机默认假设，也不会永久替代变更时的兼容检查。

## 保护与本批验证

本批不修改应用、loader/registry/DB实现、检查器、依赖声明、实际发布配置或固定保护；前几批未提交内容原样保留。原行情、经典FOK、实际HTTP预检不变，本地订单簿和旁路默认关闭。

- 生产只读：8进程前后身份稳定、状态文件稳定、环境文件元数据稳定；43/43文件匹配发布提交，另核对probes父包；运行身份与现有发布验收证据一致。
- 本机：`npm run check:fok-vps` 本批通过，原551项逐项完整核对；包含FOK等价、共享边界和GTC隔离子检查。没有替换manifest、固定hash或增加源码豁免，结果仍为 `fullReleaseAccepted:false`，不冒充发布批准。
- 不重复安装、应用构建、浏览器长测或全量前后端业务测试；本批只有只读取证与文档修改。

未 commit、push、发布或重启。
