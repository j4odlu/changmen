# scripts/deploy/

本机 → 香港 VPS 的 **Node/BAT 部署入口**（整仓 tarball + 本地 `dist`）。VPS 上增量步骤见 [`deploy/scripts/`](../../deploy/scripts/)（bash）。

受管版本发布统一使用 [`publish.sh`](publish.sh)，GHA 与 `sh/deploy-frontend.sh` / `sh/deploy-backend.sh` 共用。下面历史 BAT/fast 工具不适用于新的版本目录后端；详见 [独立部署](../../docs/INDEPENDENT_DEPLOYMENT.md)。

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
