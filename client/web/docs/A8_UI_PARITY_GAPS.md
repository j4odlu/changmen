# A8 UI / 行为复刻缺口清单

> 历史记录：损坏文字依据 Git `7a6d34c3780b`（`client/web/docs/A8_UI_PARITY_GAPS.md`）恢复，保留后续有效更新。原日期及勾选项表示当时状态；当前入口与规则以仓库 `AGENTS.md` 和 `LOCAL_DEV.md` 为准。

对照基线：`A8/index0706.js` + `index.css`。
本清单只列**尚未对齐**或**仅部分对齐**项；数据层/采集/下单见 `MIGRATION.md` 与各 `docs/platforms/*`。

文档索引：[README.md](./README.md)

最后更新：2026-06-16

> **全量对齐索引**（含已对齐 + 扩展 + 配置项）：见 [A8_PARITY_REGISTRY.md](./A8_PARITY_REGISTRY.md)

---

## 图例

| 符号 | 含义 |
|------|------|
| UI | 结构/样式/组件与 bundle 不一致 |
| 行为 | 交互或业务逻辑与 bundle 不一致 |
| 数据 | 后端或接口导致界面无数据 |
| 暂缓 | 已知差异，刻意保留（本地简化） |

---

## 一、主界面（HomeView）

| 区域 | bundle 组件 | 状态 | 说明 |
|------|-------------|------|------|
| 整体布局 | `el-aside` + `el-header` + `el-main` | 已对齐 | 阶段 1 |
| 比赛卡片 | `.match` / `.bet-title` / `BetRow` | 已对齐 | 阶段 2 |
| 账号横条 | `AccountView` (`bDe`) | 已对齐 | `el-button` + `el-tag` + `el-progress` + `el-tooltip` |
| 版本角标 | `ExtensionsView` (`GHe`) | 基本对齐 | class `version`/`new`；扩展版本来源略有不同 |
| 侧栏用户区 | `UserInfoView` | 已对齐 | 阶段 1–2 |
| 侧栏订单 | `OrderView` | 已对齐 | `el-date-picker` + `el-select` + 刷新；分组 `Link` 降序 + `groupBy(Link)` 同 bundle |
| 侧栏补单 | `LoseOrderView` | ⚠️ 部分 | DOM/class 同 A8；**侧栏顺序**与 **fieldset scoped 样式**已按 bundle 对齐（2026-06） |
| 限红弹窗 | `LimitDiagView` | 已对齐 | `el-dialog` |
| 创建补单 | `CreateLoseView` | 基本对齐 | `el-dialog` + `el-form` 同 A8；changmen 挂各 `BetRow`（A8 为 HomeView 单例） |
| 初赔行 | `defaultOdds` | 基本对齐 | `default_odds.json` 首次写入 + 快照回退；10min 轮询 |
| 手动双击下单 | `prompt` 金额 | 已对齐 | 前置 `checkBetting` + `accountStore.betting`（含 loading 通知） |

---

## 二、登录

| 项 | 状态 | 说明 |
|----|------|------|
| `container` + `slogo` + `loginbox` + `el-form` | 已对齐 | 阶段 3 |
| 无独立「登录」标题 | 已对齐 | 已去掉自定义 h2 |

---

## 三、用户中心（UserDiagView）

| Tab | bundle | 状态 | 说明 |
|-----|--------|------|------|
| 弹窗壳 | `el-dialog` 880 / `show-close=false` | 已对齐 | 阶段 4 |
| 排行榜 | `UserRankView` | 已对齐 | `rank` + `el-tag` + `el-button-group` |
| 修改密码 | `UserPasswordView` | 部分 | A8 验证码区为占位；本仓库实现 TOTP（**行为增强**） |
| 消息通知 | `UserMessageView` | 已对齐 | `el-form` |
| 代理配置 | `UserProxyView` | 已对齐 | `el-input` prepend |
| 报表查询 | `UserReportView` | 已对齐 | `el-table` + summary |
| 赛事采集 | `UserCollectView` | 已对齐 | 见 `A8_COLLECT_VIEW_PIXEL_PARITY.md` |
| 操盘 | `TradeView` | 已对齐 | GoEasy `USER`/`TRADE` 通道 + `UserDiagTradeTab` |
| 跟单 | `FollowView` | 已对齐 | `el-form` / checkbox-group |
| 聊天室 | `UserChatMessageView` | 已对齐 | `top`/`log`/`filter`/`tags` 布局 |
| 钱包 | `UserWalletView` | 已对齐 | `wallets` + `el-input` prepend |

