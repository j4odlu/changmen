# @changmen/venue-adapter

各平台**浏览器**适配器：`{platform}/`、registry、loader。

可选探针 CLI 在 [`@changmen/platform-probes`](../../devtools/platform-probes/README.md)（日常可不使用）。

[changmen 扩展] Node 消费者使用嵌套 workspace `@changmen/venue-node-loader` / `@changmen/venue-node-registry`，backend 打包/验证使用 `@changmen/venue-adapter-tools/sync-backend-bundle.mjs`；手动同步命令也可由 tools workspace 执行。相邻 registry 浏览器 TS 的 api-contract/client-core 宿主由父 adapter 原 dependencies 提供，Node registry 不再声明这组开发宿主。冻结源文件和原兼容导出不搬动，打包工具仍需原目录资源根；详见[隔离记录](../../docs/SOURCE_FILE_ISOLATION_20261017.md)。

历史路径 `server/platform-node`、`platform-adapter/`、`platform-adapter/{platform}/backend/` 已删除；Node 探针与会话模块仅在 `devtools/platform-probes/`（经 `requirePlatform(id, "node", …)` 加载）。

## 目录

```
packages/venue-adapter/
├── registry/ manifest.json、adapters.ts
├── loader/   adapter_paths（requirePlatform、reqS）
├── shared/   跨平台采集工具（collectSession、socket/…）
└── {platform}/          collect.ts、bet.ts 等（+ 可选 shared/、scripts/）
```

前端通过 workspace 包名 **`@changmen/venue-adapter`** 引用（见 `client/web/vite.config.ts` alias，根路径来自 `CHANGMEN_LAYOUT`）。

浏览器子路径经 `@changmen/venue-adapter` 的 `package.json` `exports`（`"./*": "./*"`）解析；`client/web` 为 workspace 消费者，**不再**把本目录列入 `tsconfig.app.json` `include`。

核对 web 使用的子路径：

```bat
npm run list:web-imports --workspace=@changmen/venue-adapter
npm run check:web-imports --workspace=@changmen/venue-adapter
```

`package.json` `exports` 由扫描生成（勿手改）：

```bat
npm run sync:exports --workspace=@changmen/venue-adapter
npm run check:exports --workspace=@changmen/venue-adapter
```

**web 深路径（仅 vitest mock）**：`polymarket/orderSettlement`、`polymarket/settlementJob`、`polymarket/orders`、`polymarket/marketDelay`、`shared/rejectWait`。

**web 运行时单点深路径**：`registry/adapters`（`runtime/venueAdapters.ts`，避免 `registry` barrel 拉起全平台图）。

`PLATFORMS` 常量从 `@changmen/venue-adapter/shared` 导入；`ALL_PLATFORMS` / manifest 元数据从 `@changmen/venue-adapter/registry`。

## 新增平台

先定类型再改代码：**[docs/ADD_PLATFORM_CHECKLIST.md](../../docs/ADD_PLATFORM_CHECKLIST.md)**（browser / plugin / `vps_http_ws`）。

- 浏览器馆：本目录 `{platform}/collect.ts` + `bet.ts`，`collectionMode` ≠ `vps_http_ws`
- VPS 馆：discovery 在 `server/collectors/`；本目录只留报价/下单，**勿**镜像 discovery parse
- `collectionMode: vps_http_ws` 后 Save* 门控自动生效（勿再硬编码馆名）

## 测试

