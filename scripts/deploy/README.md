# scripts/deploy/

[changmen 扩展] 发布入口为 GitHub Actions **Validate and release**（`release.yml`）。前端只换静态制品，后端只更新应用进程，RDS 结构与数据维护另行执行。详见 [独立部署](../../docs/INDEPENDENT_DEPLOYMENT.md)。

- `change-plan.mjs`：组合变更风险与组件选择；仅双方联动时要求后端先发布。
- `read-deployed-versions.mjs`：只读已发布目录/成功记录，不依赖后端 HTTP 或 RDS。
- `release-evidence.mjs`、`verify-runtime.mjs`：绑定验收、提交、制品和运行身份。
- `publish.sh`：运输已经验收的制品；GHA 组件 workflow 不再构建。
- `verify-backend-processes.mjs`：核对既有 8 个进程的唯一实例、PID、状态、目录与入口。
- `release-retention.mjs`：保留当前及上一成功版本，保护实际运行路径及共享数据。

VPS 控制器位于 [`deploy/scripts/`](../../deploy/scripts/)：前端失败恢复旧入口；后端安装/编译和 `SELECT 1` 通过后才激活，失败恢复旧运行版本并核验。普通发布不运行迁移、历史账号导入、owner 回填、timer 清理或整库结构比较。回滚不逆向修改数据库。

验证：`node scripts/deploy/check-controls.mjs`。测试涵盖独立发布、联动阻断、连接失败、错误版本、重试和 TERM/HUP/INT 恢复。FOK 551 保护、A8 前端与投注/账号逻辑保持原有实现。

历史 `deploy202.bat`、`deploy-hk-remaining.mjs`、`deploy-hk-fast.mjs` 仍在仓库，不用于受管生产发布。本机仅开发、验证、commit/push 和只读核验。env 同步入口见 [`scripts/sync/`](../sync/README.md)，与普通应用发布分开。

仓级索引：[scripts/README.md](../README.md) · 生产说明：[PRODUCTION_DEPLOYMENT.md](../../PRODUCTION_DEPLOYMENT.md)
