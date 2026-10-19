# TF 平台

A8 采集模式�?*HTTP `/api/v8/events/` 快照 + A8 中继 WebSocket**（`UBe` / `WBe`）�?

**完整 A8 逻辑说明（凭证、头、轮询、下注）**�?

`client/web/docs/platforms/A8_TF_LOGIC_PARITY.md`

## 数据�?

```text
A8 esport API（form-urlencoded + header token�?
  Client_GetCollectPlatform(TF)  �? Gateway + Token + BetName
  Client_GetGames(TF)              �? game_id 列表

HTTP  {Gateway}/api/v8/events/     �? 今日比赛 + �?event �?MATCH/MAP（头 $3�?
WS    wss://�?esport/ws/TF         �? 赔率增量（auth_token = Token 去前缀�?
```

changmen �?A8 拉凭证：

| 模块 | 作用 |
|------|------|
| `integrations/a8/esport_client.js` | `postEsport`（form-urlencoded）、`fetchCollectPlatform` |
| `platforms/tf/collect_credentials.js` | 60s 缓存；账�?`integrations/a8/constants.js` �?`a8_config.json` |
| `core/esport-api/router.js` | `Client_GetCollectPlatform` TF 分支 |
| `core/esport-api/platform_sync.js` | 启动�?`syncTfFromA8()` |

登录说明：`TJ01` 等账号通常需 **v4 login** token 作为 esport 请求�?`token` header；纯 JSON body 会导致无 `info` 返回�?

## 凭证配置

| 方式 | 说明 |
|------|------|
| 自动 | `getTfA8CollectCredentials()`（推荐） |
| 环境变量 | `TF_GATEWAY`、`TF_TOKEN`、`TF_BET_NAME` |
| 文件 | `data/esport/platforms.json` �?`TF` |
| 启用 feed | `ENABLE_TF=1` |

请求头见 `tf_auth.js`（对�?A8 `$3` / `LBe`）�?

## 启用

```powershell
$env:ENABLE_TF = "1"
# 凭证通常�?platform_sync / A8 自动写入，也可手动：
# $env:TF_GATEWAY = "https://api-v4.tf-api-rr3h.com"
# $env:TF_TOKEN = "Token �?
npm run web
```

页面：`http://localhost:3456/platforms/tf/`

## 调试

```powershell
# �?A8 �?TF 采集凭证
node -e "require('./integrations/a8/esport_client.js').fetchCollectPlatformWithGames('TF').then(console.log)"

node scripts/platforms/tf/fetch_tf_events.js
node scripts/check-collect-platforms.js
```

## 文件

| 文件 | 作用 |
|------|------|
| `tf_auth.js` | `tf-authorization`（HMAC + SHA-512）、`public-token` 常量 |
| `tf_session.js` | HTTP /events |
| `tf_core.js` | 比赛/盘口归一化、WS 合并 |
| `tf_ws.js` | WebSocket 客户�?|
| `tf_feed.js` | （已删除）原 Dashboard Feed；采集在平台根目录 `` |
| `tf_game_ids.json` | TF game_id �?catalog code |

浏览器直连场�?WebSocket（不经本�?relay）。历�?`proxy/tf_ws_relay.js`（Dashboard `/esport/ws/TF`）已退役�?
