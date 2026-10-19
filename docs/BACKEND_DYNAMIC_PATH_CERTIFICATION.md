# 后端默认路径认证

本认证覆盖单仓内八个后端生产进程在**全新安装、默认 workspace 路径、不加载应用 .env、不设置根目录覆盖**时的项目依赖。它用于验证后端可以独立安装，不启用生产精简安装、瘦包或发布范围优化。

## 执行

仓库根目录运行：

```text
node scripts/testing/backend-dynamic-path-isolation.mjs
```

该命令先在系统临时目录进行全量安装与后端 19 个 workspace 的离线独立安装，禁用安装生命周期脚本。随后比较两套安装中的字面量依赖、动态目标、文件内容、SDK 包身份，并在禁止网络连接的子进程中验证真实 Node 加载结果。不会启动业务服务或连接数据库。

输出位于 `output/backend-dynamic-paths/`：`verdict.json` 是本轮结果，`full.json` 与 `selected.json` 保留完整证据。报告包含提交及工作区输入指纹；源码变化后必须重跑。原有 `output/backend-install-isolation/` 仍保留原始 11 条动态记录及其保守结论，不通过删除原始记录改变统计。

## 11 条原始记录如何认证

| 加载位置 | 数量 | 认证证据 |
| --- | ---: | --- |
| 两个数据库模块的嵌套 `require(require.resolve("pg", ...))` | 2 | 精确搜索路径、实际解析文件、内容哈希、包版本及锁文件身份；不建立连接 |
| registry 的 `pathsUrl` / `feedsUrl` | 2 | 服务端 runtime 入口及其完整项目依赖 |
| manifest 驱动的 ESM 预加载 | 1 | 共享 catalog 的三份一致副本、package 类型、20 个顶层预加载文件及完整项目依赖 |
| `loadPlatformModule(abs)` | 1 | 从实现导出反向追踪 17 处 `requirePlatform` 调用的固定参数和目标，包含 HG 的 CJS 分支 |
| `adapterRequire(...segments)` 通用分支 | 1 | 两处真实调用均为 registry 的已知快速路径，通用分支不进入本次进程集合 |
| 中央 loader 的 `reqS` / `backendRequire` 嵌套解析 | 4 | 本次进程集合无调用；导出函数、别名和命名空间均纳入来源分析，新增调用要求审核 |

展开后还检查两个探针路径桥的 8 条动态记录：ESM 桥有 3 处固定 SDK 请求，其他参数入口无调用。因此原始 11 条、展开后 19 条均保留逐条证明；共绑定 22 处真实调用。

`scripts/verification/backend-dynamic-path-inputs.json` 登记精确的 loader token 签名、动态表达式、调用来源/参数/次数和预加载文件清单。检查器不会执行被扫描模块，不按函数名称猜测调用来源。新增未知加载、参数计算、能力逃逸、路径越界、浏览器/旧 adapter 目标、缺失文件、来源变化或 SDK 身份变化均阻止认证。标准 verification 测试包含这一检查及反例测试。

## 适用边界

`CHANGMEN_*` / `GAMEBET_*` 的 adapter、Node、backend 根目录覆盖，以及 `NODE_PATH`、`NODE_OPTIONS` 均使默认认证失败。外部根目录、瘦包布局、应用 .env 和生产环境须另行提供对应证据。本次原生探针只验证模块加载，不验证业务请求或数据库操作。

第三方 SDK 内部依赖不递归认证，报告只登记实际入口、包与锁文件身份；`externalDependencyInternalsCertified` 和 `productionEnvironmentCertified` 保持 `false`。原有 PM 审计的 shared uncertainties 与整体发布范围判定保持各自含义，不能用本认证替代。
