/**
 * 熊猫体育单注（yewu13 betOrder），不是电竞 OB 下单接口。
 * 不写 fo，不进电竞主循环。
 *
 * [官网可证实] PC BUILDIN_CONFIG `API_PREFIX_BAT=yewu13`：
 *   预检 `queryBetAmountPB`（body.orderMaxBetMoney）
 *   提交 `betPB`
 * 旧预检/提交路径在官网 PC 包里不存在（预检固定业务不支持，提交 404）。
 */
import { isObSportMemberId, pickObSportBetAccount, sportObSessionFromAccount } from "@/runtime/obSportBetAccount";
import { obSportPlaceAccepted, oddsFromObSportPlace } from "@/runtime/obSportOrderStatus";
import { postObSportPb } from "@/runtime/obSportFootballFetch";
import {
  extractObPlaySelections,
  OB_HPID_MARKET,
  olOdds,
  playsFromObMatchRow,
} from "@/runtime/obSportOdds";
import { readLocalSportObSession, type SportObSessionLocal } from "@/runtime/obSportSessionLocal";
import { readPodBetSettings } from "@/runtime/podBetSettings";
import { useAccountStore } from "@/stores/accountStore";
import { peekObSportMarketMeta } from "@/runtime/obSportMarketMeta";

/** [官网可证实] post → `/yewu13/v1/betOrder/queryBetAmountPB` */
export const OB_SPORT_QUERY_MARKET_PATH = "/yewu13/v1/betOrder/queryBetAmountPB";
/** [官网可证实] post → `/yewu13/v1/betOrder/betPB` */
export const OB_SPORT_PROCESS_BET_PATH = "/yewu13/v1/betOrder/betPB";
/** 详情盘：补 hid（预检常只回限额、不带 marketList） */
const OB_SPORT_DETAIL_ODDS_PATH = "/yewu11/v1/w/getMatchBaseInfoByOddsPB";

export type ObSportPlaceRequest = {
  oid: string;
  mid: string;
  odds: number;
  stake: number;
  minOdds?: number;
  maxOdds?: number;
  submitBefore?: number;
  marketCode?: string;
  boardSide?: string;
  line?: number | null;
  matchType?: number;
  /** 指定跟单账号；缺省读设置里的 followAccountIds[0]/默认号 */
  accountId?: number;
};

export type ObSportPlaceResult =
  | { ok: true; orderId: string; odds?: number }
  | { ok: false; message: string; outcomeUnknown?: boolean };

export type ObSportMarketInfo = {
  oid: string;
  mid: string;
  hid: string;
  hpid: string;
  odds: number;
  oddsValue: number;
  playOptions: string;
  marketValue: string;
  placeNum: number;
  minStake: number;
  maxStake: number;
  matchType: number;
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

function nested(raw: unknown): Record<string, unknown> {
  const row = asRecord(raw) || {};
  const data = asRecord(row.data);
  return data || row;
}

function asList(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function euOdds(raw: unknown): number {
  const fromOl = olOdds(raw && typeof raw === "object" ? raw as Record<string, unknown> : {});
  if (fromOl > 1)
    return fromOl;
  const n = Number(
    asRecord(raw)?.oddsValue
    ?? asRecord(raw)?.oddsFinally
    ?? asRecord(raw)?.oddFinally
    ?? asRecord(raw)?.odds
    ?? asRecord(raw)?.ov
    ?? asRecord(raw)?.od
    ?? raw,
  );
  if (!Number.isFinite(n) || n <= 0)
    return 0;
  return n > 1000 ? n / 100_000 : n;
}

function oddsValueInt(odds: number): number {
  const n = Number(odds);
  if (!(n > 1))
    return 0;
  return Math.round(n * 100_000);
}

/**
 * 馆内 id（hid / oid / mid）常为 18 位，超过 Number.MAX_SAFE_INTEGER。
 * [官网可证实] Number(hid) 会丢精度 → betPB `0402012 盘口失效`。
 */
export function asObSportId(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** JSON 里短数字可 Number；超长 id 保持字符串。 */
export function asObSportJsonId(raw: unknown): string | number {
  const s = asObSportId(raw);
  if (!s)
    return s;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n))
      return n;
  }
  return s;
}

