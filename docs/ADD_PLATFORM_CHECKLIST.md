# 新增平台 Checklist（三类）

先选类型，再按对应清单做。**权威开关**在 [`packages/shared/catalog/venue_manifest.json`](../packages/shared/catalog/venue_manifest.json) 的 `collectionMode`（勿再硬编码馆名）。本文下述 `manifest.json` 均指这份唯一维护源；修改后执行 `npm run sync:venue-manifest`，同时提交生成的浏览器和 Node 副本。原运行路径保留，详见 [第三轮隔离记录](VENUE_MANIFEST_ISOLATION_20261019.md)。

| 类型 | `collectionMode`（示例） | 谁写 `platform_*` | 典型馆 |
|------|--------------------------|-------------------|--------|
| **A. browser** | `http_mqtt` / `http_ws` / `http_poll` / `parse_ws` / `aggregator_ws` | 浏览器 `SaveMatch` / `SaveBet` | OB、RAY、IA、PB、SABA… |
| **B. plugin** | `plugin_http` / `plugin_graphql_ws` / `plugin_http_ws` | 通常仍浏览器 Save*（经扩展代发 HTTP/WS） | HG、Stake、Dex、Limitless |
| **C. vps-house** | **`vps_http_ws`** | **仅 VPS collector**；浏览器 Save* 被门控拒绝 | Polymarket、PredictFun（SXBet 已暂停，模式仍同） |

辅助判定：

- `isVpsOwnedPlatformCollect(id)` / `browserSaveMatchPlatformIds()` — [`registry/meta.ts`](../packages/venue-adapter/registry/meta.ts)（前端）与 [`registry/feeds.js`](../packages/venue-adapter/registry/feeds.js)（后端）
- `pluginOnly: true` — UI/采集偏扩展；**不等于** VPS 写库（PM/PF 同时 `pluginOnly` + `vps_http_ws`）

合场唯一写路径已冻结为 esport 内嵌 composer；新馆只要进 `platform_*`，不必改 matcher writer。

---

## 公共步骤（三类都要）

1. **`PlatformId`**：[`packages/api-contract`](../packages/api-contract/src/schemas.ts)（zod enum）+ 相关 TS 导出；`client/web` 经 `@changmen/api-contract` 使用。
2. **共享主资产 `venue_manifest.json`**：`id` / `dir` / `collect` / `bet` / `collectionMode` / `collectionDesc` / `implementation`；VPS 馆必须 `vps_http_ws`。执行 `npm run sync:venue-manifest` 后运行 `npm run check:venue-manifest`；不要手改生成副本。
3. **`registry/adapters.ts`**：挂上 `PlatformAdapter`（即使 VPS 馆也要有报价/下单 adapter）。
4. **`npm run sync:exports --workspace=@changmen/venue-adapter`**（若新增可 import 子路径）。
5. **UI**：采集开关 / 账号卡通常随 `ALL_PLATFORMS` 出现；确认 CollectConfig 对 VPS 馆不提供「浏览器 Save*」错觉（已走 `browserSaveMatchPlatformIds`）。
6. **边界**：遵守 [TEAM_BOUNDARIES.md](./TEAM_BOUNDARIES.md)；浏览器不得 import `@changmen/db`。

**不要再做的过时步骤**

- 手改 `runtime/collectors.ts` / `providers.ts` 逐馆注册（已由 `buildCollectorFactories()` + registry 驱动；只需进 `PLATFORM_ADAPTERS`）。
- 假设「每个新馆都必须写 `platform_sync.syncXxx`」——仅当需要启动时往 `platforms.json` 灌采集凭证时才加。
- 在 `api/match.ts` / `collectStore` / `store.js` 再硬编码馆名字符串（用 manifest / `isVpsOwned*`）。
- 为 PM/PF 在 venue-adapter 再镜像一份 discovery `parse`（discovery 权威在 `server/collectors/*/parse.js`）。

---

## A. browser（浏览器采集 + Save*）

适用：传统电竞馆，浏览器连场馆 HTTP/WS，周期性 `API_SaveMatch` / `API_SaveBet`。

