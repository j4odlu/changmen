# 源码目录与 workspace

当前保持单仓，前端、后端和 RDS 数据层在根目录上区分归属。目录是职责边界；只有需要独立依赖、构建、测试或运行的模块才声明 npm workspace。

| 位置 | 职责 | workspace 数量 |
| --- | --- | ---: |
| `client/` 与 `chrome-extension/` | 网页、扩展、浏览器平台与客户端内部库 | 6 |
| `server/` | HTTP 后端、合场、平台设施和采集服务 | 14 |
| `rds/` | `@changmen/db`：数据访问、SQL、结构基线和维护工具 | 1 |
| `packages/` | `@changmen/shared`、`@changmen/api-contract` 与 `@changmen/match-identity` | 3 |
| `devtools/` | `@changmen/runtime-tooling`；其它工具按普通目录组织 | 1 |
| **合计** | | **25** |

## 平台设施

`server/venues/` 是一个 `@changmen/venue-node` workspace：

- `loader/`：平台模块加载和宿主能力。
- `registry/`：平台清单、路径和默认 `runtime/` 资源。
- `sync-backend-bundle.mjs`：生成已有后端瘦包布局的工具。

Node loader、registry 和打包工具不再各自占一个 workspace。调用方使用包公开入口；打包产物仍保持原 `loader/`、`registry/` 等结构。

## RDS 数据层

物理位置从 `server/db/` 改为根目录 `rds/`，包名仍为 `@changmen/db`。调用方无需知道数据层的物理位置；禁止客户端引用数据层。

SQL、迁移校验和、事务以及业务行为不随目录调整改变。维护工具仍独立于应用发布执行；应用发布只核验所需数据库结构。

## 赛事身份领域包

`packages/match-identity/` 是独立的 `@changmen/match-identity` workspace，供 matcher、resolver 和 RDS 复用队名、比赛键、时间窗及编号规则。它只依赖 `@changmen/shared`，所需数据库和队伍查找能力由调用方注入。客户端及双端 shared 不得依赖本包；旧 `packages/shared/match-identity` 实现与导出移除，活动消费者统一使用领域包入口。

## 已退役的 workspace

- `@changmen/venue-adapter`：运行实现已归前端或服务端，验证命令由根脚本调用实际工具。
- `@changmen/runtime-tooling-compat`：消费者直接使用 `@changmen/runtime-tooling`。
- `@changmen/venue-node-loader`、`@changmen/venue-node-registry`、`@changmen/venue-adapter-tools`：合并为 `@changmen/venue-node`。

旧目录中的历史清单、冻结记录和文档不代表活动 workspace。原始源码保护继续核验；只读历史视图仅服务旧迁移证明，不参与 Node 运行时解析。

## 验证

`npm run check:boundaries` 同时检查当前目录、25 个 workspace 和依赖方向；历史搬迁证明由显式历史审计执行。后端及 RDS 的安装实验、API 契约、前端类型检查和发布验收仍分别执行。

## 后端生产安装

后端发布使用 `node scripts/deploy/install-backend.mjs`，根据现有 8 个生产进程推导 6 个安装根及 17 个 Node workspace。安装启用依赖生命周期脚本，使用 `--omit=dev` 排除项目开发依赖；五个路由在 CI 封包时从 HEAD 源码预编译，VPS 只验证产物；根包与前端 workspace 不参加安装。安装完成后核验包链接目标、浏览器依赖与 Vite/Vitest/ESLint 等开发工具缺失、预编译路由哈希和 package/lock 内容稳定。

后端发布前必须通过 Linux 独立安装验收：在临时目录比较全量与定向安装，比较 CI 预编译路由与全量安装编译结果，执行动态路径认证，再在只有 loopback 的网络命名空间内，使用临时 PostgreSQL、模拟上游运行全部 8 个原入口，并验证退出及故障处理。报告绑定同一提交、源码指纹和封包证据。此测试不使用生产凭证。

后端归档保留原目录布局和全部 workspace manifest，移除浏览器实现、文档、测试及本地配置；服务端、共享规则/契约、Node loader 资源和 RDS 资产完整保留。Linux 验收从实际 `backend-runtime-v2` 归档解压安装、校验预编译路由和启动，最终发布核对该归档的 SHA；前端 `dist` 仍通过独立发布链接提供。Polymarket SDK 把 TypeScript、tsx、ts-node 声明为生产依赖（tsx 继续带入 esbuild），因此这些第三方传递依赖仍保留。按进程进一步裁剪源码另行推进。旧 release 及其依赖保留用于回退；安装检查的生产范围是新 release，隔离 CI 另行核验不存在祖先目录的依赖兜底。
