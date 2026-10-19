# server/backend/scripts

后端运维与启动脚本。`npm run` 入口见 `server/backend/package.json`。

数据库维护脚本已集中到 [`server/db/maintenance/`](../../db/maintenance/)；累计 140 个历史脚本归入 [`legacy/`](../../db/maintenance/legacy/)，旧文件删除。本目录保留启动、后台业务及平台编排、混合脚本和待拆的数据访问。

## 目录

| 路径 | 用途 |
|------|------|
| **根目录** | 启动与日常 CLI：`web`、`db:apply`、`account:*`、`check:collect` 等 |
| [`ops/incidents/`](ops/incidents/) | 需要后台业务/平台能力的混合事故修复 |
| [`ops/diagnostics/`](ops/diagnostics/) | 平台排障、deploy 自检及混合诊断 |
| [`ops/migrations/`](ops/migrations/) | 仍依赖后台实现的混合回填、归档与补跑 |
| [`archive/`](archive/) | 仍待分离业务依赖或旧路径的历史脚本 |
| [`lib/`](lib/) | 脚本共用模块（如 `pb_auth.mjs`） |

## 根目录脚本（与 package.json 对齐）

| 脚本 | npm 命令 |
|------|----------|
| `start-db.mjs` | `npm run web` |
| `start-rds.mjs` | `npm run web:rds` |
| `preweb.js` | `preweb` |
| `account_cli.js` | `npm run account:*` |
| `check-collect-platforms.js` | `npm run check:collect` |
| `ensure-router-compiled.mjs` | `compile:router`（preweb 链） |
| `test-packaged-adapter-layout.js` | `npm run test:adapter` |

完整列表以 `package.json` `scripts` 段为准。

`db:apply`、`db:initialize`、`check:rds-schema` 直接执行数据层正式入口；四个已迁移历史命令 `db:migrate-players-owner`、`db:migrate-accounts-from-jsonb`、`db:finalize-players-owner`、`db:check-players` 也直接指向数据层，命令名称和原参数保持。

`user:create` 与 `db:backup-accounts` 已改为执行数据层的 `legacy/create-user.js`、`legacy/migrations/backup-profiles-accounts.mjs`；原命令名称和参数保持。

`ops/incidents/fix-river-dedupe-pm.mjs`、`fix-river-prune-players.mjs`、`fix-sh01-river-accounts.mjs` 的 10 处 SQL 已收口到 `@changmen/db/maintenance/profile_repairs.js` 的 9 个数据操作。三个脚本仍负责原有修复计划、输出和后台缓存刷新，不再持有数据库连接池；脚本名称、参数、默认写入行为及连接关闭时机保持。这是混合脚本的数据访问拆分，不计入上面的 140 个整文件迁移。

## 约定

- **根目录冻结（阶段 19）**：保留既有启动/日常 CLI；**不再**向根目录新增脚本。
- **纯数据库维护/诊断**：写在 `server/db/maintenance/`，不得再放回 backend。
- **后台/平台编排脚本**：事故修复归 `ops/incidents/`；混合迁移/归档/补跑归 `ops/migrations/`；平台排障及 deploy 自检归 `ops/diagnostics/`；数据访问应继续拆至数据层。
- **运行**：在 `server/backend` 下 `node scripts/<path>`。

仓级脚本索引：[scripts/README.md](../../../scripts/README.md) · 落点规则：[ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) §迁移进度
