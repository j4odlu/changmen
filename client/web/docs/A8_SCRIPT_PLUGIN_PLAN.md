# A8 脚本 + 插件架构复刻计划

> 历史记录：损坏文字依据 Git `3dafad69a720`（`client/web/docs/A8_SCRIPT_PLUGIN_PLAN.md`）恢复，保留后续有效更新。原日期及勾选项表示当时状态；当前入口与规则以仓库 `AGENTS.md` 和 `LOCAL_DEV.md` 为准。

对照基线：`A8/index0706.js` + `A8/A8chromeplug/2.0.149`。
changmen 实现：`client/web` + `client/packages/venue-browser/adapter/{platform}/` + `client/chrome-extension` + `@/chrome-plugin/bridge.ts`（A8 `Zn`）。

最后更新：2026-06-11

---

## 目标架构

```
浏览器托管页（脚本）          Chrome 插件（Zn）
├── client/platform-adapter 采集     ├── GET/POST 跨域
├── oddsStore fo              ├── tabId / Stake content
├── collectStore 回传门控     ├── 11 站凭证浮窗
└── *Provider 下注            └── ModifyHeader UA
         │                              │
         └──────────┬───────────────────┘
                    ▼
         server/backend Client_* / API_*
                    ▼
         server/matcher → client_matches
                    ▼
         Client_GetMatchs（前端只读列表）
```

**Parity 唯一基线**：浏览器 `saveMatch`/`saveBets` + 插件 + matcher → `Client_GetMatchs`。
**已删除**（2026-06）：Node FeedHub、`ESPORT_BRIDGE`、服务端平台 Feed 采集。
**非基线**：[changmen 扩展] matcher、`http-relay` 作 PB 主路径、WS relay 隧道。

生产部署见 [../../../PRODUCTION_DEPLOYMENT.md](../../../PRODUCTION_DEPLOYMENT.md)。

---

## 启动脚本（开发联调）

| 脚本 | 组成 |
|------|------|
| `BAT\dev-esport.bat` | Web 后端 + Vite + matcher（推荐 parity 验收） |
| `BAT\dev-esport.bat` / `BAT\dev-esport.bat` | 日常开发（浏览器 + 插件 + matcher） |

插件准备：

```bat
cd changmen\apps\chrome-extension
npm run build
```

Chrome：加载已解压 `client/chrome-extension`（ID `mogfpjihgoghabicofkbcmcidlcoofee`）。

---

## 三模式采集

| 模式 | 平台 | 脚本 | 插件 |
|------|------|------|------|
| A 场馆 HTTP/WS | OB、RAY、TF、IA、IMT | 直连 / 后端 WS relay | 凭证浮窗（可选） |
| B A8 Socket | IM、XBet、Stake 实时 | `@venue/shared/socket/*` | Stake 需 tabId |
| C 插件 HTTP | PB、Stake GraphQL | `a8PluginGet/Post` | **必须** |

CollectConfig：只门控 `saveMatch`/`saveBets`，**不**停采集器。

---

## 进度

### 已完成

| 项 | 说明 |
|----|------|
| `client/packages/venue-browser/adapter` 迁移 | 11 平台 collect/bet + registry |
| 插件协议 | `bridge.ts` = Zn |
| 开发脚本 | `BAT\dev-esport.bat`（matcher 随 backend 内嵌） |
| 架构冻结 M1 | 删除 FeedHub；[PRODUCTION_DEPLOYMENT.md](../../../PRODUCTION_DEPLOYMENT.md) |
| PB fail-fast | 无扩展且无 SOCKS → `PB_PLUGIN_REQUIRED_MSG` |
| Stake 提示 | 无扩展 / 无 tabId → `notifyCollectError` |
| IA 空 token | `ia/backend/collect_credentials.js` + `Client_GetCollectPlatform` |

### 进行中（阶段 2 联调）

按顺序 Mode P 走查：[A8_WALKTHROUGH_CHECKLIST.md](./A8_WALKTHROUGH_CHECKLIST.md)

1. OB → 2. IM → 3. RAY → 4. TF → 5. IMT → 6. IA → 7. PB → 8. STAKE

每平台 Network 验收见 [A8_REPLICATE_8_PLATFORMS.md](./A8_REPLICATE_8_PLATFORMS.md)。

### 待办

| 优先级 | 任务 |
|--------|------|
| P1 | 8 平台 Mode P 实机 E2E（需账号/扩展） |
| P1 | `A8_WALKTHROUGH_CHECKLIST` B4 同屏 UI 走查 |
| P2 | 生产首次部署（域名、`db push`、matcher 进程）— 见 PRODUCTION_DEPLOYMENT |
| P2 | 文档：`A8_COMPARE_ALL_PLATFORMS` 路径改 `client/platform-adapter` |
| P3 | HG 跟单（无 saveMatch，非 8 平台 parity 核心） |

---

## 代码索引

| 能力 | 路径 |
|------|------|
| 插件桥 | `src/chrome-plugin/bridge.ts` |
| 采集注册 | `src/runtime/collectors.ts` → `@platform/registry` |
| A8 Socket | `client/packages/venue-browser/adapter/shared/socket/hub.ts` |
| 平台实现 | `client/packages/venue-browser/adapter/{ob,im,ray,...}/` |
| 插件源码 | `client/chrome-extension/src/` |
| Matcher | `server/matcher/matcher.js` |

平台明细：[A8_REPLICATE_8_PLATFORMS.md](./A8_REPLICATE_8_PLATFORMS.md)

---

## 标签约定

| 标签 | 含义 |
|------|------|
| [A8 可证实] | bundle 或抓包直接可见 |
| [changmen 推测] | 从 API 形状反推 |
| [changmen 扩展] | A8 不存在（matcher、http-relay 主路径、WS relay 等） |
