/** [changmen 扩展] Public market ingress only; no socket ownership or account data. */
export type MarketStreamState = Readonly<{ epoch: number; source: "official" | "changmen"; open: boolean }>;
export type MarketStreamEvent =
  | { type: "state"; state: MarketStreamState }
  | { type: "frame"; epoch: number; sequence: number; receivedAt: number; wallAt: number; raw: string };
