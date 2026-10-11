# PM 测试目录

[changmen 扩展] 2026-10-11 将原根目录 72 个测试按功能迁入本目录，不改变断言、mock 的原模块目标或测试运行规则。原位置不留测试再导出，避免 Vitest 重复发现。gtc/ 中原相邻测试保持。

| 目录 | 测试文件数 |
| --- | ---: |
| `auth/` | 2 |
| `wallet/` | 6 |
| `transport/` | 5 |
| `markets/` | 7 |
| `quotes/` | 7 |
| `realtime/` | 8 |
| `orders/` | 19 |
| `submission/` | 10 |
| `diagnostics/` | 2 |
| `fok/` | 4 |
| `compatibility/` | 2 |

测试默认继续使用根目录旧模块入口，mock 同样指向这些入口；compatibility 同时读取旧入口和真正实现以验证导出及单例。collect/marketQuoteHub 的源码契约继续检查完整实现，根目录定位适配新位置。

仓库根运行 PM 专项：

```powershell
npm run test --workspace=@changmen/web -- ../../packages/venue-adapter/polymarket --reporter=dot
```

仓库根运行新旧入口兼容测试：

```powershell
npm run test --workspace=@changmen/web -- ../../packages/venue-adapter/polymarket/tests/compatibility --reporter=dot
```

行情总线闸门命令保持名称，包内 script 已更新本次移动的测试路径：

```powershell
npm run test:quote-hub-contracts --workspace=@changmen/venue-adapter
```

完整前端测试仍以 `npm run test:frontend` 为准；既有 live 测试仍保持原跳过及显式启用规则。本次未改变网络或场馆交易资格。
