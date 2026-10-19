# IMT 平台

A8 采集模式�?*HTTP 双轮�?*（全�?60s + delta 1s）�?

## 数据�?

```text
POST {gateway}/mobilesitev2/api/Event/GetAllLiveEvents
POST {gateway}/mobilesitev2/api/Event/getAllLiveEventsDelta
```

请求头：`x-token`、`x-v`（token �?base64 JSON，含 `tk`/`v`）、`x-sc`、`referer`、`user-agent` 等�?

赔率 key：`{si}:{wsi}`（主�?si 707/708）。A8 仅采�?`gamenr>0` 的地图获胜盘�?

## 环境变量

| 变量 | 说明 |
|------|------|
| `IMT_GATEWAY` | 站点�?URL |
| `IMT_TOKEN` | base64 编码�?JSON 会话（含 `tk`、`v`�?|
| `IMT_REFERER` | Referer，默认同 gateway |
| `IMT_USER_AGENT` | User-Agent |
| `IMT_X_SC` | `x-sc` 头（可选） |
| `IMT_SPORT_IDS` | SportId 列表，默�?`43`（电竞大类） |
| `IMT_FULL_MS` | 全量间隔，默�?60000 |
| `IMT_DELTA_MS` | delta 间隔，默�?1000 |

`ENABLE_IMT` 为历�?Feed 开关，已删除。生产采集在平台根目录 ``�?

## 启动（CLI�?

```powershell
$env:IMT_GATEWAY = "https://your-imt-host"
$env:IMT_TOKEN = "base64-json-token"
cd changmen/packages/venue-adapter
npm run imt:events
```

