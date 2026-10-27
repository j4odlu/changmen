# @changmen/db

物理目录为仓库根 `rds/`，与前端 `client/`、后端 `server/` 分离。公开包名保持不变；SQL 维护独立于应用发布执行。

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
| `admin_maintenance.js` | 管理报表的三条只读查询；backend 通过公开子入口读取原始结果并完成报表组装 |
| `maintenance/profile_repairs.js` | 三份历史账号修复脚本的数据操作；公开接口不暴露连接池，SQL 留在数据层，后台保留日志、参数与缓存刷新 |
| `maintenance/` | 结构检查、初始化编排、观察表维护、目标迁移、结构统一及持久备份，以及对应维护测试；backend 旧入口已退役 |
| `maintenance/legacy/` | 从 backend 分两批迁入的 140 个数据库诊断/迁移/事故修复/归档脚本；保留原执行参数与默认行为及已核对的历史资源位置 |
| `order_link_filter.js` | LinkID / 套利链过滤 |
| `assets/migrations/` | 43 个有效迁移 SQL 的主文件；历史 SQL 内容/checksum 不变 |
| `assets/schema-baseline.json` | 结构核验基线主文件 |
| `maintenance/assets.mjs` | 维护代码统一按自身包位置读取资产，不回退 backend 路径 |
| `assets/archive/` | 不参与有效迁移的历史 SQL；目前保留已退役的 `002_prune_pg_cron.sql` |

[changmen 扩展] 队伍存取直接使用 `@changmen/match-identity`，不再引用 server/match 实现；身份领域包已直接声明。维护逻辑、SQL、结构基线与维护测试均归本包，backend 原有 44 份资产副本和 7 个维护入口已删除，初始化、只读核验及显式维护语义保持不变。批次记录见 [源码隔离记录](../../docs/SOURCE_FILE_ISOLATION_20261017.md)。

`check-rds-schema.mjs` 与 `apply-rds-schema.mjs` 位于本包 `maintenance/`，可直接执行；backend npm 命令直接执行此处文件。默认命令只读，只有显式 `--initialize` 可初始化空库，已有业务表仍拒绝初始化。导入这些模块不加载 `.env` 或打开连接。

[changmen 扩展] SQL 和结构基线现由本包 `assets/` 提供。在只有 DB/shared/storage、没有 `server/backend` 或浏览器依赖的干净安装中，已验证资产读取、只读核验、显式初始化、拒绝重放、观察表维护及结构统一检查。独立命令通过环境变量提供数据库配置，原 backend 宿主的配置加载与错误提示保持兼容；这不是生产发布或任意 npm 目录布局认证。

43 个有效 SQL 与基线 JSON 共 44 份主资产保留原历史 checksum，旧 backend 副本不得恢复。仓库根执行只读文件核验：

```text
node scripts/verification/rds-assets.mjs --check
```

`--check` 核验完整主资产、历史 checksum 和旧资产缺席，不写文件、不连接数据库；原 `--sync` 生成功能已退役。`002_prune_pg_cron.sql` 原字节归档，不进入有效迁移清单。固定旧消费者继续由 Git 历史快照物化验证，完整 551 保护不变。

结构专项脚本统一位于 `maintenance/`：`apply-sport-matcher-033.mjs`、`verify-team-provider-ids.mjs`、`apply-client-certificate-schema.mjs`、`check-migration-tables.mjs`。两个 apply 命令只在显式维护时执行；表引用检查 `node rds/maintenance/check-migration-tables.mjs` 只读源码和 SQL，不连接数据库。旧 backend 路径已删除。

## 环境变量

`DATABASE_URL` 或 `DATABASE_URL_PUBLIC` / `DATABASE_URL_INTERNAL` 由宿主环境提供；原 backend 宿主仍兼容 `server/backend/.env`。独立维护验证通过环境注入，不复制凭据文件。

本地 JSON / esport 凭证路径见 [`@changmen/storage`](../server/storage/README.md)，非本包职责。

相关：[server/README.md](../server/README.md) · [docs/DATA_STORAGE.md](../docs/DATA_STORAGE.md) · [workspace 总览](../docs/WORKSPACE_LAYOUT.md)
