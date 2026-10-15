// [changmen 扩展] 只修正原有 FOK 被优化提交复核影响的问题；按私有准备快照隔离，不读取当前配置。
import assert from "node:assert/strict";
const changes = {
  "packages/venue-adapter/polymarket/fok/preflight.ts": [
    ['interface PreparedBuy {', 'interface PreparedBuy {\n  preflightMode: PmFokPreflightMode;'],
    ['preparedBuys.set(option, { data:', 'preparedBuys.set(option, { preflightMode, data:'],
  ],
  "packages/venue-adapter/polymarket/fok/bet.ts": [
    [`  const sportBlock = getPolymarketPmSportBlockReasonFromOption(option);
  if (sportBlock) return sportBlock;
  const prepared = preparedBuys.get(option);`, `  const prepared = preparedBuys.get(option);
  // [changmen 扩展] 复核属于优化方式；原有方式保持线上提交语义，使用该次尝试的私有快照。
  if (prepared?.preflightMode === "optimized") {
    const sportBlock = getPolymarketPmSportBlockReasonFromOption(option);
    if (sportBlock) return sportBlock;
  }`],
    [`            const sportBlock = getPolymarketPmSportBlockReasonFromOption(option);
            if (sportBlock) throw new Error(sportBlock);`, `            if (prepared.preflightMode === "optimized") {
              const sportBlock = getPolymarketPmSportBlockReasonFromOption(option);
              if (sportBlock) throw new Error(sportBlock);
            }`],
  ],
};
export function restorePmPreflightModeIsolation(file, source, required = false) {
  if (!changes[file] || (!required && !source.includes(file.endsWith("/bet.ts") ? "prepared?.preflightMode" : "preflightMode: PmFokPreflightMode;"))) return source;
  let restored = source.replaceAll("\r\n", "\n");
  for (const [before, after] of changes[file]) {
    assert.equal(restored.split(after).length, 2, file + ": exact captured FOK mode isolation");
    restored = restored.replace(after, before);
  }
  return restored;
}
export function verifyPmPreflightModeIsolation(read) {
  for (const file of Object.keys(changes)) restorePmPreflightModeIsolation(file, read(file), true);
}