/** boardSide / POD outcome → 官网 playOptions / oddsType */
export function obSportPlayOptions(side: string | undefined): string {
  const s = String(side || "").trim().toLowerCase();
  if (s === "over" || s === "大" || s === "大球")
    return "Over";
  if (s === "under" || s === "小" || s === "小球")
    return "Under";
  if (s === "home" || s === "1" || s === "主")
    return "1";
  if (s === "away" || s === "2" || s === "客")
    return "2";
  if (s === "draw" || s === "x" || s === "平")
    return "X";
  return String(side || "").trim();
}

/** marketCode（含 ht_）→ hpid */
export function obSportPlayIdFromMarketCode(marketCode: string | undefined): string {
  const raw = String(marketCode || "").trim().toLowerCase();
  if (!raw)
    return "2";
  const ht = raw.startsWith("ht_") || raw.includes("_ht_") || raw.endsWith("_ht");
  const code = raw.replace(/^ht_/, "").replace(/_ht$/, "");
  for (const [hpid, spec] of Object.entries(OB_HPID_MARKET)) {
    if (spec.marketCode !== code)
      continue;
    if (ht ? spec.period === "ht" : spec.period === "ft")
      return hpid;
  }
  if (code === "totals")
    return ht ? "18" : "2";
  if (code === "spreads")
    return ht ? "19" : "4";
  if (code === "moneyline")
    return ht ? "17" : "1";
  return "2";
}

function recId(rec: Record<string, unknown>): string {
  return String(rec.oid || rec.playOptionId || rec.playOptionsId || rec.id || "").trim();
}

function findOidRecord(raw: unknown, oid: string, depth = 0): Record<string, unknown> | null {
  if (depth > 8 || raw == null)
    return null;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const hit = findOidRecord(item, oid, depth + 1);
      if (hit)
        return hit;
    }
    return null;
  }
  const rec = asRecord(raw);
  if (!rec)
    return null;
  if (oid && recId(rec) === oid)
    return rec;
  for (const value of Object.values(rec)) {
    if (value && typeof value === "object") {
      const hit = findOidRecord(value, oid, depth + 1);
      if (hit)
        return hit;
    }
  }
  return null;
}

function oddsListId(rec: Record<string, unknown>): string {
  return String(rec.id || rec.oid || rec.playOptionsId || rec.playOptionId || "").trim();
}

function marketOddsBags(market: Record<string, unknown>): unknown[] {
  for (const key of ["marketOddsList", "ol", "ops", "oddsList", "odds"]) {
    const bag = market[key];
    if (Array.isArray(bag) && bag.length)
      return bag;
  }
  return [];
}

type BetAmountPickHint = {
  playOptions?: string;
  marketValue?: string;
};

export type ObSportOidMeta = {
  oid: string;
  hid: string;
  hpid: string;
  odds: number;
  oddsValue: number;
  playOptions: string;
  marketValue: string;
  placeNum: number;
};

/** 从 getMatchBaseInfoByOddsPB 解码结果按 oid 取 hid/hpid。 */
export function findObSportOidMetaInDetail(decoded: unknown, oid: string): ObSportOidMeta | null {
  const want = String(oid || "").trim();
  if (!want)
    return null;
  const envelope = asRecord(decoded) || {};
  const data = asRecord(envelope.data);
  const row = (Array.isArray(envelope.data) ? asRecord(envelope.data[0]) : null)
    || (data && (data.mid || data.hps || data.hl) ? data : null)
    || (envelope.mid ? envelope : null);
  if (!row)
    return null;
  if (Array.isArray(envelope.playData) && envelope.playData.length)
    row.playData = envelope.playData;
  for (const play of playsFromObMatchRow(row)) {
    for (const line of extractObPlaySelections(play)) {
      const hit = (line.selections || []).find(s => String(s.oid || "").trim() === want);
      if (!hit)
        continue;
      const hid = String(line.hid || "").trim();
      const hpid = String(line.hpid || "").trim();
      if (!hid && !hpid)
        continue;
      const ot = String(hit.side || "").trim();
      const playOptions = ot === "over"
        ? "Over"
        : ot === "under"
          ? "Under"
          : ot === "home"
            ? "1"
            : ot === "away"
              ? "2"
              : ot === "draw"
                ? "X"
                : String(hit.name || "").trim();
      const odds = Number(hit.odds) || 0;
      return {
        oid: want,
        hid,
        hpid,
        odds,
        oddsValue: oddsValueInt(odds),
        playOptions,
        marketValue: line.line == null || !Number.isFinite(Number(line.line)) ? "" : String(line.line),
        placeNum: 1,
      };
    }
  }
  return null;
}

