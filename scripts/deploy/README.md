# scripts/deploy/

本机 → 香港 VPS 的 **Node/BAT 部署入口**（整仓 tarball + 本地 `dist`）。VPS 上增量步骤见 [`deploy/scripts/`](../../deploy/scripts/)（bash）。

受管版本发布统一使用 [`publish.sh`](publish.sh)，GHA 与 `sh/deploy-frontend.sh` / `sh/deploy-backend.sh` 共用。下面历史 BAT/fast 工具不适用于新的版本目录后端；详见 [独立部署](../../docs/INDEPENDENT_DEPLOYMENT.md)。

## 发布与数据库维护分离

普通后端发布在切换 PM2 前执行 `check-rds-schema.mjs`，在只读事务中核对数据库结构及 SQL 校验和。发布不再执行历史账号导入、owner 回填、证书建表或 OB timer 清理；需要结构或数据维护时，应单独评审并执行。基线由空 PostgreSQL 18 数据库执行 42 个编号迁移和证书补充 SQL 生成，不是线上数据快照。

只兼容已核实的 13 处历史归档字段定义及 4 处旧对象名称；兼容规则仍核对完整定义、约束有效性和序列归属，实际缺失或未知差异阻断发布。兼容过程不改库、不写迁移账本。

回滚只恢复旧版本运行进程，不依赖旧版本包含新预检脚本。恢复后核对 HTTP、内嵌 matcher 心跳，以及 8 个进程的唯一实例、PID、状态、精确目录和入口；受管旧版本还必须匹配其保存的提交和源码指纹。首次接管非版本目录时没有历史制品证据，只核对运行健康和进程路径。缺少受管旧版本证据时，发布在触碰进程前停止。`DEPLOY_RUNTIME_ONLY=1` 仅用于受管发布控制器，必须同时设置 `DEPLOY_RELEASE_MODE=1`。它不提供数据迁移的逆向回滚。

前后端切换期间收到 TERM、HUP、INT 会执行恢复并以非零状态退出；恢复期间忽略重复中断。SIGKILL 或主机断电无法通过 shell trap 恢复，仍需运维恢复，不应将“自动回滚”视为这些场景的保证。

PR workflow 在无生产密钥、不可用的本地数据库地址下执行 `check:change`；现有生产发布仍保留制品校验、串行发布与原子切换。FOK 保护规则、A8 前端、账号读写和投注逻辑均不属于本次部署改动。

验证：`node scripts/deploy/check-controls.mjs`。真实数据库回归另用 `node scripts/deploy/check-schema-postgres.mjs`，需要本机 PostgreSQL 18 的 `initdb`、`pg_ctl` 位于 PATH 或 `CHANGMEN_TEST_PG_BIN`；只创建并销毁临时本地集群，不读取应用 `.env`。

## 脚本

| 文件 | 用途 |
|------|------|
| **`deploy202.bat`** | 紧急：本机 `app:build` + 打包 dist → **47.57.10.202**（日常用 GHA） |
| `deploy-hk-remaining.mjs` | 通用 HK 部署（可传 host；`deploy202.bat` 用此脚本） |
| `pack-git-repo.mjs` | `git archive` 打包 HEAD（本机部署与 GHA 共用，40MB 熔断） |
| `deploy-hk-fast.mjs` | 仅变更源文件 + GHA dist（小 tarball） |
| `deploy202.bat` | 生产 202 紧急部署（GHA 故障时） |

生产 **202** 日常：`push master` → [前端 workflow](../../.github/workflows/deploy-frontend.yml) / [后端 workflow](../../.github/workflows/deploy-backend.yml)。env 同步见 [`scripts/sync/`](../sync/README.md)。

## 常用命令

```bat
REM 202 生产：git push origin master（GHA）；本机仅紧急
scripts\deploy\deploy202.bat
```

SSH 密钥默认：`%USERPROFILE%\.ssh\id_ed25519_changmen`。远程目录：`/root/changmen`。

仓级脚本索引：[scripts/README.md](../README.md) · 生产说明：[PRODUCTION_DEPLOYMENT.md](../../PRODUCTION_DEPLOYMENT.md)
