# @changmen/arb-core

电竞/体育套利 **纯逻辑** 包：选腿、隐含利润、机会扫描、状态 diff。无 Pinia、Vue、HTTP。

## 使用方

| 包 | 典型 import |
|----|-------------|
| `client/web` | `@changmen/arb-core`、`@changmen/arb-core/opportunity/detect` |
| 主控台棒球/足球 Tab（后期套利） | 同上（moneyline 套利 MVP） |

## 目录

| 路径 | 内容 |
|------|------|
| `src/arbitrage/` | `pickArbLegs`、`arbStakeMath`、`polymarketArbPrecheck` |
| `src/opportunity/` | `detectOpportunities`、`diffOpportunities`、类型 |
| `src/providerKeys.ts` | 套利检测平台列表收口 |

## 边界

- **依赖** `@changmen/client-core`（`ViewMatch`、`UserConfig`、`BetOption` 等）
- **不** import `client/web`、`stores`、`venue-adapter`
- **不**含 `syncArbRuntime`（Vue watch + marketWatch 留在 web `extensions/arbOpportunity`）

相关：[docs/TEAM_BOUNDARIES.md](../../../docs/TEAM_BOUNDARIES.md)
