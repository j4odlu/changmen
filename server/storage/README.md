# @changmen/storage

**本机 JSON** 与 monorepo **路径解析**（非 PostgreSQL）。云库读写见 [`@changmen/db`](../../rds/README.md)。

实现使用严格 TypeScript，由 Node 24 原生加载。既有 `.js` 公共子路径通过 package exports 指向唯一的 `.ts` 实现；包内也使用公共入口，避免相对 `.js` 路径在 Node 和类型检查时指向不同文件。不保留 JS 实现副本或并行的手写声明。

## 使用方

| 包 | 典型用途 |
|----|----------|
| `server/backend` | `platforms.json`、esport 凭证、`.env` 加载 |
| `server/collectors/*` | Predict.fun `market_index` 等 |
| 运维脚本 | `loadChangmenEnv()`、`STORAGE_DIR` |

## 导出（节选）

| 路径 | 内容 |
|------|------|
| `@changmen/storage/paths.js` | `CHANGMEN_ROOT`、`CHANGMEN_LAYOUT`、`VENUE_ADAPTER_ROOT`、`ESPORT_DATA_DIR` |
| `@changmen/storage/load_env.js` | 加载 `server/backend/.env` |
| `@changmen/storage/game_catalog.js` | 每次调用读取 `AGGREGATE_GAME_CODES`，提供配置后的电竞范围与平台游戏 ID；共享 catalog 保持纯计算 |
| `@changmen/storage/platform_storage.js` | 平台凭证 JSON 读写 |
| `@changmen/storage/predictfun_market_index.js` | PF 市场索引 |
| `@changmen/storage/polymarket_market_index.js` | PM 电竞市场索引 |
| `@changmen/storage/sxbet_market_index.js` | SXBet 电竞市场索引 |

## 路径规则

[changmen 扩展] 环境加载、路径和市场索引类型由 TS 实现直接导出，市场索引复用 `@changmen/api-contract`。`readJsonFile<T>` 的类型参数描述调用方预期的磁盘内容；读取仍保持原来的 JSON.parse / fallback 行为，不新增 schema 校验或字段清理。

默认数据目录：`server/backend/storage/`（可由 `ESPORT_DATA_DIR` / `CHANGMEN_STORAGE_DIR` 覆盖）。Monorepo 目录布局见 `CHANGMEN_LAYOUT`（[docs/PATH_REGISTRY.md](../../docs/PATH_REGISTRY.md)）。详见 [docs/DATA_STORAGE.md](../../docs/DATA_STORAGE.md)。

## 验证

```text
npm run typecheck --workspace=@changmen/storage
npm run test --workspace=@changmen/storage
```

包测试同时执行严格类型检查、catalog/版本来源回归、原生 Node ESM/CJS 入口、环境优先级、路径覆盖、JSON 读写、首次初始化、延迟写入和 flush 行为。新增 IO/环境测试复制包到临时目录并使用合成配置，不读取本机平台凭证或连接生产数据库。

相关：[rds/README.md](../../rds/README.md)