[changmen 扩展] 三个前端维护工具的实现位于 `devtools/venue-adapter/frontend/`，冻结检查位于 `devtools/venue-adapter/verification/`；旧 scripts/npm 命令保留薄入口。它们使用 Node 执行，不是浏览器运行依赖。后端 `scripts/sync-backend-bundle.mjs` 因瘦包复制与源根约定保留原实现，复制规则没有改变。工具迁移及保留原因见 [源码隔离收尾](../../docs/SOURCE_FILE_ISOLATION_20261017.md#后续第-1-批工具与-rds-命令收尾2026-10-17)。

[changmen 扩展] PM 旁路诊断的 9 个实现与只读 source 已归入 [`browser/`](browser/README.md)，旧路径仅转导出；没有搬动原行情或经典 FOK。Node 的冻结 loader/registry 仍在原处，整个包尚未完成物理/安装隔离，见 [四类源码隔离记录](../../docs/SOURCE_FILE_ISOLATION_20261017.md)。

[changmen 扩展] PM公共订单簿核心已迁至 [`@changmen/pm-market-data-browser`](../../client/packages/pm-market-data-browser/README.md)。本包保留旧核心转导出、薄service构造适配器、只读 `polymarket/orderBookSource` 及动态HTTP/模拟消费者；浏览器宿主注入Worker和授权，Node生产入口不得消费该浏览器包。loader、原行情、经典FOK与实际发布规则保持原状，见[B批验证](../../docs/audits/PM_BROWSER_MODULE_EXTRACTION_AUDIT_20261017.md)。

### PM 直接依赖与 Vue 宿主

[changmen 扩展] 后续浏览器安装收口已移除本包的 DB/storage 声明。冻结 loader/registry 分别由原位 Node workspace 声明 storage；原 `scripts/sync-backend-bundle.mjs` 内容、路径及 npm 命令不变，新增相邻 `scripts/package.json`（`@changmen/venue-adapter-tools`）声明其 Node storage 依赖。旧 loader 导出继续兼容完整 monorepo 的 Node 宿主；仅安装浏览器消费者不提供这些 Node 工具依赖，也不认证任意平铺 npm 布局。Web 干净安装仅有 7 个 workspace，不安装 DB/storage/Node 工具；实际后端安装和发布流程仍未改，见[安装收口结果](../../docs/SOURCE_FILE_ISOLATION_20261017.md)。

[changmen 扩展] backend 的运行入口现为 [`@changmen/venue-node-loader`](loader/README.md)，指向原 loader 文件；其 Node registry 仅公开 paths / feeds / manifest。旧 adapter loader 入口不变，backend / resolver 的整个 adapter 声明仅供同步、验证和辅助 scraper 开发工具。registry 相邻浏览器 TS 仍保留兼容，源码没有搬动。声明闭包检查已接入边界门禁，但统一根 workspace 的实际定向生产安装仍带浏览器链接和 Vue，尚不能据此独立安装或发布，见 [验证限制](../../docs/audits/PM_NODE_ENTRY_DEPENDENCY_AUDIT_20261017.md)。

[changmen 扩展] PM 源码直接使用的 `@noble/hashes` 1.3.2、`@polymarket/builder-signing-sdk` 0.0.8、`@polymarket/builder-relayer-client` 0.0.10 由 adapter 自身声明为运行依赖，固定为本次整理前的实际解析版本。既有 client、clob-client-v2、viem 等声明保持原值；不借整理声明升级签名或钱包实现。

Vue 由浏览器应用宿主提供。adapter 使用与 `client/web` 一致的 `peerDependencies.vue = "^3.5.13"`，不安装私有 Vue runtime；当前锁定版本为3.5.38。peer 标记 optional 是因为本包同时提供只供 Node 使用的 registry/loader 基础设施，这些消费者不需要因 peer 声明安装 Vue。**浏览器消费者使用 PM store 等能力时必须由宿主显式提供兼容 Vue**；optional 不表示浏览器可以缺少 Vue。web 与 adapter 的实际 Vue 解析目标由干净安装检查确认一致。

`npm run check:boundaries` 现在同时拒绝 PM 直接使用但未由 adapter 声明的依赖，以及私有 Vue runtime、缺失/非 optional peer、宿主范围不一致。干净安装前后 Node ESM/CJS、Vite浏览器及 HMAC替换证据见 [依赖声明验证](../../docs/audits/PM_ADAPTER_DEPENDENCY_INSTALL_AUDIT_20261017.md)。loader、实际发布分类、经典 FOK 和本地簿默认开关均不受本次声明整理改变。

```bat
cd changmen
npm run test:adapter --workspace=@changmen/backend
```
