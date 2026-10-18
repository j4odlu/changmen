# PM 相关 Node 入口与依赖声明收口

[changmen 扩展] 2026-10-17，基于 `abdfce46d46f562c208ea0d832b6cafc02fd2360` 的现有未提交工作树。继 B 批浏览器拆包后，补做 Node 入口与安装证据；不代表 C、D 已完成。未 commit/push、未部署，实际发布规则不变。

## 归属与本批改动

**resolver 明确属于服务端。** `server/match/resolver` 统一队名和队伍身份，供 matcher 合场；不是浏览器 PM 适配器，也不承担下注或本地簿。

| 消费者 / 入口 | 当前处理 |
| --- | --- |
| backend 的 `core/shared/adapter_paths.js` | 改为从 `@changmen/venue-node-loader` 转导出；导出的函数仍来自原 `loader/adapter_paths.mjs` |
| `@changmen/venue-node-loader` | 在原 `packages/venue-adapter/loader` 增加 workspace 元数据；直接声明 storage、shared、registry 和动态加载所需 probes |
| `@changmen/venue-node-registry` | 在原 registry 目录登记 workspace；公开入口 / files 仅 paths.js、feeds.js、manifest.json，运行依赖只有 storage |
| resolver 主运行依赖 | 移除整个 adapter；其生产 workspace 闭包仅 resolver、db、storage、match-identity、shared |
| backend 瘦包验证 / 同步工具，resolver 三个辅助 scraper | adapter 留在 devDependencies；脚本源码、旧 loader 入口及使用方式未改 |

受 551 固定保护约束，本批没有移动、复制或修改 loader、registry 实现与 manifest。新旧 loader specifier 实际解析到同一个文件、同一个模块对象；backend facade 的函数身份也相同，不另建 loader 缓存或单例。环境覆盖、默认根选择、manifest 顶层预加载和未知调用回退沿用原实现。

registry 目录仍有 `adapters.ts`、`index.ts`、`meta.ts`、`icons.ts` 等浏览器兼容源码。它们继续由父 adapter 的浏览器入口消费，未纳入新 Node exports/files；最近 package.json 为它们声明 api-contract / client-core 的开发期类型依赖。**没有把整个 registry 目录认证为 Node 源码，也没有完成物理目录分离。** 新包是保留仓库布局的私有 workspace，不据此宣称可以任意搬到独立 npm 包目录。

## 持续检查

新增 `scripts/verification/venue-node-dependencies.mjs`，接入 `npm run check:boundaries`：

- 从 backend、resolver、Node loader 三个根检查声明的生产 workspace 闭包，包含 optional / peer，排除开发工具依赖。
- 拒绝闭包重新引入整个 adapter、浏览器本地簿、client-core、Vue 或 Pinia；拒绝未知本地包和错误 file 目标。
- 保证两个 Node workspace 的原源码位置、公开入口、files 和必要资源声明；backend 必须直接声明其 facade 使用的 Node loader。
- 原 27 个环境入口保留，给同一 loader 定义增加新 specifier；原 8 个真实定义来源、9 处调用、20 条共享不确定记录及未知失败回退保持。

该检查报告 `installationCertified:false`、`publishScopeOptimizationEnabled:false`。声明闭包不等于 npm 实际安装闭包，不能据此缩小发布范围。新 registry / loader package.json 也已加入保守输入。

## 验证与实际安装发现

| 检查 | 结果 |
| --- | --- |
| 边界门禁 | 通过；27 入口、54 动态目标、916 有界源码、9 处真实来源调用，PM 未解释输入 0 |
| 入口、PM 依赖、共享 loader、来源绑定、安装比较与新 Node 门禁 | 6 文件 202 项通过；随后补强必要依赖缺失检查，新 Node 文件单独 12 项通过（有重叠，不相加） |
| 后端任务集合 | 12 个任务成功，其中 9 个缓存命中；backend / resolver / matcher 本次执行，包含原瘦包兼容冒烟 |
| 前端类型检查 | vue-tsc 通过；本批未改浏览器实现，未重复全量前端测试或生产构建，B 批结果保留其原始输入身份 |
| 完整干净安装 | npm 11 离线、ignore-scripts，849 包；原 35 项 Node ESM/CJS 与 Vite 浏览器解析全部一致，web / adapter 共用一个 Vue |
| Node 定向生产安装 | `ci --omit=dev --workspace=@changmen/backend --workspace=@changmen/team-resolver`，384 包；Node loader、4 馆 session、shared catalog 和 resolver 可加载 |
| 浏览器运行依赖阻断冒烟 | 在隔离目录的 Node resolve hook 中拒绝 Vue / Pinia / client-core / 浏览器簿和 adapter 平台源码；facade、原 / 新 loader、余额模块、resolver 加载通过，未发送现场请求 |
| 经典 FOK 等价与固定保护 | 独立等价检查通过；`check:fok-vps` 原 551/551 精确保护及内部共享 / GTC 检查通过，`fullReleaseAccepted:false` |

**安装隔离尚未达标。** 上述真实定向生产安装仍可解析整个 adapter、浏览器簿、client-core，且安装了 Vue；Pinia 未安装。统一根 workspace / lock、开发工具依赖和 peer 解析共同影响实际树，不能将 `--workspace` 或 `--omit=dev` 当作前后端安装隔离证明。本批保留该发现，没有通过手工删包、裁剪 fixture 或修改生产安装命令将其改写成通过。

后续安装输入批已在新目录重现该结果，并增加受控对照：临时根仅登记后端 14 个生产 workspace、仍使用原 lock 时，349 包安装可排除整个 adapter/client-core/浏览器簿/Vue/Pinia；原 loader、resolver 与数据层加载通过，23 处外部依赖解析未漂移。RDS 原配置单独定向安装为 18 包、3 个 workspace，也不带浏览器依赖。前端仍通过 adapter 声明安装 DB/storage。实验保留完整源码布局，未启用到生产，也未认证独立产物；当前全局 `installationCertified:false` 仍有效。详见[后续实际安装记录](../SOURCE_FILE_ISOLATION_20261017.md)。

安装目录独立位于系统临时目录；源文件复制排除了 .env、.npmrc、凭证文件和 backend storage。完整 / 定向安装都关闭生命周期脚本，是解析与加载证据，不是生产部署演练。证据在忽略目录 `output/pm-node-dependencies-20261017/`，另保留根 `output/pm-node-gate-tests-initial.log` 与边界日志。

## 当前结论与下一步

**运行入口和生产依赖声明已收口；独立安装、独立发布仍不具备放行条件。** PM SDK 同时被浏览器与服务端交易集成使用属于真实双端消费，仍各自声明，不能为了包名看起来纯净而删除后端所需 SDK。

后续 C 的计划对照需纳入实际安装树和各组件线上旧树，明确生产 / 开发工具的安装输入；D 再处理安装选择、workflow、封存、运行身份和远端激活。当前 root install、瘦包复制与发布规则均保持现状，本批不选择、更不激活新的后端瘦包方案。

原行情、经典 FOK 的生产实现未改；原 551 固定基线未改。本地订单簿与对照继续默认关闭，实际预检仍走 HTTP；本批没有补足订单簿恢复、快照覆盖率或后台性能证据，生产旁路启用结论继续为 NO-GO。
