import type { BetOption } from "../models/betOption";
import type { BetResult } from "../models/betResult";
import type { PlatformAccount } from "../models/platformAccount";

type BetOptionLogFn = (option: BetOption, account: PlatformAccount) => void;
type BetResultLogFn = (result: BetResult, account: PlatformAccount) => void;

let saveBetOptionLogFn: BetOptionLogFn = () => {};
let saveBetResultLogFn: BetResultLogFn = () => {};

export function registerBettingLog(hooks: {
  saveBetOptionLog?: BetOptionLogFn;
  saveBetResultLog?: BetResultLogFn;
}): void {
  if (hooks.saveBetOptionLog)
    saveBetOptionLogFn = hooks.saveBetOptionLog;
  if (hooks.saveBetResultLog)
    saveBetResultLogFn = hooks.saveBetResultLog;
}

export function clearBettingLog(): void {
  saveBetOptionLogFn = () => {};
  saveBetResultLogFn = () => {};
}

export function saveBetOptionLog(option: BetOption, account: PlatformAccount): void {
  saveBetOptionLogFn(option, account);
}

export function saveBetResultLog(result: BetResult, account: PlatformAccount): void {
  saveBetResultLogFn(result, account);
}
