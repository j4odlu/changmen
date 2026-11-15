# PM 测试入口

[changmen 扩展] 此处保留历史目录说明。当前浏览器 PM 测试位于 `client/packages/venue-browser/adapter/polymarket/tests/`；生产实现位于 `client/packages/venue-browser/polymarket/`。旧 `@changmen/venue-adapter` 浏览器运行入口已退役。

从仓库根运行 PM 测试：

```powershell
npm exec --workspace=@changmen/web -- vitest run ../packages/venue-browser/adapter/polymarket/tests
```

行情总线契约：

```powershell
npm exec --workspace=@changmen/web -- vitest run marketQuoteHub.contracts marketQuoteHub.lifecycle
```

完整前端回归使用 `npm run test:frontend`。live 测试继续按原跳过及显式启用条件执行；离线验证不应提供真实下单凭证。