| # | 触点 | 说明 |
|---|------|------|
| A1 | `packages/venue-adapter/{dir}/` | `collect.ts` + `bet.ts` + `index.ts`（`PlatformAdapter`） |
| A2 | `manifest.json` | `collect: true`，`collectionMode` ≠ `vps_http_ws` |
| A3 | 可选 `devtools/platform-probes/{dir}/` | Node 探针 / 会话；经 `requirePlatform`；**非**主链路必需 |
| A4 | `platform_sync.js` | **仅当**要有 trial/env 默认凭证写入 `platforms.json` 时加 `syncXxx*` 并挂 `ensurePlatformCredentials` |
| A5 | HTTP 代理白名单 | 若走 backend relay：`HTTP_RELAY_ALLOWED_HOSTS` / 各馆 proxy 模块 |
| A6 | 合场 | 确认 `server/match/identity` / catalog 有该馆盘口规则；队名映射按需 |
| A7 | 测 | adapter 冒烟 / 馆专项测；`npm run check:boundaries` |

参考：OB（`http_mqtt`）、RAY（`http_ws`）。

---

## B. plugin（Chrome 扩展代发）

适用：浏览器页面无法直连或需标签页身份（Stake GraphQL、部分 HG/Dex/Limitless）。

在 **A 的基础上**追加：

| # | 触点 | 说明 |
|---|------|------|
| B1 | `chrome-extension/` | content/background 对该站的代发、`setTab`、凭证采集（若需要） |
| B2 | `manifest.json` | `collectionMode` 用 `plugin_*`；常设 `pluginOnly: true` |
| B3 | 前端 bridge | `client/web` 经扩展协议发 HTTP/WS（对齐 A8 `Zn`） |
| B4 | 打包 | 扩展版本 / `pack`；生产 zip 路径按现网流程 |
| B5 | **不要**误标 `vps_http_ws` | 除非 discovery 也改 VPS 独占（那就走 C） |

参考：Stake（`plugin_graphql_ws`）、Limitless（`plugin_http_ws`）。

---

## C. vps-house（VPS discovery + 浏览器报价 + 可选 house）

适用：预测市场等——**列表/盘口映射由 VPS 写库**，浏览器只做 Index → Market WS → `fo` 与下单。

| # | 触点 | 说明 |
|---|------|------|
| C1 | `manifest.json` | **`collectionMode: "vps_http_ws"`**；`collect: true` 表示「产品上有采集」，不是浏览器 Save* |
| C2 | `server/collectors/{name}/` | 新 workspace：discovery parse（权威）、写 `platform_*` + MarketIndex；README 写清权威在 collector |
| C3 | `deploy/ecosystem.config.cjs` | 注册 PM2 进程；生产默认栈文档同步 [PRODUCTION_DEPLOYMENT.md](../PRODUCTION_DEPLOYMENT.md) |
| C4 | 浏览器 adapter | **只留报价/下单工具**；禁止再维护 discovery 映射镜像 |
| C5 | Save* 门控 | 无需改代码：manifest 为 `vps_http_ws` 后 `isVpsOwned*` 自动挡浏览器 Save*（前后端） |
| C6 | `.env` | collector / house 密钥（如 `PREDICT_FUN_API_KEY`）；**不要**指望 `platform_sync`  alone |
| C7 | house / 代下 | backend `integrations/` 或既有 PM/PF 卖出路径；不在 `PlatformProvider` 里硬塞资金语义时保持与现网一致 |
| C8 | WS hub | 若行情扇出重：独立 `*-market-hub`（参考 PM/PF hub），勿拖死 `changmen-esport` |
| C9 | 合场字段 | 若有 MarketID 等扩展，走 Sources 投影（参见 PF MarketID）；GetMatchs 契约另见 W7 |
| C10 | 测 | collector 单测 + 门控测（`meta.browserSave.test` / `match.vpsGate.test`） |

参考：[`server/collectors/README.md`](../server/collectors/README.md)、Polymarket / PredictFun / SXBet manifest 条目。

---

## 选型速查

```text
要浏览器自己 SaveMatch/SaveBet？
  ├─ 是，且需扩展代发 ──────────► B. plugin
  ├─ 是，页面可直连/经 relay ───► A. browser
  └─ 否，VPS 写 platform_* ─────► C. vps-house
         （浏览器仍可有 fo / 下单 adapter）
```

---

## 相关文档

- 适配器包：[packages/venue-adapter/README.md](../packages/venue-adapter/README.md)
- 采集 daemon：[server/collectors/README.md](../server/collectors/README.md)
- 团队边界：[docs/TEAM_BOUNDARIES.md](./TEAM_BOUNDARIES.md)
- 前端结构：[client/web/src/ARCHITECTURE.md](../client/web/src/ARCHITECTURE.md)
- 存储与 VPS 写库：[docs/DATA_STORAGE.md](./DATA_STORAGE.md)