---

## 四、账号与资金（AccountView 生态）

| 项 | bundle | 状态 | 说明 |
|----|--------|------|------|
| 充提子表单 | `MoneyInfoView` | 已对齐 | `MoneyInfoDialog` → `el-dialog` + Element 表单 |
| 充提列表 | `MoneyView` (`fDe`) | 已对齐 | `MoneyLogDialog` → `el-dialog` + `el-statistic` + `el-table` + `MoneyRiskView` |
| 风险标签 | `MoneyRiskView` | 已对齐 | `MoneyRiskView` + `Client_GetPlayerOrder` 返回 `{ logs, orders }` |
| 账号编辑 | `AccountInfoView` / `bK` | 基本对齐 | `AccountEditDialog` |
| 充提流水列表 | `MoneyLog` 相关 | 基本对齐 | `MoneyLogDialog` |

---

## 五、参数配置（UserConfigView）

| 项 | 状态 | 说明 |
|----|------|------|
| 表单栅格 / fieldset / 保存按钮 | 已对齐 | `UserConfigDialog` |
| 配置项字段 | 已对齐 | 与 `userConfig.ts` 一致 |

---

## 六、自动投注 / 补单（行为，非纯 UI）

| 项 | bundle | 状态 | 说明 |
|----|--------|------|------|
| `betSorting: WinRate` | 有 | 已对齐 | `sortOptionsByWinRate`（`oJe`） |
| `anyOdds` 被拒重试 | 有 | 已对齐 | `retryFailedLeg`（最多 3 轮换平台；阈值 `anyOdds ? anyOddsProfit : makeProfit`） |
| `makeUp_defaultOdds` / `makeUp_odds` | 有 | 已对齐 | `autoBet/makeUp.allowMakeUpForLeg` + `Client_GetDefaultOdds` |
| 账号 `minDefault` / `maxDefault` | 有 | 已对齐 | 主循环与补单选账号 |
| `allowSameBet` / `noSameBet` | 有 | 已对齐 | `pickArbLegs` + `readUsedAccounts`（`BETACCOUNT:` sessionStorage，[A8 可证实]） |
| `noSameProvider` | 有 | 已对齐 | 仅补单 `processLoseOrders`；主循环用 `noSameBet`（bundle 同） |
| 定时开启投注 | 有 | 已对齐 | `bettingStore.tickAutoOpen` |
| `maxBetCount` / `BETCOUNT` | 有 | 已对齐 | `betTiming.passesMaxBetCount` + `incrementBetCount` |
| 拒单检测主循环 | 有 | 已对齐 | `refreshBalance` → tip(Oe) → wait(q) → `updateVenueOrders`；**q<=0 仍弹 tip** |
| 补单拒单复检 | 有 | 已对齐 | `makeUpBetToastSeconds`（Pe）；复检前不调 refreshBalance（A8 jb 同） |
| `checkTimeout` 弹窗 | 有 | 已对齐 | `a8Tip("前置检查超时", …)` |
| 投注中 / 结果通知 | `Io.betting` | 已对齐 | `placeBet`；自动套利 `arbBetToastSeconds`、补单 `makeUpBetToastSeconds`、手动固定 10s |
| `betInterval` | 配置默认 30 | 已对齐 | A8/changmen 均**不参与调度**；主循环 100ms、列表 30s |
| `rateConfig` rate=0 | 保存过滤；运行时当 1 | 已对齐 | `normalizeAccountRateConfig` + `getBetMoney` |
| `rate 9999` 单边 / linkId | A8 无 | 🔶 扩展 | `domain/betting/singleLegRate.ts`；比例 9999 = 单边模式；负 linkId → `gb{ts}` |
| `Pr.tip` 补单/拒单 | 有 | 已对齐 | `a8Notify.a8Tip`（含 `<countdown>`） |
| HG 采集 | `SQ` | 部分 | 无电竞赔率流；启用开关时 60s 刷 HG 账号余额；跟单见 `hgFollowLoop` |
| Stake 下单 | 插件 GraphQL | **已对齐** | `stakeProvider` 完整实现；`pluginOnly` 需 Chrome 扩展 + stake.com 标签页（见 `client/packages/venue-browser/adapter/stake/README.md`） |

