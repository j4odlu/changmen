# IM 平台

A8 采集模式�?*聚合 WebSocket**（公�?Socket.IO 频道 `IM`）�?

## 数据�?

```text
A8 聚合 Socket.IO �?join room IM �?chat message channel=IM
赔率 key：{betId}:1（主�?/ {betId}:2（客�?
```

生产实现：`../../collect.ts` + 包级 `shared/socket/`�?

`ENABLE_IM` 为历�?Dashboard 开关，已删除。在 web 控制�?**CollectConfig** 中启�?IM 采集即可�?

## 说明

IM 无独立源�?HTTP 比赛列表，比赛与赔率�?A8 聚合层推送。需 A8 侧已�?IM 账户在跑采集�?