async function fetchObSportOidMeta(
  session: SportObSessionLocal,
  mid: string,
  oid: string,
): Promise<ObSportOidMeta | null> {
  const matchId = String(mid || "").trim();
  const want = String(oid || "").trim();
  if (!matchId || !want)
    return null;
  try {
    const digits = String(session.sessionId || session.uid || "").replace(/\D/g, "");
    const cuid = digits.length >= 18 ? digits.slice(0, 18) : (digits || "0");
    const decoded = await postObSportPb(OB_SPORT_DETAIL_ODDS_PATH, {
      cuid,
      cos: 0,
      orpt: 0,
      euid: "3020101",
      mid: matchId,
      mcid: 0,
      newUser: 0,
    }, session);
    return findObSportOidMetaInDetail(decoded, want);
  }
  catch {
    return null;
  }
}

/**
 * 预检回包挑盘。必须对齐到目标 oid（或同向 playOptions），
 * 否则会拿大/小另一侧赔率去 betPB → 0402012 盘口失效。
 */
function pickFromBetAmountEnvelope(
  decoded: unknown,
  oid: string,
  hint: BetAmountPickHint = {},
): ObSportMarketInfo | null {
  const root = nested(decoded);
  const want = String(oid || "").trim();
  const wantOt = String(hint.playOptions || "").trim().toLowerCase();
  const wantMv = String(hint.marketValue || "").trim();
  const amountRows = asList(root.betAmountInfo);
  let minStake = 0;
  let maxStake = 0;
  let hpid = "";
  let hid = "";
  let matchedAmount = false;
  let amountError = "";
  for (const row of amountRows) {
    const rec = asRecord(row);
    if (!rec)
      continue;
    const id = String(rec.playOptionsId || rec.playOptionId || "").trim();
    if (want && id && id !== want)
      continue;
    matchedAmount = true;
    const code = rec.code;
    if (code != null && code !== "" && Number(code) !== 0 && String(code) !== "0000000") {
      amountError = String(rec.msg || rec.message || `预检码 ${code}`).trim();
      break;
    }
    minStake = Number(rec.minBet || rec.minStake || 0) || 0;
    maxStake = Number(rec.maxBet || rec.maxStake || 0) || 0;
    hpid = String(rec.playId || rec.hpid || "").trim();
    hid = asObSportId(rec.marketId || rec.hid);
    if (hid === "0")
      hid = "";
    break;
  }
  if (amountError)
    return null;
  // 限额行可能缺/错 playOptionsId；仍继续解析 latestMarketInfo / currentMarket

  let mid = "";
  let odds = 0;
  let oddsValue = 0;
  let playOptions = "";
  let marketValue = "";
  let placeNum = 1;
  let matchType = 1;
  let pickedOid = want;
  type Cand = {
    score: number;
    oid: string;
    hid: string;
    hpid: string;
    odds: number;
    oddsValue: number;
    playOptions: string;
    marketValue: string;
    placeNum: number;
    matchType: number;
    mid: string;
  };
  let best: Cand | null = null;

  for (const row of asList(root.latestMarketInfo)) {
    const match = asRecord(row);
    if (!match)
      continue;
    const thisMid = String(match.matchInfoId || match.matchId || "").trim();
    if (thisMid)
      mid = thisMid;
    const mt = Number(match.matchType);
    const thisMt = mt === 1 || mt === 2 ? mt : 1;
    const matchHpid = String(match.playId || "").trim();
    if (!hpid && matchHpid)
      hpid = matchHpid;
    // [官网可证实] 预检常带 currentMarket（当前档）+ marketList（邻档）；必须优先 currentMarket
    const marketBags = [
      ...asList(match.currentMarket ? [match.currentMarket] : []),
      ...asList(match.marketList || match.hl || match.hls),
    ];
    for (let mi = 0; mi < marketBags.length; mi++) {
      const market = asRecord(marketBags[mi]);
      if (!market)
        continue;
      const thisHid = asObSportId(market.id || market.hid || market.marketId);
      const thisPlace = Number(market.placeNum) || 1;
      const thisValue = String(market.marketValue || market.hv || "").trim();
      const thisHpid = asObSportId(market.chpid || market.playId || market.hpid || matchHpid || hpid);
      const isCurrent = match.currentMarket != null && mi === 0;
      for (const ol of marketOddsBags(market)) {
        const o = asRecord(ol);
        if (!o)
          continue;
        const olId = oddsListId(o);
        const eu = euOdds(o);
        const ot = String(o.oddsType || o.ot || o.playOptions || "").trim();
        if (!(eu > 1) && !(want && olId === want))
          continue;
        let score = 0;
        if (want && olId && olId === want)
          score += 100;
        else if (want && olId && olId !== want)
          continue;
        if (wantOt && ot && ot.toLowerCase() === wantOt)
          score += 20;
        if (wantMv && thisValue && thisValue === wantMv)
          score += 10;
        if (isCurrent)
          score += 5;
        if (eu > 1)
          score += 1;
        if (score <= 0 && want)
          continue;
        const cand: Cand = {
          score,
          oid: olId || want,
          hid: thisHid,
          hpid: thisHpid || hpid,
          odds: eu > 1 ? eu : 0,
          oddsValue: Number(o.oddsValue) || oddsValueInt(eu),
          playOptions: ot,
          marketValue: thisValue,
          placeNum: thisPlace,
          matchType: thisMt,
          mid: thisMid || mid,
        };
        if (!best || cand.score > best.score)
          best = cand;
      }
    }
  }

  if (best) {
    pickedOid = best.oid || want;
    if (best.hid)
      hid = best.hid;
    if (best.hpid)
      hpid = best.hpid;
    odds = best.odds;
    oddsValue = best.oddsValue;
    playOptions = best.playOptions;
    marketValue = best.marketValue;
    placeNum = best.placeNum;
    matchType = best.matchType;
    if (best.mid)
      mid = best.mid;
  }

  if (!want && !hid && !hpid)
    return null;
  if (want && !matchedAmount && !hid && !(odds > 1))
    return null;

  return {
    oid: pickedOid || want,
    mid,
    hid,
    hpid,
    odds,
    oddsValue: oddsValue || oddsValueInt(odds),
    playOptions,
    marketValue,
    placeNum,
    minStake,
    maxStake,
    matchType,
  };
}

