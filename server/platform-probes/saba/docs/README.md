# SABA 平台

A8 采集模式�?*页面解析 + 自有 WebSocket**�?

## 数据�?

```text
GET  {gateway}/{token}/ESports/43/ALL?mode=m0&market=L  �?解析 ES.url/id/account
POST LoginCheckin/Index（心跳）
WS   wss://{host}  �?m/o/done/reset 消息
赔率 key：{oddsid}:Home / {oddsid}:Away（马来盘转欧赔）
```

## 启用

```powershell
$env:ENABLE_SABA = "1"
$env:SABA_GATEWAY = "https://..."
$env:SABA_TOKEN = "..."
$env:SABA_GAME_IDS = "43"    # 可选，联赛�?id 过滤
npm run web
```

CLI 解析页面�?

```powershell
npm run saba:parse
```

页面：`http://localhost:3456/platforms/saba/`
