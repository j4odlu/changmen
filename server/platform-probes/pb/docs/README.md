# PB 平台（平�?/ Pinnacle 电竞�?



后端轮询平博 **电竞 euro odds** 接口（`sportId=12`），解析逻辑对齐 A8 bundle 中的 `PZe` / `L7` / `P0`�?



## 推荐流程（与 A8 对齐：插件凭�?+ 浏览器采集）

```text
平博页登�?�?Gamebet 插件 �?复制 data（Base64�?
    �?用户中心粘贴 PB 账号
    �?/ 浏览�?bQ 等价逻辑 �?fo() + SaveMatch/SaveBet（CollectConfig 开时）

可选（仅旧 /console/ bundle）：
    ENABLE_PB_NODE=1 + patch:ui �?�?bQ，PB �?/esport/pb/proxy
```



### 1. 插件采集凭证



1. 在平博电竞页登录（URL �?`/esports-hub/` �?`/compact/sports/`�?

2. 点击 A8 第三方插件图标，复制 **`data` 字段**（整�?Base64，不�?gateway/token 单独字段�?

3. 可先校验：`npm run account:cli -- parse-credential <base64>`



### 2. 导入 platforms.json



```bash

cd scripts

npm run account:import-platform -- "<粘贴�?base64>" --sync-store

```



- 写入 `scripts/data/esport/platforms.json` �?`PB` 段（gateway、token、referer、games�?

- `--sync-store` 可选：立即同步�?esport store，供控制�?`Client_GetCollectPlatform` 使用



### 3. 启动 Node 采集（与 OB 相同�?



```bash

set ENABLE_PB=1

npm run web

# �?http://localhost:3456/console/

```



浏览器采集：`packages/venue-adapter/pb/` �?`API_SaveMatch` / `API_SaveBet`；余�?下单通过 **Chrome 插件** 代发（需安装插件并在平博页保持登录）�?



## 数据�?



```text
浏览�? bQ 轮询 + 插件 GET/POST（background 代发�?
可�?Node: GET/POST /esport/pb/proxy（ENABLE_PB_NODE=1，仅 /console/ patch�?
```



凭证：`token` 为插件同�?JSON 字符串（�?`x-app-data`、`custid_515`、`v-hucode`）�?



## 配置



### 环境变量



| 变量 | 说明 |

|------|------|

| `ENABLE_PB_NODE` | 设为 `1` �?patch `/console/`：禁�?bQ，走 `/esport/pb/proxy` |
| `PB_GATEWAY` / `PB_TOKEN` | 可选，替代 platforms.json |

| `PB_COOKIE` / `PB_REFERER` / `PB_USER_AGENT` | 可�?|

| `PB_GAME_SLUGS` | 可�?slug 过滤 |

| `PB_SYNC_MS` | （历�?Feed）轮询间隔；浏览器采集间隔见 `collect.ts` |

| `ENABLE_PB_NODE` | 设为 `1` �?patch 禁用 bQ、Yn 改走 `/esport/pb/proxy`（高�?无插件场景） |

### 信用盘 v4

经 `api.a8.to` 的平博 v4 **已停用**（`/v4.0` → `V4Disabled`）。详见 [client/web/docs/CREDIT_PLATE.md](../../../../../client/web/docs/CREDIT_PLATE.md)。

| 变量 | 说明 |
|------|------|
| `A8_AUTH` | JWT 登录开关；设为 `0` 退回本地 `users.json` |



### platforms.json 示例



```json

"PB": {

  "gateway": "https://www.example.com",

  "token": "{\"x-app-data\":\"...\",\"custid_515\":\"...\",\"v-hucode\":\"...\"}",

  "referer": "https://www.example.com",

  "cookie": "",

  "betName": ".*",

  "games": ["cs2", "valorant", "league-of-legends", "dota-2", "king-of-glory"],

  "provider": "PB",

  "updatedAt": 1779649009487

}

```



`games` �?`game_catalog.json` �?`platforms.PB` 对应�?



## CLI



```bash

cd scripts

npm run account:import-platform -- "<base64>" --sync-store

npm run pb:odds

npm run pb:match -- 1631272511

npm run pb:balance

```



## �?A8 对齐



| �?| A8 bundle | 本地（默认） |

|----|-----------|--------------|

| 凭证采集 | 插件 GetConfig �?data | 同上，手动粘�?�?import-platform |

| 赔率采集 | `bQ` �?euro/odds | 浏览�?`packages/venue-adapter/pb/` |
| 写入 store | `API_SaveMatch` / `API_SaveBet` | 同上（CollectConfig 开时） |
| 余额/下单 | 插件代发 | 插件（`ENABLE_PB_NODE=1` 时改 proxy，仅 /console/�?|



token 过期后：重新在平博页点插�?�?复制 data �?再执�?`import-platform`�?

