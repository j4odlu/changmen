/** [changmen 扩展] 侧栏「进行中套利」展示模型 */

export type ActiveBetRunPhase =
  | "preparing"
  | "checking"
  | "placing"
  | "settling"
  | "makeup"
  | "syncing";

export type ActiveBetLegStatus =
  | "pending"
  | "placing"
  | "submitted"
  | "pending_confirm"
  | "confirmed"
  | "rejected"
  | "failed"
  | "makeup"
  | "skipped";

export interface ActiveBetLeg {
  side: "A" | "B";
  platform: string;
  target: string;
  odds?: number;
  betMoney?: number;
  status: ActiveBetLegStatus;
  /** [changmen 扩展] 9999 本侧只参与预检，不自动下单。 */
  precheckOnly?: boolean;
  detail?: string;
  /** 本腿进度消息（预检/下单/确认等） */
  events: ActiveBetRunEvent[];
}

export interface ActiveBetRunEvent {
  at: number;
  stage: string;
  detail: string;
}

export interface ActiveBetRun {
  betId: number;
  matchId: number;
  linkId?: number;
  /** [changmen 扩展] 启动时确定的下单模式，不随单腿失败或补单改变。 */
  mode?: "arb" | "single9999" | "valueBet";
  matchTitle: string;
  betName: string;
  phase: ActiveBetRunPhase;
  overallLabel: string;
  legs: ActiveBetLeg[];
  events: ActiveBetRunEvent[];
  startedAt: number;
  updatedAt: number;
  /** settling 阶段拒单等待倒计时截止（ms） */
  countdownUntil?: number;
  /** 本轮已进入终态；实时面板短暂停留后自动移除 */
  terminalAt?: number;
}
