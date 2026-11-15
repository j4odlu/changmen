# client/web — 脱离 ui_bundle 迁移对照

> 历史记录：损坏文字依据 Git `906054c1982e`（`client/web/MIGRATION.md`）恢复，保留后续有效更新。原日期及勾选项表示当时状态；当前入口与规则以仓库 `AGENTS.md` 和 `LOCAL_DEV.md` 为准。

新控制台源码：`client/web/`  
生产访问：`http://localhost:3456/`（需先 `npm run app:build`）

> **已下线**：旧 bundle 路径 `/console/`（`PATCH_CONSOLE=1`）与目录 `client/web/console/` 不再作为入口；backend 对 `/console/*` 返回 301 → `/`。

开发：`npm run app:dev` → Vite（Win `http://localhost:5274/` / 其它 `:5174`）

## 阶段进度

| 阶段 | 状态 | 说明 |
|------|------|------|
| 0 地基 | **完成** | 脚手架、全量 API、登录、比赛列表预览、`/` 托管 |
| 1 数据层 | **完成** | fo + Vg + OB/RAY 采集 + A8 主区 UI |
| 2 用户 | **完成** | USERCONFIG、CollectConfig 全平台、BetTarget、Setting 弹窗 |
| 3 账号 | **完成** | Io + AccountBar、充提登记、余额刷新 |
| 4 订单 | **完成** | OrderView + LoseOrder 补单队列 + 后端 GetOrderList |
| 5 下单 | **完成** | checkBetting/betting + OB/RAY provider + 自动投注循环 |
| 6 多平台采集 | **完成** | 11 平台采集器；HG 无赔率流，启用时轮询余额 |
| 7 下线 bundle | **完成** | 唯一入口 `/`；`/console/*` 301 重定向 |
| 8 消息推送 | **完成** | `messageStore`（Gi）：Telegram/报表/补单发布 + 采集错误通知 |
| 9 下单扩展 | **完成** | TF / IA 客户端 Provider |
| 10 多平台下单 | **完成** | IM / IMT / SABA / PB；Stake 插件占位 |
| 11 皇冠跟单 | **完成** | `hgProvider` + `hgFollowLoop` |
| 12 UI 复刻 | **基本完成** | A8 CSS + Font Awesome 图标；见下方文档 |
| 13 投注行为对齐 | **完成** | WinRate、初赔/补单阈值、anyOdds、lastOdds、noSameProvider |
| 15 联调加固 | **完成** | PB lineId、IM gameId、SABA 会话、HG 跟单通知 |
| 平博信用盘 v4 | **完成** | login + `game/play/Login` E2E：`npm run test:v4` |

## 文档与验收

**对照基线**：控制台 `/` 以 `A8/` 为准。索引见 [docs/README.md](./docs/README.md)。

| 文档 | 用途 |
|------|------|
| [docs/README.md](./docs/README.md) | 文档索引、基线说明、已删过期文件列表 |
| [docs/A8_UI_PARITY_GAPS.md](./docs/A8_UI_PARITY_GAPS.md) | UI/行为缺口清单 |
| [docs/A8_NEXT_STEPS.md](./docs/A8_NEXT_STEPS.md) | 待办与验收命令 |
| [docs/A8_WALKTHROUGH_CHECKLIST.md](./docs/A8_WALKTHROUGH_CHECKLIST.md) | 同屏走查勾选表 |
| [docs/A8_REPLICATE_8_PLATFORMS.md](./docs/A8_REPLICATE_8_PLATFORMS.md) | OB/IM/TF/PB/RAY/IMT/STAKE/IA 采集与下注复刻清单 |
| [docs/A8_WALKTHROUGH_SCRIPT.md](./docs/A8_WALKTHROUGH_SCRIPT.md) | 同屏走查逐步操作（点哪里、看什么 API） |
| [docs/CREDIT_PLATE.md](./docs/CREDIT_PLATE.md) | 平博 v4 信用盘 |
| [docs/_A8_VS_CHANGMEN_AUDIT.json](./docs/_A8_VS_CHANGMEN_AUDIT.json) | 2.0.1 代码级缺口（只读审计） |
| [docs/A8_PARITY_AUDIT_MACHINE.json](./docs/A8_PARITY_AUDIT_MACHINE.json) | 历史机器审计产物（生成脚本已下线） |

