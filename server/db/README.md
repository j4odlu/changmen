# @changmen/db

PostgreSQL / RDS **数据层唯一入口**。业务代码只 `import` 本包，不直连 `rds/*_store.js`。

## 使用方

| 包 | 典型用途 |
|----|----------|
| `server/backend` | `Client_*` / `API_*` 读写 orders、profiles、platform_* |
| `server/match/matcher` | `client_matches` 合并写入 |
| `server/collectors/*` | `writePlatformMatches`、PM sport 列 |
| `server/value-bet` | 订单与赔率查询 |
| 运维脚本 | `ensurePgPoolReady`、`getPgPool` |

## 目录

[changmen 扩展] `collector_contracts.d.ts` 维护现有 JS facade 中采集器使用的接口子集，由采集器显式引用。比分及历史价结构复用 `@changmen/api-contract`；这份声明不代表整个 DB 包已迁移为 TypeScript。

| 路径 | 内容 |
|------|------|
| `index.js` | 对外 API（re-export impl + 工具） |
| `impl_rds.js` | RDS facade |
| `rds/*_store.js` | 分表 store（orders、auth、client_matches、platform_*…） |
| `pg_pool.js` / `resolve_database_url.js` | 连接池与 URL 解析 |
| `runtime_schema.js` | 只读运行结构观察、指纹、请求合并与缓存 |
| `maintenance/` | 结构检查、初始化编排、观察表维护、目标迁移、结构统一及持久备份；旧 backend 脚本只转导出或分派 CLI |
| `order_link_filter.js` | LinkID / 套利链过滤 |
| `assets/migrations/` | 43 个有效迁移 SQL 的主文件；历史 SQL 内容/checksum 不变 |
| `assets/schema-baseline.json` | 结构核验基线主文件 |
| `maintenance/assets.mjs` | 维护代码统一按自身包位置读取资产，不回退 backend 路径 |
| `../backend/db/migrations/` | 原 SQL 路径兼容副本；旧脚本/固定消费者继续可读 |

[changmen 扩展] 队伍存取直接使用 `@changmen/shared/match-identity`，不再引用 server/match 实现；shared 已直接声明。维护逻辑已迁入本包，SQL、结构基线和旧 CLI 路径保留，未改变初始化、只读核验或显式维护语义。剩余项与验证见 [源码隔离记录](../../docs/SOURCE_FILE_ISOLATION_20261017.md)。

`check-rds-schema.mjs` 与 `apply-rds-schema.mjs` 的实现位于本包 `maintenance/`，可直接执行；原 backend npm 命令继续分派至同一实现。默认命令只读，只有显式 `--initialize` 可初始化空库，已有业务表仍拒绝初始化。导入这些模块不加载 `.env` 或打开连接。

[changmen 扩展] SQL 和结构基线现由本包 `assets/` 提供。在只有 DB/shared/storage、没有 `server/backend` 或浏览器依赖的干净安装中，已验证资产读取、只读核验、显式初始化、拒绝重放、观察表维护及结构统一检查。独立命令通过环境变量提供数据库配置，原 backend 宿主的配置加载与错误提示保持兼容；这不是生产发布或任意 npm 目录布局认证。

原 backend 的 43 个有效 SQL 与基线 JSON 共 44 份兼容副本，只由 canonical 资产生成，禁止分别维护。仓库根执行：

```text
node scripts/verification/rds-assets.mjs --check
node scripts/verification/rds-assets.mjs --sync
```

`--check` 不写文件，已通过边界检查持续执行；`--sync` 必须显式选择，先核验完整 canonical 资产及历史 checksum，再更新旧副本。两者都不连接数据库。退役 `002_prune_pg_cron.sql` 继续原位保留，不进入有效迁移清单。固定旧消费者和完整 551 保护不变。

## 环境变量

`DATABASE_URL` 或 `DATABASE_URL_PUBLIC` / `DATABASE_URL_INTERNAL` 由宿主环境提供；原 backend 宿主仍兼容 `server/backend/.env`。独立维护验证通过环境注入，不复制凭据文件。

本地 JSON / esport 凭证路径见 [`@changmen/storage`](../storage/README.md)，非本包职责。

相关：[server/README.md](../README.md) · [docs/DATA_STORAGE.md](../../docs/DATA_STORAGE.md)
