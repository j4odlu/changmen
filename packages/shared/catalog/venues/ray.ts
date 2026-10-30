/**
 * [changmen 扩展] RAY 场馆盘口规则，作为 market_catalog.json 的后续迁移目标。
 * 纯函数，可在浏览器和 Node 共用；当前尚未切换采集、合场或下单入口。
 *
 * 三层独立：官网协议解析 → 已确认的业务含义 → 当前独赢采集策略。
 * tag 仅代表选项形态：win 也可能是一血，ou 也可能是击杀/时间/单队总分。
 * 未确认的组继续保留全部原始字段，不自动推定含义、全场周期或结算规则。
 * 来源及完整展示规则：docs/reference/ray/frontend_market_rules.json。
 */

export interface RayOdd {
  odds_id?: unknown;
  odds_group_id?: unknown;
  match_stage?: unknown;
  tag?: unknown;
  value?: unknown;
  group_name?: unknown;
  group_short_name?: unknown;
  team_id?: unknown;
  status?: unknown;
  [field: string]: unknown;
}

export interface RayContext {
  /** 上层比赛上下文，不能仅靠盘口组 ID 猜测比赛或项目。 */
  eventId: string | number;
  gameId: string | number;
  gameCode?: string;
}

export type RayMarketCode = "match_winner" | "handicap" | "total" | "team_total" | "odd_even" | "outright";
export type RayTarget = "match" | "team1" | "team2" | "tournament";

export interface RayMarketDefinition {
  gameCode: string;
  gameId: string;
  groupId: string;
  stage: string;
  tag: string;
  marketCode: RayMarketCode;
  statistic: "result" | "points";
  target: RayTarget;
  /** included 仅表示已观察到的明确标题；unspecified 不等于不含加时。 */
  overtime: "included" | "unspecified";
  evidence: "legacy_catalog" | "api_snapshot";
}

interface WinnerGroups {
  gameId: string;
  mapStagePrefix: "r" | "map";
  full: string;
  map: Readonly<Record<string, string>>;
}

// 原 market_catalog.json 的 RAY 独赢白名单；迁移时可逐调用点核对，当前不自动替换。
const winnerGroups: Readonly<Record<string, WinnerGroups>> = {
  cs2: { gameId: "140", mapStagePrefix: "map", full: "16847", map: { 1: "16854", 2: "16877", 3: "16886" } },
  kog: { gameId: "74", mapStagePrefix: "r", full: "20573", map: { 1: "20582", 2: "20583", 3: "20584", 4: "23160", 5: "23161" } },
  valorant: { gameId: "37197927", mapStagePrefix: "map", full: "16857", map: { 1: "2587786", 2: "2587856", 3: "1510938" } },
  lol: { gameId: "70", mapStagePrefix: "r", full: "18280", map: { 1: "18303", 2: "18304", 3: "18305" } },
  dota2: { gameId: "151", mapStagePrefix: "r", full: "16778", map: { 1: "16787", 2: "16788", 3: "16789" } },
  basketball: { gameId: "1072082", mapStagePrefix: "r", full: "1279801", map: {} },
};

// 官网 Match.Stage.* 的 61 个标签。标签与周期原码一起保存，不统一转成 Map 数字。
const stageLabels: Record<string, { zh: string; en: string }> = {
  "final": { zh: "全场", en: "Full Match" },
  "1st": { zh: "上半场", en: "1st half" },
  "h2": { zh: "下半场", en: "2nd half" },
  "ot": { zh: "加时 & 点球", en: "OT" },
  "pt": { zh: "分", en: "PT" },
  "f5in": { zh: "前5局", en: "F5in" },
  "goals": { zh: "进球", en: "Goals" },
  "others": { zh: "其他", en: "Others" },
};
for (const [prefix, count, zh, en] of [
  ["q", 4, "第{n}节", "Q{n}"],
  ["p", 3, "第{n}节", "P{n}"],
  ["s", 9, "第{n}盘", "S{n}"],
  ["r", 9, "第{n}局", "R{n}"],
  ["map", 9, "地图{n}", "Map{n}"],
  ["b", 19, "回合{n}", "B{n}"],
] as const) {
  for (let n = 1; n <= count; n++) {
    stageLabels[`${prefix}${n}`] = { zh: zh.replace("{n}", String(n)), en: en.replace("{n}", String(n)) };
  }
}

