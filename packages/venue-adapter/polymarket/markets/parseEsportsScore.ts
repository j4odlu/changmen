/** 解析 PM score 字段，如 "000-000|1-2|Bo3"（与 server/parse_sport.js 对齐） */
export function parseEsportsScore(score: string | undefined): {
  mapScore: { home: number; away: number };
  bo: number | null;
} {
  const raw = String(score ?? "").trim();
  if (!raw)
    return { mapScore: { home: 0, away: 0 }, bo: null };

  const parts = raw.split("|");
  const mapPart = parts[1] || "0-0";
  const boPart = parts[2] || "";
  const mapNums = mapPart.split("-").map(v => Number.parseInt(v, 10));
  const home = Number.isFinite(mapNums[0]) ? mapNums[0] : 0;
  const away = Number.isFinite(mapNums[1]) ? mapNums[1] : 0;
  const boMatch = /bo\s*(\d+)/i.exec(boPart);
  const boParsed = boMatch ? Number.parseInt(boMatch[1], 10) : NaN;
  const bo = Number.isFinite(boParsed) && boParsed > 0 ? boParsed : null;

  return {
    mapScore: { home, away },
    bo,
  };
}
