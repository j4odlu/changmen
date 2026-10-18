# @changmen/storage

**本机 JSON** 与 monorepo **路径解析**（非 PostgreSQL）。云库读写见 [`@changmen/db`](../db/README.md)。

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
| `@changmen/storage/platform_storage.js` | 平台凭证 JSON 读写 |
| `@changmen/storage/predictfun_market_index.js` | PF 市场索引 |
| `@changmen/storage/polymarket_market_index.js` | PM 电竞市场索引 |
| `@changmen/storage/sxbet_market_index.js` | SXBet 电竞市场索引 |

## 路径规则

[changmen 扩展] `load_env.d.ts` 与 `polymarket_market_index.d.ts` 为对应 JS 导出提供类型声明，PM 市场索引复用 `@changmen/api-contract`。声明在本包维护，供两套 PM TypeScript 采集器共用。

默认数据目录：`server/backend/storage/`（可由 `ESPORT_DATA_DIR` / `CHANGMEN_STORAGE_DIR` 覆盖）。Monorepo 目录布局见 `CHANGMEN_LAYOUT`（[docs/PATH_REGISTRY.md](../../docs/PATH_REGISTRY.md)）。详见 [docs/DATA_STORAGE.md](../../docs/DATA_STORAGE.md)。

相关：[server/db/README.md](../db/README.md)