/** 解析预检回包：优先 queryBetAmountPB 形状，兼容旧嵌套 oid 测试夹具。 */
export function pickObSportMarketInfo(
  decoded: unknown,
  oid: string,
  hint: BetAmountPickHint = {},
): ObSportMarketInfo | null {
  const fromNew = pickFromBetAmountEnvelope(decoded, oid, hint);
  if (fromNew && (
    fromNew.hpid
    || (fromNew.hid && fromNew.hid !== fromNew.oid)
    || fromNew.odds > 1
    || fromNew.minStake > 0
  ))
    return fromNew;

  const want = String(oid || "").trim();
  const hit = findOidRecord(decoded, want) || findOidRecord(nested(decoded), want);
  if (!hit)
    return fromNew;
  // ol 节点的 id 是 oid，不是 hid
  const hid = asObSportId(hit.hid || hit.marketId);
  const odds = euOdds(hit);
  const ms = Number(hit.ms ?? hit.matchType);
  return {
    oid: recId(hit) || want,
    mid: asObSportId(hit.mid || hit.matchInfoId || hit.matchId),
    hid: hid && hid !== want ? hid : "",
    hpid: asObSportId(hit.hpid || hit.playId || hit.chpid),
    odds: Number.isFinite(odds) ? odds : 0,
    oddsValue: Number(hit.oddsValue) || oddsValueInt(odds),
    playOptions: String(hit.oddsType || hit.playOptions || hit.ot || "").trim(),
    marketValue: String(hit.marketValue || hit.hv || "").trim(),
    placeNum: Number(hit.placeNum) || 1,
    minStake: Number(hit.minBet || hit.minStake || hit.smin || 0) || 0,
    maxStake: Number(hit.maxBet || hit.maxStake || hit.smax || 0) || 0,
    matchType: ms === 1 || ms === 2 ? ms : 1,
  };
}

