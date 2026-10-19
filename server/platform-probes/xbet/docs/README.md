# XBet 平台

A8 采集模式�?*聚合 WebSocket**（频�?`XBet` / `XBet:Score`）�?

## 数据�?

```text
A8 聚合 Socket.IO �?join room XBet
赔率 key：{betId}:1（主�?/ {betId}:3（客�?
比分：channel XBet:Score
```

生产实现：`../../collect.ts` + 包级 `shared/socket/`�?

`ENABLE_XBET` 为历�?Dashboard 开关，已删除。在 web 控制�?**CollectConfig** 中启�?XBet 采集即可�?

仅采集、无下注（manifest `bet: false`）�?