---

## 七、建议优先级

详见 [A8_NEXT_STEPS.md](./A8_NEXT_STEPS.md)、[A8_REPLICATE_8_PLATFORMS.md](./A8_REPLICATE_8_PLATFORMS.md)。

1. **P0**：8 平台联调 + 走查表（回传开关语义）；Stake 需实机验证插件 tabId + GraphQL 下单
2. **P1 UI**：同屏 pixel diff（账号编辑、充提、版本角标）
3. **已完成**：初赔/WinRate/补单阈值、`anyOdds` 重试、`lastOdds`、图标、赛事采集 Tab、拒单检测、投注通知
4. **暂缓**：HG 无电竞赔率流（仅余额轮询）

---

## 八、验收方式

```bash
cd changmen/client/web
npm run dev
# http://localhost:5274/（Win）或 :5174
# 生产/联调：backend 同源 http://localhost:3700/（Win）或 :3456/
```

对照基线：`A8/index0706.js`（只读 bundle，非 changmen 路由）。同 changmen 对比：登录页、侧栏用户区、用户中心各 Tab、顶栏账号卡、赛事列表 BetRow、订单区。

历史机器审计见 `docs/A8_PARITY_AUDIT_MACHINE.json`；原 `audit-a8-parity.mjs` 脚本已下线。

---

## 九、2026-05 复审计结论

### 9.1 组件覆盖（结构层）

- bundle 内 **25 个 `*View`** 均已映射到 Vue 组件（`A8_PARITY_AUDIT_MACHINE.json` → `vueMap`，`unmappedViews: []`）。
- `a8.css` 与官方 `index.css` **1816 个选择器一致**（机器审计差异为 0）。
- 审计里 `bundleSemanticClassesMissingInVue` 多为 class 字符串写法差异（如 `balance trx`），不代表 DOM 缺失。

### 9.2 全局样式 / Element Plus 迁移

| 项 | 状态 | 说明 |
|----|------|------|
| `.el-tabs--top { column-reverse }` | **已修** | `a8-fallback.css` 改回 `column`，否则 Tab 在底部 |
| 其它 EP 不兼容规则 | 待观察 | 再出现布局颠倒时优先查 `a8-fallback` |

### 9.3 仍存在的 UI / 视觉差异

**P1 — 资源与图标**

| 区域 | 说明 |
|------|------|
| `am-icon` / `iconfont-base` | **已对齐**：`fontawesome-webfont.woff2` + `a8-am-icon.css`（FA 4.7）；未映射类仍走 `a8-icon-fallback` |
| IM 角标 | 缺图时用蓝底「IM」字（`app.css`） |
| `/esport2/assets/*` | Vite 代理 `/esport2` → 3456；生产需同源静态目录 |

**P2 — Vue 独有或与 A8 不同**

| 区域 | 说明 |
|------|------|
| 主列表无赛事 | 已对齐空列表（仅保留错误提示条） |
| 操盘 Tab | 「暂无在线用户」提示；A8 无 |
| 钱包刷新 | TronGrid 查 TRX/USDT | 已对齐 | `UserDiagWalletTab.refreshBalances` |
| 钱包地址生成 | A8 用 TronWeb | 已对齐 | `tronWallet.generateTronWallet()` |
| 谷歌验证码 | 复刻为动态 TOTP + 可添加；A8 为静态空码（**增强**，非缺口除非要像素级空码） |

**P3 — 建议同屏 pixel diff**

账号编辑、充提弹窗、初赔数据表现、版本角标逻辑、少量 `scoped` 样式（`HomeView` / `UserDiagTradeTab` / `LoginView`）。

### 9.4 勿误判为缺口（与 A8 相同）

- `Select` / `Pick a month` / `Select date and time`：bundle 原文即英文。
- 补单删除、账号注销：`MessageBox.confirm` 与 A8 一致。
- 侧栏统计三列 + 延迟按钮配色：与 `UserInfoView` 一致。

### 9.5 建议下一步（仅 UI）

1. 走查 changmen `/` 的 11 个用户中心 Tab + 主界面关键路径（对照 `A8/.../index.js`）。
2. 同屏 pixel diff：账号编辑、充提弹窗、版本角标。
3. 钱包地址一致：接入 TronWeb 生成（行为改动，影响钱包 Tab 展示）。