/** [官网可证实] queryBetAmount 请求体。 */
export function buildObSportQueryBetAmountBody(opts: {
  oid: string;
  mid: string;
  odds: number;
  hpid: string;
  playOptions: string;
  matchType?: number;
  marketValue?: string;
  hid?: string;
}): Record<string, unknown> {
  const odds = Number(opts.odds) || 0;
  return {
    orderMaxBetMoney: [{
      sportId: 1,
      marketId: opts.hid ? asObSportJsonId(opts.hid) : 0,
      deviceType: 1,
      matchId: asObSportJsonId(opts.mid),
      oddsFinally: odds > 1 ? String(odds) : "",
      oddsValue: oddsValueInt(odds) || undefined,
      playId: asObSportJsonId(opts.hpid),
      playOptionId: asObSportId(opts.oid),
      playOptions: opts.playOptions,
      scoreBenchmark: "",
      tenantId: 1,
      matchType: opts.matchType === 2 ? 2 : 1,
      excellentOddsBet: 0,
      marketValue: opts.marketValue || "",
    }],
    type: "selection_now",
  };
}

/** [官网可证实] betPB 单关 orderDetail：playOptionsId / oddFinally / marketTypeFinally / odds=ov。 */
export function buildObSportProcessBetBody(opts: {
  oid: string;
  mid: string;
  hid: string;
  hpid: string;
  odds: number;
  stake: number;
  matchType?: number;
  playOptions?: string;
  marketValue?: string;
  placeNum?: number;
  oddsValue?: number;
  playName?: string;
  playOptionName?: string;
  matchName?: string;
}): Record<string, unknown> {
  const oddsEu = Number(opts.odds) || 0;
  const oddsOv = Number(opts.oddsValue) || oddsValueInt(oddsEu);
  const playOptions = String(opts.playOptions || "").trim();
  const marketValue = String(opts.marketValue || "").trim();
  return {
    acceptOdds: 2,
    tenantId: 1,
    deviceType: 1,
    currencyCode: "CNY",
    deviceImei: "",
    fpId: "",
    openMiltSingle: 0,
    preBet: 0,
    developers: "ty",
    timeZone: 20,
    seriesOrders: [{
      seriesType: 1,
      seriesSum: 1,
      seriesValues: "单关",
      fullBet: 0,
      orderDetailList: [{
        sportId: 1,
        // 禁止 Number(18位 hid)：丢精度即 0402012
        marketId: asObSportJsonId(opts.hid),
        matchId: asObSportJsonId(opts.mid),
        matchName: String(opts.matchName || "").trim(),
        matchType: opts.matchType === 2 ? 2 : 1,
        playId: asObSportJsonId(opts.hpid),
        playName: String(opts.playName || "").trim(),
        playOptionsId: asObSportId(opts.oid),
        playOptions,
        playOptionName: String(opts.playOptionName || playOptions).trim(),
        oddFinally: oddsEu > 1 ? oddsEu : "",
        odds: oddsOv || undefined,
        marketTypeFinally: "EU",
        marketValue,
        betAmount: opts.stake,
        placeNum: Number(opts.placeNum) || 1,
        excellentOddsBet: 0,
      }],
    }],
  };
}

function resolveObSportPlaceSession(accountId = 0): SportObSessionLocal | { error: string } {
  const settings = readPodBetSettings();
  const want = Number(accountId) || settings.followAccountIds[0] || settings.followAccountId || 0;
  const account = pickObSportBetAccount(useAccountStore().accounts, want);
  const session = sportObSessionFromAccount(account);
  if (!session?.token)
    return { error: "请在 OB 下注账号里填入体育 token" };
  const collect = readLocalSportObSession();
  const sameCollectToken = Boolean(
    collect?.token && String(collect.token).trim() === String(session.token).trim(),
  );
  if (!session.gateway && sameCollectToken)
    session.gateway = String(collect?.gateway || collect?.lastGateway || "").trim();
  if (!session.gateway)
    return { error: "下注账号缺少网关" };
  // 官网 checkId 中间段是 TY_SDK_USER_ID；缺 uid 会变成 0。
  if (!isObSportMemberId(session.sessionId) && sameCollectToken)
    session.sessionId = String(collect?.sessionId || collect?.uid || "").trim();
  if (!isObSportMemberId(session.sessionId))
    return { error: "下注账号缺少有效体育 UID" };
  if (!session.uid)
    session.uid = session.sessionId;
  return session;
}