// 官网 tag 分支的形态分类，不直接当作统一业务盘口代码。
const tagFamilies: Readonly<Record<string, string>> = {
  "win": "team_choice",
  "wdl": "three_way",
  "hdp": "handicap",
  "ahdp": "asian_handicap",
  "ou": "over_under",
  "oe": "odd_even",
  "crs": "correct_score",
  "acrs": "correct_score",
  "ab": "selection",
  "abn": "selection",
  "select": "selection",
  "mselect": "multiple_selection",
  "o.select": "selection",
  "o.mselect": "multiple_selection",
  "first": "team_choice",
  "firstn": "team_choice",
  "outright": "outright",
  "moutright": "outright",
};

const definitions: RayMarketDefinition[] = [];
for (const [gameCode, groups] of Object.entries(winnerGroups)) {
  for (const [stage, groupId] of [
    ["final", groups.full],
    ...Object.entries(groups.map).map(([n, id]) => [`${groups.mapStagePrefix}${n}`, id]),
  ]) {
    definitions.push({
      gameCode,
      gameId: groups.gameId,
      groupId,
      stage,
      tag: "win",
      marketCode: "match_winner",
      statistic: "result",
      target: "match",
      overtime: gameCode === "basketball" ? "included" : "unspecified",
      evidence: "legacy_catalog",
    });
  }
}

// API 采样确认的篮球组，含单队总分、半场、单节和冠军盘。
// 不是官网硬编码表；未见到的组仍可通过通用解析保留，后续有证据再补定义。
const basketballGroups: readonly (readonly [string, string, string, RayMarketCode, RayTarget, boolean])[] = [
  ["1279840", "final", "hdp", "handicap", "match", true],
  ["1280153", "final", "ou", "total", "match", true],
  ["1280234", "final", "oe", "odd_even", "match", true],
  ["1280447", "q1", "hdp", "handicap", "match", false],
  ["1280625", "q1", "ou", "total", "match", false],
  ["1280661", "q1", "oe", "odd_even", "match", false],
  ["1280843", "q3", "oe", "odd_even", "match", false],
  ["2275779", "1st", "ou", "total", "match", false],
  ["2275849", "1st", "win", "match_winner", "match", false],
  ["2275879", "1st", "hdp", "handicap", "match", false],
  ["2275902", "1st", "oe", "odd_even", "match", false],
  ["2276305", "q1", "win", "match_winner", "match", false],
  ["3304426", "final", "outright", "outright", "tournament", false],
  ["8235658", "q3", "hdp", "handicap", "match", false],
  ["8426918", "q3", "ou", "total", "match", false],
  ["18478287", "final", "ou", "team_total", "team1", true],
  ["18478621", "final", "ou", "team_total", "team2", true],
  ["18478856", "1st", "ou", "team_total", "team1", false],
  ["18478966", "1st", "ou", "team_total", "team2", false],
  ["18479454", "q1", "ou", "team_total", "team1", false],
  ["18479718", "q1", "ou", "team_total", "team2", false],
];
for (const [groupId, stage, tag, marketCode, target, included] of basketballGroups) {
  definitions.push({
    gameCode: "basketball",
    gameId: "1072082",
    groupId,
    stage,
    tag,
    marketCode,
    target,
    statistic: marketCode === "match_winner" || marketCode === "outright" ? "result" : "points",
    overtime: included ? "included" : "unspecified",
    evidence: "api_snapshot",
  });
}

export const RAY_MARKET_CATALOG = {
  schemaVersion: 1,
  provider: "RAY",
  version: "2026-10-27.1",
  integration: "staged",
  provenance: {
    officialFrontend: "https://ray164.com/js/app.9f7716dc.js",
    sha256: "74b70656aa23609045950bfd2f659f715075eb256c026003bd59fd9f1bd74ac2",
    frontendRules: "docs/reference/ray/frontend_market_rules.json",
    observedGroups: "docs/audits/2026-10-27-ray-cross-sport/group-codes.csv",
    observedAt: "2026-10-27",
  },
  protocol: {
    stageLabels: stageLabels as Readonly<typeof stageLabels>,
    tagFamilies,
    visibleStatuses: [1, 2, 5],
    clickableStatus: 1,
    removedStatus: 4,
    groupIdentity: ["eventId", "gameId", "odds_group_id", "match_stage", "ahdp.score"],
  },
  definitions: definitions as readonly RayMarketDefinition[],
  // 仅保存兼容策略，解析器本身不丢弃其他盘口；启用新玩法需要另行迁移消费者。
  legacySelection: { winnerGroups, fallbackNamePattern: "^获胜者$", excludedStatus: 4 },
  settlement: {
    verified: false,
    note: "标题与选项解析不证明走盘、取消、加时细则或跨场馆互补；本模块不决定对冲资格。",
  },
} as const;

