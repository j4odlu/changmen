import { sha256 } from "@noble/hashes/sha256";
import { IM_SPORT_BY_GAME_ID, imSportIdForGame } from "./parse";

export { IM_SPORT_BY_GAME_ID, imSportIdForGame };

export function imSupportedGameIds(): number[] {
  return [...IM_SPORT_BY_GAME_ID.keys()];
}

function wZe(): string {
  const t = Date.now();
  const e = new Uint8Array(8);
  new DataView(e.buffer).setBigUint64(0, BigInt(t), true);
  return btoa(String.fromCharCode(...e));
}

function bZe(timestamp: string): string {
  const e = Uint8Array.from(atob(timestamp), (a) => a.charCodeAt(0));
  const r = new DataView(e.buffer).getBigInt64(0, true).toString().substring(0, 3);
  const n = 70 + Math.floor(Math.random() * 10);
  const s = new DataView(e.buffer).getBigInt64(0, true).toString().substring(8, 12);
  const o = `${r}07${n}000000100${s}003000000510000041000000`;
  return btoa(o);
}

function cZe(input: string): string {
  const r = new TextEncoder().encode(input);
  const s = Array.from(sha256(r));
  return btoa(String.fromCharCode(...s));
}

/** 为 IM API 请求体注入 Timestamp / Stats / PHash */
export async function signImPayload<T extends Record<string, unknown>>(
  payload: T,
  apiPath: string,
  version = 1,
): Promise<T & { Timestamp: string; Stats: string; PHash: string }> {
  const timestamp = wZe();
  const stats = bZe(timestamp);
  const signed = { ...payload, Timestamp: timestamp, Stats: stats } as T & {
    Timestamp: string;
    Stats: string;
    PHash?: string;
  };
  const hashInput = [JSON.stringify(signed), timestamp, stats, version, apiPath].join("");
  signed.PHash = cZe(hashInput);
  return signed as T & { Timestamp: string; Stats: string; PHash: string };
}
