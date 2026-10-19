# Stake 平台

A8 采集模式�?*GraphQL 快照（可选）+ A8 Stake 聚合频道**�?

## 数据�?

```text
HTTP  POST /_api/graphql SportIndex（插�?token�?
WS    A8 聚合 Stake 房间 �?bets[]（homeId / awayId �?outcome id�?
```

## 启用

```powershell
$env:ENABLE_STAKE = "1"
$env:STAKE_API_URL = "https://stake.com"
$env:STAKE_ACCESS_TOKEN = "..."
$env:A8_SOCKET_TOKEN = "..."   # 可选，WS 增量
npm run web
```

CLI 拉快照：

```powershell
npm run stake:sports
```

页面：`http://localhost:3456/platforms/stake/`
