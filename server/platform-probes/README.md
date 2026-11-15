# @changmen/platform-probes

可选的平台探针和调试 CLI。后端必需的会话、登录、请求头和采集配置模块归属 `@changmen/venue-node`，本包通过其公开 `runtime/*` 子入口复用，不保留旧位置转导出。

生产 backend 和 venue-node 不依赖本包。backend 仅为保留手动 CLI 命令将其列为开发依赖；生产 `--omit=dev` 安装及路由加载不需要探针目录。

从仓库根按需运行：

```powershell
npm run ob:view --workspace=@changmen/platform-probes -- --match <id>
```

命令访问真实平台前需要有效会话。只启动 backend 不会执行探针 CLI。浏览器 OB 锁盘观察工具仍使用 `npm run ob:lock-observe --workspace=@changmen/venue-browser`。

HG 会话和余额查询只供手动工具使用，实现在 `hg/session.js`，不属于生产运行资源。纯调试解析器与 WebSocket 实现继续留在本包；例如 IA HTTP、PB 解析器和 IA/RAY/TF 调试 WebSocket，不通过后端的 `requirePlatform` 暴露。backend 的 `check:collect -- --probe` 按需导入这些可选工具。

平台参数见各目录说明及 `package.json`。可选 `sync:backend-bundle` 只复制探针工具到历史 `server/backend/platform_node` 目录，不参与普通后端资源同步；后端资源单独由 venue-node 交付。

[服务端平台运行模块](../venues/README.md)；[本机开发](../../LOCAL_DEV.md)。