```bash
cd changmen/client/web
npm test          # 当前前端单测；历史 audit:a8 已下线
npm run test:v4    # 平博 v4（backend 3456）
npm run build
```

## 平博信用盘（`/`）

与主站 `Client_Login` 分离：v4 使用 **A8 账号 + `a123456`**。本地 dev 默认 **`/v4.0/`** 代理到 `server/backend`。

详细说明：[docs/CREDIT_PLATE.md](./docs/CREDIT_PLATE.md)

## A8 bundle 模块 → 新代码目录

| A8 (minified) | 新路径 | 说明 |
|---------------|--------|------|
| `fo` | `src/stores/oddsStore.ts` | 实时赔率缓存 |
| `Vg` | `src/stores/matchStore.ts` | 比赛树、BetTarget、初赔 10min 轮询 |
| `Xn` | `src/stores/userStore.ts` | 登录、用户配置、BetTarget setting |
| `Io` | `src/stores/accountStore.ts` | 多平台账号 |
| `Io` (orders) | `src/stores/orderStore.ts` | 订单列表、Link 分组、今日盈亏 |
| `Tf` | `src/stores/collectStore.ts` | CollectConfig |
| `jb` | `src/stores/loseOrderStore.ts` | 补单队列 |
| `vf` / `vYe` / `bYe` | `client/packages/venue-browser/adapter/{ob,ray}/bet.ts` | OB/RAY 下单 provider |
| `wYe` / `EYe` | `tfProvider` / `iaProvider` | TF/IA 下单 |
| `AZe` … `nJe` | im / imt / saba / pb / stake | 多平台下单 |
| `qZe` / `SQ` | `hgProvider` / `hg/followLoop.ts` | 皇冠跟单 |
| 自动投注循环 | `src/stores/bettingStore.ts` | WinRate、anyOdds、补单阈值等 |
| `Gi` | `src/stores/messageStore.ts` | 推送/Telegram |
| `NMe` … `PQ` | `client/packages/venue-browser/adapter/*/*/` | 各平台采集 |
| `SQ` | `hg/index.ts` + `hg/followLoop.ts` | HG 余额轮询 + 跟单（非 saveMatch） |
| `LoginView` | `src/views/LoginView.vue` | |
| `HomeView` | `src/views/HomeView.vue` | |
| `ExtensionsView` | `src/components/layout/ExtensionsBadge.vue` | 版本角标 |
| `UserInfoView` | `UserInfoPanel.vue` | |
| `AccountView` | `AccountBar.vue` + `AccountCard.vue` | |
| `OrderView` / `LoseOrderView` | `order/*.vue` | |
| `Vt` / `_r` | `src/api/esport.ts` | Client_* / API_* |
| UserCollectView 平博 | `src/api/v4.ts` + `CollectConfigPanel.vue` | `enterCreditPlate` |

样式：`src/styles/a8.css`（extract）、`a8-am-icon.css`、`a8-fallback.css`、`app.css`、`user-diag.css`

## API 封装（阶段 0 已覆盖 router.js 全部 action）

见 `client/web/src/api/esport.ts`。

## 对照测试

- 默认：backend 同源或 Vite dev（端口见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)）
- 当前服务入口与端口见根目录 `LOCAL_DEV.md`。

**行为不一致时**：以 `A8/index0706.js` 为准 grep 后 port。
同屏走查用 [A8_WALKTHROUGH_CHECKLIST.md](./docs/A8_WALKTHROUGH_CHECKLIST.md)。
