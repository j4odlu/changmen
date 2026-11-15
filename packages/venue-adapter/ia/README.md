# IA

浏览器主链路：`packages/venue-adapter/ia/`（采集 `wQe` + 下注 `CYe`）。

| 文件 | 用途 |
|------|------|
| `a8Collect.ts` | A8 内联采集对象 `t` |
| `collect.ts` / `transport.ts` / `realtime.ts` / `messages.ts` / `markets.ts` | 采集 |
| `bet_transport.ts` | A8 `mr.post` 路由（Zn / PROXY） |
| `bet.ts` | `iaProvider`（CYe） |
| `shared/` | 盘口解析、SaveBet 行构建 |

**文档**：[client/web/docs/platforms/IA.md](../../../client/web/docs/platforms/IA.md)

探针 CLI：

```bat
cd changmen/devtools/platform-probes
npm run ia:events
```

详见 `devtools/platform-probes/ia/docs/README.md`。
