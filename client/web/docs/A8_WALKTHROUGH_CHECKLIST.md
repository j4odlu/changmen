# A8 走查清单（changmen `/`）

> 历史记录：损坏文字依据 Git `906054c1982e`（`client/web/docs/A8_WALKTHROUGH_CHECKLIST.md`）恢复，保留后续有效更新。原日期及勾选项表示当时状态；当前入口与规则以仓库 `AGENTS.md` 和 `LOCAL_DEV.md` 为准。

开发地址：`http://localhost:5274/`（Windows）或 `5174`（其它）  
联调/生产：`http://localhost:3700/`（Win）或 `3456`（backend 同源托管 Vue）

对照基线：**只读** `A8/index0706.js`（或 A8 原版环境 Network）。changmen 无 `/console/` 入口（`/console/*` → 301 `/`）。

登录建议：**TJ01** / 配置密码（与 `a8_constants.js` 一致），便于平博 v4 与初赔数据一致。

**逐步操作说明**（点哪里、看什么 Network）：[A8_WALKTHROUGH_SCRIPT.md](./A8_WALKTHROUGH_SCRIPT.md)

---

## 0. 启动

- [ ] `BAT\dev-esport.bat`（Win: 3700+5274 / 其它: 3456+5174；matcher 随 backend 内嵌）

自动化（无需浏览器）：

```bash
cd changmen/client/web
npm run test        # 当前前端单测
npm run test:v4     # 平博 v4 两步（需 3456）
npm run build
```

---

## 1. 登录

| 项 | 通过 |
|----|------|
| 背景图、`slogo`、`loginbox` 布局 | |
| 无多余「登录」标题 | |
| 错误提示样式（`.login-error`） | |
| 登录后进主界面，侧栏用户信息 | |

---

## 2. 主界面

| 项 | 通过 |
|----|------|
| 左 260px 侧栏 + 顶栏账号条 + 版本角标 | |
| 版本角标：显示扩展版本；有更新时 `.new` + 可下载 zip | |
| 账号卡：平台图标、工具条 Font Awesome 图标 | |
| 比赛列表：无赛时空白（无「加载中」条） | |
| BetRow：初赔行 `0.000` 或数值；双击手动下单 prompt | |
| 限红弹窗、创建补单弹窗 | |

---

## 2.1 多运动 Tab 回归（只读冻结后）

| 项 | 通过 |
|----|------|
| 主界面有电竞 / 棒球 / 足球切换 | |
| 切到棒球/足球能出列表或明确错误（非假空） | |
| 切走电竞后套利主循环仍跑（Tab ≠ mainBetLoop） | |

---

## 3. 用户中心（11 Tab）

对每个 Tab 勾选「结构/字段/按钮与旧版一致」：

| Tab | 通过 |
|-----|------|
| 排行榜 | |
| 修改密码（TOTP 为增强，可接受差异） | |
| 消息通知 | |
| 代理配置 | |
| 报表查询 | |
| 赛事采集（开关双击「盘」解锁；平博/OB/SABA 信用盘） | |
| 操盘（pub/sub 在线用户） | |
| 跟单 | |
| 聊天室 | |
| 钱包 | |

---

## 4. 账号与资金

| 项 | 通过 |
|----|------|
| 账号编辑：粘贴导入、游戏 fieldset 展开、比例锁定双击「投」 | |
| 充提登记 `MoneyInfoDialog` | |
| 充提流水 `MoneyLogDialog` + 风险标签 | |
| 参数配置 `UserConfigDialog` 保存 | |

---

## 5. 行为（可选，需实盘或测试账号）

| 项 | 通过 |
|----|------|
| 开启自动投注后主循环跑起来 | |
| Network：`Client_GetMatchs` ~30s | |
| Network：`Client_GetMatchDefaultOdds` ~10min | |
| WinRate 排序、补单阈值、anyOdds 重试 | |
| 平博体育：v4 login + game/play/Login + 确认弹窗 | |

---

## 6. 已知可接受差异

- 修改密码：新版为 TOTP（旧版验证码区多为占位）
- HG：**无电竞赔率列表**；启用采集开关时会轮询 HG 账号余额（见 `client/packages/venue-browser/adapter/hg/collect.ts`）
- XBet：仅采集/比分，不可下注（与 bundle 一致）
- Stake：依赖 Chrome 扩展 + stake.com 标签页（见走查脚本 §5.3）
- IM 角标图 `Dv2UbQNP.png`：需部署到 `/esport2/assets/`（与 backend 静态同源）

---

## 6.1 已对齐项（走查若仍出现请当回归）

- 主列表无红色 `app-hint` 错误条
- 操盘 Tab 无「暂无在线用户」
- 钱包：TronWeb 创建地址 + 刷新链上余额
- 自动投注：`allowSameBet`、账号级 `profit`、`Client_SaveOrder` 分组 `saveOrders`

---

## 7. OB 模式 P（A8 Parity，可选）

启动：`BAT\dev-esport.bat`（matcher 内嵌）+ 插件 build。

| 项 | 通过 |
|----|------|
| 用户中心双击「盘」解锁 → 开启 OB 回传 | |
| Network：`API_SaveMatch?OB` + `API_SaveBet?OB`（约 30s 周期） | |
| 关 OB 开关后无 SaveMatch/SaveBet，BetRow 赔率仍变 | |
| WS：浏览器直连 OB MQTT（`wss://…`，非本机 `/esport/ws/OB`） | |
| `npm run test:ob`（app 目录）离线 PASS | |
| `ESPORT_TEST_BASE=http://127.0.0.1:3456 npm run test:ob-live` 只读 PASS | |
| 粘贴 OB 账号 → 双击 BetRow 下单（需有效 token） | |

逐步操作：[A8_WALKTHROUGH_SCRIPT.md](./A8_WALKTHROUGH_SCRIPT.md) §5.4

---

## 记录

| 日期 | 走查人 | 备注 |
|------|--------|------|
| 2026-07-15 | agent | 登录页：背景/`slogo`/loginbox/无多余标题 OK；`npm run typecheck:frontend` PASS；多运动冻结验收见 `docs/ARB_MULTI_SPORT.md`。未登录全站走查（密码自动填入被拒）→ 余下勾选由本机补完。 |
| | | |
