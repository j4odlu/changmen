# PB

| 目录 | 用途 |
|------|------|
| 根目录 `collect.ts` / `bet.ts` / `transport.ts` 等 | **浏览器采集与下注**（主链路） |
| `auth.ts` | 会话类型检测（515 / 后缀数字 / plain）+ 鉴权头；**从 token 键名判定**，见下 |
| `shared/` | 浏览器 SaveBet / euro·odds 解析（`collect.ts`、`markets.ts` 共用） |
| `devtools/platform-probes/pb/` | 可选 Node 探针 CLI |

生产代码在平台根目录，不在 `frontend/`。

**会话类型 / token 判定 / 与 A8 `k0` 差异**：见 [`client/web/docs/platforms/PB.md`](../../../client/web/docs/platforms/PB.md)「会话类型（从 token 判定）」。

**采集调度：** 默认 **A8**（仅 live 5s 写 `fo`）。用户中心「赛事采集」→「PB changmen 扩展」开启后：live+prematch 双循环、赛前也写 fo；影子旁显见 `wsShadowOdds` / `PB_WS.md`。

```bat
cd changmen/devtools/platform-probes
npm run pb:odds
npm run pb:balance
```

详见 `devtools/platform-probes/pb/docs/README.md`。
