# RAY 状态对照（HTTP）

> **注意**：下文含历史 RayFeed 表述，且部分段落编码损坏。RayFeed 已删除；**生产采集**见 `../../ob/`（HTTP + 直连 `cfsocket.365raylinks.com`）。CLI 见 `node/ray/scripts/`。

绔欑偣锛歳ay164.com 鈫?API 缃戝叧 `https://cfinfo.365raylinks.com/v2/`

## 姣旇禌灞?
| 鏉ユ簮 | 瀛楁 | Feed 杈撳嚭 |
|------|------|-----------|
| `/v2/match` | `status`, `start_time`, `end_time` | `matchStatus.code` / `label` |
| `/v2/match` | `team[].score` | `score`锛堝 `1:0`锛?|
| `/v2/odds` | `start_time` + 褰撳墠鏃堕棿 | 鍒锋柊 `isLive` / `liveStatus` |

`describeMatchStatus` 瑙勫垯锛?
- `start_time <= now` 涓旀湭杩?`end_time` 鈫?杩涜涓紙`live`锛?- `status === 2` 鈫?寮哄埗瑙嗕负杩涜涓?- 鍚﹀垯鎸夊紑璧涙椂闂村尯鍒嗘湭寮€璧?/ 宸茬粨鏉?
## 鍦板浘灞傦紙stage锛?
| API `match_stage` | stageId | 灞曠ず |
|-------------------|---------|------|
| `final` | 0 | 鍏ㄥ満 |
| `r1` 鈥?`r5` | 1 鈥?5 | 鍦板浘 N |

## 鐩樺彛灞?
选盘规则见 [docs/CATALOG.md](../../../../docs/CATALOG.md) §4 / [`market_catalog.json`](../../../../packages/shared/catalog/market_catalog.json)（`match_winner` → RAY `group_name` 匹配 `^获胜者`）。
| API 瀛楁 | 鍚箟 | Feed |
|----------|------|------|
| `group_name` | 鐜╂硶鍚?| 浠呬繚鐣?catalog 涓?RAY 瑙勫垯鍛戒腑鐨勮 |
| `status === 1` | 鍙姇娉?| `winMarketStatus.label = 鍙姇娉╜ |
| `status === 4` | 鍏抽棴 | 璺宠繃鎴栭攣鐩?|
| 鍏跺畠 status | 灏佺洏 | `winLocked: true` |

## WebSocket锛圫ocketCluster 路 RAY 婧愮珯锛?
- 绔偣锛歚wss://cfsocket.365raylinks.com/socketcluster/`锛坄RAY_WS_HOST` / `RAY_WS_PATH` 鍙鐩栵級
- 璁㈤槄棰戦亾锛歚match`锛坄RAY_WS_CHANNEL`锛?- 娑堟伅鏍煎紡锛?
```json
{ "source": "odds", "odds": [{ "id": 73825398, "odds": "2.05", "status": 1, "match_id": 38386601 }] }
{ "source": "match", "match": { "id": 38386601, "status": 2 } }
```

- 浠呮洿鏂?HTTP `/v2/odds` 宸茬櫥璁拌繃鐨?`odds_id`
- `ray_feed.js` 鍦?`start()` 鏃跺皾璇曡繛鎺?WS锛坄RAY_WS=0` 鍏抽棴锛夛紱`status.ws === true` 琛ㄧず宸茶繛涓?
**绂佹** 杩炴帴 A8 鑱氬悎鏈嶅姟鍣?`47.115.75.57/esport/ws/RAY`锛堣 [A8_REFERENCE.md](../../A8_REFERENCE.md)锛夈€?
鑻?Node 鐜瀵?cfsocket 鎻℃墜澶辫触锛孎eed 浠嶅彲閫氳繃 HTTP 杞宸ヤ綔锛涢渶鎺掓煡 Origin/Token 鎴栫瓑寰呮簮绔欏崗璁枃妗ｃ€?
## HTTP 鈫?鍓嶇 Dashboard

Feed snapshot 涓?OB 瀵归綈锛?
- `matches[].matchStatus`
- `matches[].stages[].stageStatus`锛圧AY 浣跨敤 `winMarketStatus` 浣滀负 stage 閿佺洏鎬侊級
- `winHome` / `winAway` / `winLocked`
