# ops/migrations/

数据回填与一次性迁移脚本。`npm run db:migrate-*` / `db:finalize-*` / `db:check-players` 入口见 `server/backend/package.json`。

累计 17 个数据库脚本已迁至 [`rds/maintenance/legacy/migrations/`](../../../../db/maintenance/legacy/migrations/)，原路径删除。下表保留命令/用途索引，其中 `migrate-players-owner-user-id`、`finalize-players-owner-user-id`、`migrate-accounts-jsonb-to-players`、`check-players-rds-migrate`、`backup-profiles-accounts`、`migrate-pm-sell-pnl-to-buy`、`restore-pm-sell-money-from-pnl-usdc`、`restore-pm-buy-money-from-sell-pnl`、`migrate-order-hash-link-to-create-at` 位于新目录；对应 npm 入口已同步指向数据层。

## 脚本

| 脚本 | npm 命令 | 说明 |
|------|----------|------|
| `migrate-players-to-rds.mjs` | `db:migrate-players` | `storage/*.json` → RDS players |
| `migrate-players-owner-user-id.mjs` | `db:migrate-players-owner` | 回填 `owner_user_id`（027 前） |
| `finalize-players-owner-user-id.mjs` | `db:finalize-players-owner` | 收尾 orphan player（027 前必跑） |
| `migrate-accounts-jsonb-to-players.mjs` | `db:migrate-accounts-from-jsonb` | `profiles.accounts` → `players.account_data` |
| `strip-pm-private-keys.mjs` | （手动） | 剥离 Polymarket `token.privateKey`（先 dry-run，再 `--apply`） |
| `check-players-rds-migrate.mjs` | `db:check-players` | 迁移后审计报告 |
| `backup-profiles-accounts.mjs` | `db:backup-accounts` | 部署前 players 账号快照 |
| `backfill-pm-match-result.mjs` | — | 买单回填 `raw.pmMatchResult`（只写赛果，不改 money/status） |
| `migrate-pm-sell-pnl-to-buy.mjs` | — | 卖单 money → 买单累加；卖单 money=0（`--dry-run` / `--execute`） |
| `restore-pm-sell-money-from-pnl-usdc.mjs` | — | 从 raw.pmRealizedPnlUsdc 恢复被 sync 清零的卖单 money |
| `restore-pm-buy-money-from-sell-pnl.mjs` | — | closed/partial 买单 money=0 时从卖单 pnlUsdc 恢复买单 money |
| `archive-stale-client-matches.mjs` | `db:archive-stale` | `client_matches` 时间归档（手动/crontab 兜底） |
| `prune-stale.mjs` | `db:prune` | 已废弃别名 → `archive-stale-client-matches` |
| `migrate-order-hash-link-to-create-at.mjs` | — | 订单 hash 链补 `create_at`（`--execute` 执行） |

这些维护命令不由应用发布自动执行。发布行为见 [`deploy/scripts/deploy-server-remote.sh`](../../../../../deploy/scripts/deploy-server-remote.sh)。

运维手册：[docs/ACCOUNT_BACKEND.md](../../../../../docs/ACCOUNT_BACKEND.md)