const text = (value: unknown): string => String(value ?? "").trim();
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
const identity = (parts: readonly string[]): string => JSON.stringify(parts);
const definitionIndex = new Map(definitions.map(d => [identity([d.gameId, d.groupId, d.stage, d.tag]), d]));

export interface RayParsedValue {
  raw: string;
  score: string;
  /** 原始带方向的线，绝不取绝对值；不适用时为 null。 */
  line: string | null;
  /** 支持双分数线；不使用 parseFloat 静默截断未知格式。 */
  components: readonly number[] | null;
  direction: "over" | "under" | null;
}

export function parseRayValue(tag: string, value: unknown): RayParsedValue {
  const raw = String(value ?? "");
  const parsed: RayParsedValue = { raw, score: "", line: null, components: null, direction: null };
  let line = raw.trim();
  if (tag === "ahdp") {
    const parts = line.split(",");
    if (parts.length > 1 && /^\d+-\d+$/.test(parts[0].trim())) {
      parsed.score = parts.shift()!.trim();
      line = parts.join(",").trim();
    }
  }
  if (tag === "ou") {
    const match = /^([<>])(.*)$/.exec(line);
    if (!match)
      return parsed;
    parsed.direction = match[1] === ">" ? "over" : "under";
    line = match[2].trim();
  }
  else if (tag !== "hdp" && tag !== "ahdp") {
    return parsed;
  }
  parsed.line = line;
  const parts = line.split(",").map(part => part.trim());
  if (parts.length <= 2 && parts.every(part => /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(part))) {
    const numbers = parts.map(Number);
    if (numbers.every(Number.isFinite))
      parsed.components = numbers;
  }
  return parsed;
}

export function describeRayOdd(row: RayOdd, context: RayContext) {
  const eventId = text(context.eventId);
  const gameId = text(context.gameId);
  const groupId = text(row.odds_group_id);
  const stage = text(row.match_stage);
  const tag = text(row.tag);
  const value = parseRayValue(tag, row.value);
  const found = definitionIndex.get(identity([gameId, groupId, stage, tag]));
  const definition = found && (!context.gameCode || found.gameCode === context.gameCode) ? found : null;
  // 缺身份字段时不能误合并为一组；原始行仍由调用方保留并诊断。
  const groupKey = eventId && gameId && groupId && stage
    ? identity([eventId, gameId, groupId, stage, value.score])
    : null;
  return {
    eventId,
    gameId,
    groupId,
    optionId: text(row.odds_id),
    stage,
    tag,
    stageLabel: own(stageLabels, stage) ?? null,
    family: own(tagFamilies, tag) ?? null,
    names: { zh: text(row.group_name), en: text(row.group_short_name) },
    value,
    groupKey,
    definition,
    // 未定义的盘口不根据 tag/name 猜统一业务码。
    marketCode: definition?.marketCode ?? null,
    raw: row,
  };
}

/** 复用官网的分组身份；保留全部原始选项，包括锁盘、删盘和未知类型。不是分数线配对器。 */
export function groupRayOdds(rows: readonly RayOdd[], context: RayContext) {
  const groups = new Map<string, ReturnType<typeof describeRayOdd>[]>();
  const ungrouped: ReturnType<typeof describeRayOdd>[] = [];
  for (const row of rows) {
    const option = describeRayOdd(row, context);
    if (!option.groupKey) {
      ungrouped.push(option);
      continue;
    }
    const group = groups.get(option.groupKey);
    if (group)
      group.push(option);
    else groups.set(option.groupKey, [option]);
  }
  return { groups: [...groups].map(([key, options]) => ({ key, options })), ungrouped };
}

/** 旧采集白名单的独立兼容入口。与严格语义识别分开，便于分阶段替换旧 catalog。 */
export function matchesRayLegacyWinner(row: RayOdd, gameCode?: string | null): boolean {
  if (row.status === RAY_MARKET_CATALOG.legacySelection.excludedStatus)
    return false;
  const groups = gameCode ? own(winnerGroups, gameCode) : undefined;
  const groupId = text(row.odds_group_id);
  if (groups && groupId)
    return groupId === groups.full || Object.values(groups.map).includes(groupId);
  return /^获胜者$/.test(String(row.group_name ?? ""));
}
