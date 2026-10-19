# ops/diagnostics/

排障与巡检：`diag-*`、`mem_diag_*`、`probe-hk-relay`、`post-deploy-check`、`polymarket-builder-trades`。

累计 30 个数据库巡检已迁至 [`server/db/maintenance/legacy/diagnostics/`](../../../../db/maintenance/legacy/diagnostics/)，本目录保留平台/后台业务诊断。

| 脚本 | npm 命令 |
|------|----------|
| `probe-hk-relay.mjs` | `npm run probe:hk-relay` |
| `post-deploy-check.mjs` | `npm run post-deploy:check` |
| `polymarket-builder-trades.mjs` | `npm run poly:builder-trades` |

迁移 SQL 的表引用检查已迁至 `server/db/maintenance/check-migration-tables.mjs`；`npm run check:rds-schema` 则调用数据层的数据库只读结构核验，两者用途不同。

运行示例：

```bash
node ../db/maintenance/legacy/diagnostics/diag-river-accounts.mjs
node scripts/ops/diagnostics/mem_diag_report.mjs
npm run probe:hk-relay
```
