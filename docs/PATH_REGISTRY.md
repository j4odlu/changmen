# 路径登记表（I1）

> **目的**：monorepo 内关键目录只在本表 + `@changmen/storage/paths.js` 的 `CHANGMEN_LAYOUT` 登记一次。  
> **阶段 19 后**不大规模物理搬家；若必须挪目录，先改 `CHANGMEN_LAYOUT`，再按本表扫消费方。

相关：[ARCHITECTURE.md](./ARCHITECTURE.md) · [TEAM_BOUNDARIES.md](./TEAM_BOUNDARIES.md) · [SPORTS_PRODUCT_LINES.md](./SPORTS_PRODUCT_LINES.md)

---

## 1. Canonical 定义（改路径只改这里）

| 符号 | 定义位置 | 说明 |
|------|----------|------|
| `CHANGMEN_ROOT` | `server/storage/paths.js` | monorepo 根（向上查找 `server/backend`） |
| `CHANGMEN_LAYOUT` | 同上 | 各目录相对根的 **POSIX** 段 |
| `VENUE_ADAPTER_ROOT` | 同上 | `join(CHANGMEN_ROOT, layout.venueAdapter)` |
| `CLIENT_WEB_ROOT` | 同上 | `client/web` 绝对路径 |
| `PLATFORM_PROBES_ROOT` | 同上 | `server/platform-probes` |
| `BACKEND_ROOT` | 同上 | 可被 `CHANGMEN_BACKEND_ROOT` 覆盖 |

环境变量覆盖（瘦包 / 测试）：

| 变量 | 覆盖对象 |
|------|----------|
| `CHANGMEN_ADAPTER_ROOT` | venue-adapter 根（须含 `registry/manifest.json`） |
| `CHANGMEN_PLATFORM_PROBES_ROOT` | Node 探针根 |
| `CHANGMEN_BACKEND_ROOT` | backend 根 |

---

## 2. `CHANGMEN_LAYOUT` 一览

| 键 | 默认相对路径 | 用途 |
|----|--------------|------|
| `venueAdapter` | `server/venues/registry/runtime` | 服务端 registry 资源根；旧目录仅保留兼容与验证 |
| `clientWeb` | `client/web` | 电竞 Vue 控制台 |
| `clientChromeExtension` | `chrome-extension` | MV3 插件 |
| `platformProbes` | `server/platform-probes` | Node 探针 CLI |
| `packages` | `packages` | 跨端 TS 包 |
| `serverBackend` | `server/backend` | HTTP API |
| `serverMatcher` | `server/match/matcher` | 合场算法 + matchMerge 循环 + 人工关联 UI |
| `serverDb` | `server/db` | RDS 入口 |
| `serverCollectors` | `server/collectors` | VPS daemon |
| `lines` | `lines` | 产品线 manifest |
| `baseball` | `baseball` | 棒球代码目录 |

产品线组件路径见 `lines/{code}/line.json` 的 `components`（与 layout 一致，不重复登记逻辑）。

---

## 3. 已接入 canonical 的消费方

| 消费方 | 用法 |
|--------|------|
| `server/venues/loader/adapter_paths.mjs` | `getAdapterRoot()` 优先 `VENUE_ADAPTER_ROOT` |
| `server/venues/registry/paths.js` | 开发态 `ADAPTER_ROOT`；探针 `PLATFORM_PROBES_ROOT` |
| `client/web/vite.config.ts` | `@changmen/venue-browser` 解析与 `venueChunkName` |
| `scripts/check-team-boundaries.mjs` | 发现各平台浏览器根目录 |
| `@changmen/venue-adapter/package.json` | 仅两个 Node loader 子路径 |
| `client/web/package.json` | workspace 依赖 `@changmen/venue-browser` |
| `@changmen/client-core/package.json` | `exports` 白名单（I3g，扫描 web + venue-browser） |

---

## 4. Web 消费浏览器 workspace

[changmen 扩展] Web 直接依赖 @changmen/venue-browser，源码使用其 adapter/ 及其他显式子路径。浏览器实现与测试位于 client/packages/venue-browser/，旧 packages/venue-adapter 中的 595 个浏览器文件及旧包别名均已退役。

浏览器入口以 client/packages/venue-browser/package.json 的显式 exports 为准。CHANGMEN_LAYOUT.venueAdapter 与 lines/esport/line.json 的 components.venueAdapter 表示服务端 registry 资源根，不用于解析浏览器源码。

旧 sync-package-exports.mjs 只维护两个 Node loader 导出，发现旧浏览器引用时拒绝生成。npm run check:venue-adapter 同时检查旧包导出、旧引用和冻结范围。

client-core 的 exports 工具位于 client/packages/client-core/scripts/，扫描 client/web/src 与 client/packages/venue-browser。npm run check:client-core 校验 exports、包内相对引用与消费方清单。

---

## 5. 文档 / 注释中的路径

以下仅作说明，**不参与**构建解析；挪目录后批量替换即可：

- `docs/*`、`readme.md`、`server/**/README.md` 中的 `packages/venue-adapter` 文字
- collector `parse_*.js` 头部注释「与 packages/venue-adapter/… 对齐」
- 本地 A8 对照（gitignore，见 [LOCAL_DEV.md](../LOCAL_DEV.md)）：`A8/index0706.js`、`A8/A8插件/`。不要写已不存在的 `A8/A8frontendscipts/2.0.1/` 或仓库旁 `../A8/`

---

## 6. 产品线 `sharedPackages`（manifest）

`lines/*/line.json` 声明该线依赖的 workspace 包（不复制源码）：

| 线 | `sharedPackages` |
|----|------------------|
| esport | `@changmen/shared`、`@changmen/api-contract`、`@changmen/client-core`、`@changmen/arb-core`、`@changmen/venue-adapter` |
| baseball | `@changmen/client-core`、`@changmen/arb-core` |

上述产品线清单含 Node 兼容包，不等同于 Web 的安装依赖；Web 的实际依赖以 client/web/package.json 为准。

`capabilities` 仍表示**功能**（如 `arbitrage`），与 npm 包名分开。

---

## 7. 校验

```bat
node server/storage/paths_smoke.test.mjs
npm run check:boundaries
npm run check:client-core
npm run check:venue-adapter
```

---

## 8. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-07-13 | I3h：下沉 `LoseOrder`、`types/order`、`types/esport` 至 client-core |
| 2026-07-13 | I3g：`client-core` exports 白名单、`check:client-core`、消费方扫描 |
| 2026-07-13 | I3f：venue-adapter 包内相对路径、`chrome-extension` 迁根目录 |
| 2026-07-13 | I3d：venue-adapter 包内 `@venue/*` → `@changmen/venue-adapter/*`；web 移除 `@venue` alias |
| 2026-07-13 | I3c：删 web `client-core` shim，直连 `@changmen/client-core/*` |
| 2026-07-13 | I2b：web `@venue/*` → `@changmen/venue-adapter/*` |
| 2026-07-13 | I2a：`@changmen/venue-adapter` exports、web 去 tsconfig include |
| 2026-09-16 | 登记本机 A8 对照：`A8/index0706.js`、`A8/A8插件/`（旧 `A8frontendscipts/2.0.1` 路径作废） |
| 2026-07-13 | I1：`CHANGMEN_LAYOUT`、PATH_REGISTRY、vite/boundaries/loader 接入 |
