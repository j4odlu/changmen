# 独立前后端发布

GitHub Actions：`Deploy frontend` / `Deploy backend`。两者仅发布 `master`，均可手动运行，前端不等待后端。每端一个 job，无 dist artifact 上传/下载中转。

| 变更 | 自动发布 |
|---|---|
| `client/web/**` | 前端 |
| `server/**`、`devtools/**`、`lines/**` | 后端 |
| `packages/**`、根 package/lock、`turbo.json` | 两端，独立执行 |
| `chrome-extension/**` | 扩展另行分发；若同时改变根 lock，会触发两端 |

共享包初期保守触发两端，尚未按包内部文件细分。纯文档也可能触发发布。`paths` 只判断本次 push，不会自动补发上次失败的一端；失败应重跑对应 workflow，或在 Actions 手动发布最新 master。更大范围的变更有 GitHub 路径过滤限制，必要时手动运行。

## 配置与布局

继续使用 `DEPLOY_SSH_KEY`、`DEPLOY_USER`、`DEPLOY_PORT`、`DEPLOY_REPO` Secrets；默认 root、22、`/root/changmen`，目标香港 47.57.10.202。现网必须已完成旧目录迁移；新脚本不会自动搬 `/root/gamebet` 或嵌套目录。若旧 Secret 仍指向 `/root/gamebet`、实际 `/root/changmen/server/backend` 已存在，会沿用原逻辑纠正别名。首次启用前确认真实应用根存在 `server/backend/.env`，服务器具备 Node 24+、npm、PM2、GNU tar/coreutils、flock、curl。

前端构建不接收私钥或平台 API Key。私钥来自运行时账号/钱包，平台 relay 配置和 Key 由服务器 `.env` 管理。日常发布不改 relay env，也不发送 Telegram 自检消息；业务链路探针仍可独立运行。

每次发布使用独立上传目录和 SHA256 校验。服务器端各端独立 flock 锁，GHA 和 `sh/deploy-{frontend,backend}.sh` 共用相同入口。状态位于 `<root>/.deploy-state/{frontend,backend}`，包含成功的 GHA run number 与 SHA。旧 run 重跑会被拒绝；同一次失败 run 可以重试。两端 run number 不能互相比较。本机发布保留 GHA 水位，但不提供 Git 祖先关系校验，操作员需确认当前 HEAD。

| 项目 | 路径 |
|---|---|
| 前端版本 | `<root>/.releases/frontend/<release-id>` |
| 页面入口（Caddy 路径不变） | `<root>/client/web/dist` → 前端版本 |
| 后端版本（完整 workspace 布局） | `<root>/.releases/backend/<release-id>` |
| 成功后端版本 | `<root>/backend-current` → 后端版本 |
| 持久配置/热缓存 | 原 `<root>/server/backend/.env`、`storage`，后端版本通过符号链接引用 |

后端源码仍为整仓包，安装使用每个版本独立的 `npm ci`；尚未优化成瘦包或细粒度进程重启。CI 和服务器都编译 router，前者阻止错误代码发布，后者验证实际安装环境。PM2 的 cwd 是具体版本目录，`backend-current` 用于成功版本记录和回滚；运维查看正在运行的源码以 PM2 cwd 为准，原根目录源码不再随 Actions 更新。

后端 CI 使用 `npm run test:backend`：公共边界、共享包和契约检查执行一次，测试覆盖所有 `server/` workspace 及其依赖，不执行 web 测试。前端 workflow 负责 web 测试和带类型检查的构建。根 `npm test` 仍运行全仓测试。matcher 的 identity 测试由 Turbo 依赖图调度一次；`npm run composer:test` 包含依赖测试，在 matcher 目录直接运行 `npm test` 只测本包，需包含 identity 时用 `npm run test:with-deps`。

两端仍各自运行部署脚本测试，保证单端发布、手动发布和失败重跑都有独立检查。该检查耗时约两秒，暂不引入跨 workflow 的等待或共享成功状态。

成功发布后，原根目录 `deploy/ecosystem.config.cjs` 改为指向 `backend-current` 的入口，保证旧 watchdog 的 start 兜底不会启动过期源码。首次切换保存原配置到 `.deploy-state/backend-bootstrap-ecosystem.cjs`；首次失败时恢复该配置，并清掉失败的版本入口。

## 首次切换、验收与回滚

前端第一次把实际 dist 目录搬到版本目录并建立链接，会有短暂目录切换空窗；后续均原子替换链接。新版本保留旧 hashed assets，避免已打开页面的懒加载资源丢失。通过 HTTPS `changmen.fun`（curl resolve 到本机 Caddy，保留域名/TLS）检查 `deploy-version.txt` 为本次 SHA，并请求主 JS；失败恢复上一版。首次无上一版时撤销失败入口，无法恢复旧页面。

后端先将干净归档与实际运行版本逐文件比较，生成变更清单，再在版本目录安装和编译，并用既有 PM2 清单激活。数据库迁移维持 master 的备份、owner 回填、schema 顺序；仅实际变化的迁移输入触发相应步骤，证书 schema 独立应用，不触发账号/订单回填。首次采用也比较原应用根实际文件。等待 API 和内嵌 matcher 心跳，检查数据库 SELECT 1，以及八个启用进程的状态和 cwd。失败重新激活上一版，回滚不传迁移清单；首次回退到原应用根。暂停的 SXBet 与独立 matcher 不会启动。

**数据库变化不随代码回滚。** schema 变更须兼容上一版。跨端接口按「兼容后端 → 前端切换 → 后端清理」分步提交/发布，不能把有先后依赖的破坏性改动放进一次并发发布。需要严格顺序时分别手动运行并确认上一端成功。

保留所有版本供回滚，当前不自动清理；需定期检查磁盘占用。清理前确认 PM2 cwd、前端入口和上一版，不能删正在运行的后端版本或共享 `.env`/storage。后台热数据、collector 同步不停止；单实例 esport 原则保持。

旧 `apply-repo-archive.sh` / `apply-dist-archive.sh` 在检测到受管版本入口时拒绝原地部署。其它直接写源文件的历史 fast/BAT 工具不能用于受管后端，应改用上述入口；迁移/诊断脚本可在 `backend-current` 内执行。本机后端归档只打包已提交 HEAD，需先提交包含新发布脚本的代码。

## 离线验证

```bash
node --test scripts/deploy/classify-deploy-scope.test.mjs scripts/deploy/workflows.test.mjs
bash scripts/deploy/release.test.sh
npm run check:boundaries
```

集成检查使用临时目录和模拟网络/PM2，覆盖旧目录接管、旧 chunk 保留、旧 run 拒绝、失败重试、两端回滚和 storage 隔离。真实服务器的权限、Caddy/mTLS、RDS、外部平台连接须在首次发布验收。
