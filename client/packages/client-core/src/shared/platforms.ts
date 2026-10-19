import type { PlatformId } from "@changmen/api-contract";

/** 采集器内 `PLATFORMS.OB` 等常量 — 与 registry/manifest 解耦，避免平台 chunk 回引 main */
export const PLATFORMS = {
  OB: "OB",
  IM: "IM",
  RAY: "RAY",
  TF: "TF",
  IA: "IA",
  SABA: "SABA",
  XBet: "XBet",
  PB: "PB",
  IMT: "IMT",
  HG: "HG",
  Stake: "Stake",
  Dex: "Dex",
  Polymarket: "Polymarket",
  Limitless: "Limitless",
  SXBet: "SXBet",
  Azuro: "Azuro",
  PredictFun: "PredictFun",
} as const satisfies Record<string, PlatformId>;
