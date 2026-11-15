# client/web 文档索引

最后更新：2026-09-16

## 项目共识

**changmen 后端不是 A8 官方服务端的移植**，而是研究 **A8 浏览器前端** bundle 中的 API 名、请求载荷、调用时机 **反推** 出来的**服务端**实现（客户端按 bundle 调用这些 API）。

| 类别 | 说明 |
|------|------|
| **Parity 唯一基线** | A8 前端 bundle 可证实行为 +（可选）官方站点 Network |
| **changmen 推测** | `matches.json` / `bets.json` / `client_matchs.json`、`match_merge.js` 合并规则、`API_SaveMatch` 落库细节等——以 **满足 A8 前端同款调用与 GetMatchs 响应形状** 为目标，不声称与 A8 服务端同源码 |
| **changmen 扩展** | matcher、WS relay、`http-relay`、Electron 壳等——**不在** A8 bundle 中 |
| **CollectConfig** | A8：`collect: new Map()`，全关，仅 `Client_GetData("CollectConfig")` 回填；changmen 已对齐（空库 seed `collect: []`，前端无 fallback） |

**架构**：客户端采集 + 服务端聚合。开发用 `BAT\dev.bat parity` / `BAT\dev.bat`；生产见 [../../../../../PRODUCTION_DEPLOYMENT.md](../../../PRODUCTION_DEPLOYMENT.md)。

**已删除（2026-06）**：Node FeedHub、`ESPORT_BRIDGE`、服务端直连平台 Feed。勿在文档中再写「模式 D / 双轨」。

脚本+插件总览：[A8_SCRIPT_PLUGIN_PLAN.md](./A8_SCRIPT_PLUGIN_PLAN.md)

OB 离线验收（`app/` 目录）：`npm run test:ob`（GetMatchs 形态 + obProvider 契约）。  
含 live：`ESPORT_TEST_BASE=http://127.0.0.1:3456 npm run test:ob:all`

详见 [changmen/readme.md](../../../readme.md#项目共识)、OB 专项 [A8_OB_REPLICATE_PLAN.md](./A8_OB_REPLICATE_PLAN.md)。

---

## 对照基线（必读）

| 用途 | 基线 | 说明 |
|------|------|------|
| **控制台 `/` 行为与 UI** | `A8/index0706.js` | 官方 A8 前端 minified bundle（仓库根 gitignore；见 [LOCAL_DEV.md](../../../LOCAL_DEV.md)） |
| **A8 Chrome 插件** | `A8/A8插件/` | manifest 2.0.149；对照 `chrome-extension/` |
| **changmen 后端 API** | 由上述前端 **反推** | **不是** A8 服务端源码；见 [项目共识](#项目共识) |
| **机器审计** | [`A8_PARITY_AUDIT_MACHINE.json`](./A8_PARITY_AUDIT_MACHINE.json) | 历史快照（CSS/View 映射）；`audit:a8` 脚本已下线，走查见 WALKTHROUGH |

代码级缺口（只读审计）：[`_A8_VS_CHANGMEN_AUDIT.json`](./_A8_VS_CHANGMEN_AUDIT.json)  
机器审计输出：[`A8_PARITY_AUDIT_MACHINE.json`](./A8_PARITY_AUDIT_MACHINE.json)

---

## 主文档（维护中）

| 文档 | 用途 |
|------|------|
| **[A8_PARITY_REGISTRY.md](./A8_PARITY_REGISTRY.md)** | **对齐总览**：配置/时序/投注/UI/平台/扩展/缺口 集中索引 |
| [../MIGRATION.md](../MIGRATION.md) | 脱离 bundle 阶段表、模块映射 |
| [A8_NEXT_STEPS.md](./A8_NEXT_STEPS.md) | 待办与验收命令 |
| [A8_UI_PARITY_GAPS.md](./A8_UI_PARITY_GAPS.md) | UI/行为未对齐项（细节与 pixel diff） |
| [A8_SCRIPT_PLUGIN_PLAN.md](./A8_SCRIPT_PLUGIN_PLAN.md) | **脚本+插件架构**、Mode P 启动、进度 |
| [A8_REPLICATE_8_PLATFORMS.md](./A8_REPLICATE_8_PLATFORMS.md) | 8 平台采集/下注/回传开关语义 |
| [A8_OB_REPLICATE_PLAN.md](./A8_OB_REPLICATE_PLAN.md) | **OB 复刻计划**（A8 前端基线 + changmen 推测/扩展标注） |
| [A8_WALKTHROUGH_CHECKLIST.md](./A8_WALKTHROUGH_CHECKLIST.md) | 同屏走查勾选 |
| [A8_WALKTHROUGH_SCRIPT.md](./A8_WALKTHROUGH_SCRIPT.md) | 走查逐步操作 |
| [A8_COLLECT_VIEW_PIXEL_PARITY.md](./A8_COLLECT_VIEW_PIXEL_PARITY.md) | 赛事采集 Tab 像素与「回传」语义 |
| [CREDIT_PLATE.md](./CREDIT_PLATE.md) | 平博信用盘 v4 |
| [QUICK_START_FILES.md](./QUICK_START_FILES.md) | 5 分钟按角色找源码 |

仓库根：[../README.md](../README.md)

---

## 平台与采集（`packages/venue-adapter/`）

| 文档 | 用途 |
|------|------|
| [platforms/A8.md](./platforms/A8.md) | A8 Socket 聚合（IM/XBet/Stake 实时） |
| [platforms/A8_COMPARE_ALL_PLATFORMS.md](./platforms/A8_COMPARE_ALL_PLATFORMS.md) | 全平台 A8 vs changmen |
| `platforms/OB.md` / `RAY.md` / … | 各平台运维（**电竞 OB**） |
| **[platforms/OB_SPORT.md](./platforms/OB_SPORT.md)** | **熊猫体育试玩**：HTTP PB + `yewuws2` 命令/频率；足球页对齐 |

---

## 已删除的过期产物

| 文件 | 原因 |
|------|------|
| `_A8_GAP_AUDIT_FROM_CODE.json` | 一次性对比 vendor vs 2.0.1，无引用；由 `_A8_VS_CHANGMEN_AUDIT.json` 取代 |
| `_A8_VIEW_MARKER_GAPS.json` | 一次性 DOM 标记审计，无引用；缺口已写入 `A8_UI_PARITY_GAPS.md` |
| `docs/platforms/OB_FRONTEND_PLAN.md`（若存在） | 未审批的实施计划，非现状说明；未勾选项非当前阻塞 |

---

## 术语

用户中心 **赛事采集** 开关 = 是否调用 `Client_SaveMatch` / `Client_SaveBets`（**回传**），不是是否连接场馆或停止 `oddsStore` 更新。
