# OB �?Node 库与 CLI

本目录为 **直连 OB 场馆�?Node 代码**（登录、HTTP、MQTT 归一化、调试脚本）�?*不是** changmen 服务端（`server/backend`），�?*不是**已删除的历史 ObFeed / Dashboard 采集�?

生产采集见 ../../packages/venue-adapter/ob/（浏览器 → API_SaveMatch / API_SaveBet）。

## 配置

### 登录地址（可变更�?

默认登录 URL（demo 商户）见 `session.js` �?`DEFAULT_LOGIN_URL`�?

| �?| 说明 |
|----|------|
| 环境变量 | `OB_LOGIN_URL` �?覆盖默认登录 URL |
| CLI | `npm run ob:login` �?`node node/scripts/fetch_ob_login.js "<url>"` |

登录成功返回 `token` �?`pc` / `h5` 入口，从中解�?API 网关�?MQTT WebSocket 地址�?

## 数据流（CLI / 探针视角�?

```text
GET  member/login          �? token + pc/h5 入口
GET  {gateway}/game/index  �? 比赛列表
GET  {gateway}/game/view   �? 单场盘口快照
GET  {gateway}/game/getTimer �?当前地图
MQTT {mqtt}/...            �? 赔率/锁盘增量（源站网关）
```

## 环境变量（CLI / 脚本�?

| 变量 | 说明 |
|------|------|
| `OB_LOGIN_URL` | 登录完整 URL |
| `OB_MQTT_URL` | 可选，覆盖 MQTT 地址（`fetch_ob_mqtt.js`�?|

以下变量仅见�?*历史 ObFeed** 文档，当前无对应进程，可忽略�?

| 变量 | 说明 |
|------|------|
| `ENABLE_OB` | （已废弃）原 Dashboard Feed 开�?|
| `OB_FEED_MODE` | （已废弃）原 Feed 多源 index 模式 |

## 主要文件

| 文件 | 作用 |
|------|------|
| `session.js` | 登录、网关探测、HTTP 请求 |
| `core.js` | 归一化、MQTT `applyMqttPayload`、状态描�?|
| `scripts/fetch_ob_login.js` | 调试登录 |
| `scripts/fetch_ob_view.js` / `fetch_ob_live.js` / `fetch_ob_mqtt.js` | CLI 调试 |
| `scripts/probe_market_status.js` | 扫描盘口 status 组合 |
| `scripts/ob_collect_hybrid.js` | HTTP+MQTT 混合采集实验脚本 |

HTTP 锁盘公式与 SaveBet 字段：../../packages/venue-adapter/ob/shared/save_bets.ts（浏览器生产路径共用）。

## 启动示例

```bat
cd changmen/server/platform-probes
npm run ob:login
npm run ob:view -- --match <match_id> --stage 0
npm run ob:mqtt -- --match <match_id> --duration 60
```

## 相关文档

- [STATUS_MAPPING.md](./docs/STATUS_MAPPING.md) �?比赛/地图/盘口状态来�?
- [MARKET_STATUS.md](./docs/MARKET_STATUS.md) �?盘口 locked �?MQTT 映射�?*�?`core.js`**�?
- [GAME_INDEX.md](./docs/GAME_INDEX.md) / [GAME_IDS.md](./docs/GAME_IDS.md) �?game_id �?index 结构