function formatObSportMarketValue(line: number | null | undefined): string {
  if (line == null)
    return "";
  const n = Number(line);
  if (!Number.isFinite(n))
    return "";
  return String(n);
}

function betAmountRowError(decoded: unknown, oid: string): string | null {
  const root = nested(decoded);
  const want = String(oid || "").trim();
  for (const row of asList(root.betAmountInfo)) {
    const rec = asRecord(row);
    if (!rec)
      continue;
    const id = String(rec.playOptionsId || rec.playOptionId || "").trim();
    if (want && id && id !== want)
      continue;
    const code = rec.code;
    if (code != null && code !== "" && Number(code) !== 0 && String(code) !== "0000000")
      return String(rec.msg || rec.message || `预检码 ${code}`).trim() || "预检盘口不可用";
    return null;
  }
  return null;
}

export async function placeObSportSingle(req: ObSportPlaceRequest): Promise<ObSportPlaceResult> {
  const oid = String(req.oid || "").trim();
  const stake = Number(req.stake);
  const mid = String(req.mid || "").trim();
  const minOdds = Number(req.minOdds) || 0;
  const maxOdds = Number(req.maxOdds) || 0;
  const expired = () => req.submitBefore != null && Date.now() >= req.submitBefore;
  if (expired())
    return { ok: false, message: "警报已过期或比赛已开赛" };
  const playOptions = obSportPlayOptions(req.boardSide);
  const hpidGuess = obSportPlayIdFromMarketCode(req.marketCode);
  const line = formatObSportMarketValue(req.line);
  if (!oid)
    return { ok: false, message: "无 oid" };
  if (!mid)
    return { ok: false, message: "无 OB mid" };
  if (!(stake > 0))
    return { ok: false, message: "注码未设" };
  const session = resolveObSportPlaceSession(Number(req.accountId) || 0);
  if ("error" in session)
    return { ok: false, message: session.error };

  // 详情盘补 hid：同一次下单只拉一次
  let detailMeta: ObSportOidMeta | null | undefined;
  let detailFetched = false;
  // 只有提交请求已经开始但没有拿到明确响应时，结果才标记为未知。
  // 上层会永久保留该警报/账号的执行占位，禁止自动重试造成重复下注。
  let submitInFlight = false;

  const tryOnce = async (matchType: 1 | 2): Promise<ObSportPlaceResult> => {
    if (expired())
      return { ok: false, message: "警报已过期或比赛已开赛" };
    if (detailMeta === undefined) {
      const cached = peekObSportMarketMeta(String(session.gateway || ""), mid, oid);
      detailMeta = cached ? { ...cached, odds: 0, oddsValue: 0, placeNum: 1 } : await fetchObSportOidMeta(session, mid, oid);
      detailFetched = !cached;
    }
    const hidHint = String(detailMeta?.hid || "").trim();
    const hpidHint = String(detailMeta?.hpid || "").trim() || hpidGuess;
    const lineHint = line || String(detailMeta?.marketValue || "").trim();
    const playHint = playOptions || String(detailMeta?.playOptions || "").trim();
    const oddsHint = Number(req.odds) || Number(detailMeta?.odds) || 0;

    const queryBody = buildObSportQueryBetAmountBody({
      oid,
      mid,
      odds: oddsHint,
      hpid: hpidHint,
      playOptions: playHint,
      matchType,
      marketValue: lineHint,
      hid: hidHint || undefined,
    });
    const queried = await postObSportPb(OB_SPORT_QUERY_MARKET_PATH, queryBody, session);
    const amountErr = betAmountRowError(queried, oid);
    if (amountErr)
      return { ok: false, message: amountErr };
    const info = pickObSportMarketInfo(queried, oid, { playOptions: playHint, marketValue: lineHint });
    // [changmen 扩展] 缓存只复用结构；预检只返回限额时，恢复下注账号详情报价校验。
    if (!(Number(info?.odds) > 1) && !detailFetched) {
      detailMeta = await fetchObSportOidMeta(session, mid, oid);
      detailFetched = true;
      if (!(Number(detailMeta?.odds) > 1))
        return { ok: false, message: "下注账号未返回有效赔率" };
    }
    if (!info?.oid && !detailMeta)
      return { ok: false, message: "预检未返回盘口" };

    let hid = String(info?.hid || detailMeta?.hid || "").trim();
    if (hid === "0")
      hid = "";
    const hpid = String(info?.hpid || detailMeta?.hpid || "").trim()
      || hpidGuess;
    if (!hid || !hpid || hpid === "0")
      return { ok: false, message: "预检缺 hid/hpid" };

    const odds = (info?.odds && info.odds > 1 ? info.odds : 0)
      || (detailMeta?.odds && detailMeta.odds > 1 ? detailMeta.odds : 0)
      || oddsHint;
    if (!(odds > 1))
      return { ok: false, message: "预检无赔率" };
    if (minOdds > 1 && odds + 1e-6 < minOdds)
      return { ok: false, message: `预检 ${odds} 低于门槛 ${minOdds}` };
    if (maxOdds > 1 && odds > maxOdds + 1e-6)
      return { ok: false, message: `预检 ${odds} 超过 EV 上限 ${maxOdds}` };
    if (info && info.minStake > 0 && stake < info.minStake)
      return { ok: false, message: `低于最小额 ${info.minStake}` };
    if (info && info.maxStake > 0 && stake > info.maxStake)
      return { ok: false, message: `超过最大额 ${info.maxStake}` };

    const body = buildObSportProcessBetBody({
      oid: String(info?.oid || oid).trim(),
      mid: String(info?.mid || mid).trim(),
      hid,
      hpid,
      odds,
      stake,
      matchType: info?.matchType === 2 ? 2 : matchType,
      playOptions: info?.playOptions || detailMeta?.playOptions || playHint,
      marketValue: info?.marketValue || detailMeta?.marketValue || lineHint,
      placeNum: info?.placeNum || detailMeta?.placeNum || 1,
      oddsValue: info?.oddsValue || detailMeta?.oddsValue || oddsValueInt(odds),
      playOptionName: info?.playOptions || detailMeta?.playOptions || playHint,
    });
    if (!body || !(Number((body.seriesOrders as Array<{ orderDetailList: unknown[] }>)[0]?.orderDetailList?.length) > 0))
      return { ok: false, message: "下单包为空" };
    if (expired())
      return { ok: false, message: "警报已过期或比赛已开赛" };
    submitInFlight = true;
    const placed = await postObSportPb(OB_SPORT_PROCESS_BET_PATH, body, session);
    submitInFlight = false;
    const accepted = obSportPlaceAccepted(placed);
    if (!accepted.ok)
      return accepted;
    const venueOdds = oddsFromObSportPlace(placed) || odds;
    return { ok: true, orderId: accepted.orderId, odds: venueOdds > 1 ? venueOdds : undefined };
  };

  const firstType: 1 | 2 = req.matchType === 2 ? 2 : 1;
  try {
    const first = await tryOnce(firstType);
    if (first.ok)
      return first;
    const msg = first.message || "";
    // 早盘/滚球 matchType 不对时常见 0402012；翻一次再试
    if (/0402012|盘口失效|盘口已变/.test(msg) || /预检未返回|预检缺|预检无赔率/.test(msg)) {
      const alt: 1 | 2 = firstType === 1 ? 2 : 1;
      try {
        const second = await tryOnce(alt);
        if (second.ok)
          return second;
        if (/0402012|盘口失效/.test(second.message))
          return { ok: false, message: "盘口已变/失效，请刷新后再下" };
        return second;
      }
      catch (err2) {
        const m2 = err2 instanceof Error ? err2.message : String(err2);
        if (/0402012|盘口失效/.test(m2))
          return { ok: false, message: "盘口已变/失效，请刷新后再下" };
        return { ok: false, message: m2.slice(0, 180) || "下单失败" };
      }
    }
    if (/0402012|盘口失效/.test(msg))
      return { ok: false, message: "盘口已变/失效，请刷新后再下" };
    return first;
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/0402012|盘口失效/.test(msg)) {
      const alt: 1 | 2 = firstType === 1 ? 2 : 1;
      try {
        const second = await tryOnce(alt);
        if (second.ok)
          return second;
        return { ok: false, message: "盘口已变/失效，请刷新后再下" };
      }
      catch {
        return { ok: false, message: "盘口已变/失效，请刷新后再下" };
      }
    }
    return {
      ok: false,
      message: msg.slice(0, 180) || "下单失败",
      outcomeUnknown: submitInFlight,
    };
  }
}
