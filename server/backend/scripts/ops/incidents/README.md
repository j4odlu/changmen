# ops/incidents/

一次性生产事故修复脚本（按用户/订单/账号去重、迁移、手工 fix 等）。

其中累计 50 个数据库脚本已迁至 [`server/db/maintenance/legacy/incidents/`](../../../../db/maintenance/legacy/incidents/)（首批 47 个，本批 3 个），旧文件删除；本目录保留需要后台业务或平台能力的混合脚本。

运行示例（在 `server/backend`）：

```bash
node ../db/maintenance/legacy/incidents/cleanup-gb13-ob-dupes-by-primary.mjs
```

执行前确认 RDS 备份与环境；多数脚本为历史 incident 专用。
