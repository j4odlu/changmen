import { BetResult } from "@changmen/client-core/models/betResult";
import { getPbLineId, setPbLineId } from "./lineCache";
import { pbPost } from "./transport";
import { toNumber } from "./parse";
import { startPbRejectPoll, pbRejectStorageKey } from "./rejectPoll";
import type { PlatformProvider, VenueOrder, VenueOrderStatus } from "../contract";
import { formatPbDateTime } from "@changmen/client-core/shared/format";
import { getCurrency } from "@changmen/shared/currency";
import { useMessageStore } from "../shared/webBridge";
import { PLATFORMS } from "../shared/platforms";
import { accountMultiplyScale, scaleVenueMoney, venueStakeFromBetMoney } from "@changmen/shared/account_multiply";
import { pbUuid } from "./uuid";
import { parsePbVenueIdentity } from "./auth";

interface PbOddsSelectionRow {
  status?: string;
  minStake?: number;
  maxStake?: number;
  odds?: number | { toNumber?: () => number };
  lineId?: number;
}

interface PbBuyResponse {
  response?: Array<{ status?: string; uniqueRequestId?: string; errorCode?: string }>;
  errorMessage?: string;
}

function wagerFilterBody(fields: Record<string, string | number | boolean>): string {
  return new URLSearchParams(
    Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
  ).toString();
}

function mapWagerRow(u: unknown[], multiply: number): VenueOrder {
  const gameFull = String(u[28] ?? "");
  const game = gameFull.split(" - ")[0] ?? "";
  const match = String(u[9] ?? "");
  const mapNum = Number(u[42]) || 0;
  const bet = mapNum === 0 ? "全场" : `地图${mapNum}`;
  const item = String(u[22] ?? "");
  const orderId = String(u[7] ?? "");
  const odds = Number(u[16]) || 0;
  const reward = Number(u[29]) + Number(u[0] || 0);
  const betMoney = Number(u[29]) || 0;
  const createAt = Number(u[19]) || 0;
  const state = String(u[18] ?? "");

  let status: VenueOrderStatus = "none";
  let money = 0;
  if (state === "SETTLED") {
    status = reward > 0 ? "win" : "lose";
    money = reward - betMoney;
  } else if (state === "CANCELLED") {
    status = "return";
    money = 0;
  }

  return {
    provider: PLATFORMS.PB,
    orderId,
    odds,
    createAt,
    betMoney: betMoney * multiply,
    reward: reward * multiply,
    money: money * multiply,
    status,
    game,
    match,
    bet,
    item,
  };
}

export const pbProvider: PlatformProvider = {
  async getBalance(account) {
    const path = `/member-service/v2/account-balance?locale=zh_CN&_=${Date.now()}&withCredentials=true`;
    const data = await pbPost<{
      success?: boolean;
      betCredit?: number;
      currency?: string;
      error?: string;
      code?: string | number;
      message?: string;
    }>(account, path, "");
    if (!data?.success) {
      const reason = String(
        data?.error || data?.message || data?.code || "account-balance failed",
      );
      throw new Error(reason);
    }
    const multiply = accountMultiplyScale(account.multiply);
    const identity = parsePbVenueIdentity(account.token);
    return {
      balance: scaleVenueMoney(Number(data.betCredit) || 0, multiply),
      currency: getCurrency(data.currency),
      venueMemberId: identity?.venueMemberId,
      venueAccountName: identity?.venueAccountName,
    };
  },

  async getOrders(account) {
    const path = `/member-service/v2/wager-filter?locale=zh_CN`;
    const multiply = accountMultiplyScale(account.multiply);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const filters = [
      {
        f: formatPbDateTime(now),
        t: formatPbDateTime(now),
        d: -1,
        s: "OPEN",
        sd: false,
        type: "EVENT",
        product: "SB",
        timezone: "GMT-4",
        sportId: "",
        leagueId: "",
      },
      {
        f: formatPbDateTime(yesterday),
        t: formatPbDateTime(now),
        d: -1,
        s: "SETTLED",
        sd: false,
        type: "WAGER",
        product: "SB",
        timezone: "GMT-4",
        sportId: "",
        leagueId: "",
      },
    ];

    const rows: VenueOrder[] = [];
    for (const filter of filters) {
      const body = wagerFilterBody(filter);
      const data = await pbPost<unknown[] | { error?: string }>(account, path, body, {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      });
      if (!data || (typeof data === "object" && !Array.isArray(data) && "error" in data)) continue;
      if (!Array.isArray(data)) continue;
      for (const raw of data) {
        if (!Array.isArray(raw)) continue;
        const order = mapWagerRow(raw, multiply);
        if (!rows.some((r) => r.orderId === order.orderId)) {
          rows.push(order);
        }
      }
    }

    const storageKey = pbRejectStorageKey(account);
    const cached = sessionStorage.getItem(storageKey);
    if (cached) {
      try {
        const pending = JSON.parse(cached) as VenueOrder;
        if (!rows.some((r) => r.orderId === pending.orderId)) {
          rows.push(pending);
        }
        if (pending.status !== "pending") {
          sessionStorage.removeItem(storageKey);
        }
      } catch {
        sessionStorage.removeItem(storageKey);
      }
    }

    return rows.sort((a, b) => b.createAt - a.createAt);
  },

  async checkBet(account, option) {
    const itemId = option.itemId;
    // 优先 GetMatchs Sources.LineID（新前端）；否则本机 lineCache（旧前端 / 本机刚采过）
    const fromSource = Number(option.item?.lineId) || 0;
    const cachedLine = fromSource > 0 ? fromSource : getPbLineId(option.betId);
    if (!cachedLine) {
      option.checkError = `查找line值失败,${option.betId}`;
      return option;
    }
    // 本机有会话采集时同步刷新 cache，旧路径与旁路一致
    if (fromSource > 0 && option.betId)
      setPbLineId(option.betId, fromSource);

    const probePath = `/member-betslip/v2/all-odds-selections?locale=zh_CN&_=${Date.now()}&withCredentials=true`;
    const rows = await pbPost<PbOddsSelectionRow[]>(account, probePath, {
      oddsSelections: [
        {
          oddsFormat: 1,
          oddsId: itemId,
          oddsSelectionsType: "NORMAL",
          selectionId: `${cachedLine}|${itemId}`,
        },
      ],
    }, {
      "content-type": "application/json; charset=UTF-8",
    });

    option.response = rows;
    if (!Array.isArray(rows) || rows.length !== 1) {
      // part888/ps3838：缺内层 X-U 等时场馆常回 HTTP200 + {"error":403}
      if (
        rows
        && typeof rows === "object"
        && !Array.isArray(rows)
        && (rows as { error?: unknown }).error === 403
      ) {
        option.checkError = "会话鉴权失败(403)：请重新登录平博并粘贴账号（需含内层 X-U）";
        return option;
      }
      option.checkError = JSON.stringify(rows);
      return option;
    }

    const row = rows[0]!;
    if (row.status === "UNAVAILABLE") {
      option.checkError = row.status;
      return option;
    }

    const stake = venueStakeFromBetMoney(option.betMoney, account.multiply);
    const minStake = Number(row.minStake) || 0;
    const maxStake = Number(row.maxStake) || 0;
    if (stake < minStake || stake > maxStake) {
      option.checkError = useMessageStore().limitMessage(account, {
        match: option.match?.title,
        bet: option.bet?.getBetName(),
        odds: option.odds,
        betMoney: option.betMoney,
        limit: maxStake,
      });
      return option;
    }

    option.newOdds = toNumber(row.odds);
    if (!option.newOdds) {
      option.checkError = "赔率不可用";
      return option;
    }
    if (option.newOdds < option.odds - 0.01) {
      option.checkError = `赔率下降 ${option.newOdds} < ${option.odds}`;
      return option;
    }

    const parts = itemId.split("|");
    parts[5] = "0.00";
    parts[6] = option.target === "Home" ? "0" : "1";
    const uniqueRequestId = pbUuid();

    option.data = {
      acceptBetterOdds: false,
      oddsFormat: 1,
      selections: [
        {
          odds: row.odds,
          oddsId: itemId,
          selectionId: `${row.lineId}|0|${parts.join("|")}`,
          stake,
          winRiskStake: "RISK",
          wagerType: "NORMAL",
          uniqueRequestId,
          betLocationTracking: {
            mainPages: "ESPORT",
            marketTab: "UNKNOWN",
            market: "UNKNOWN",
            view: "NEW_EUROPE_VIEW",
            navigation: "SPORTS",
            oddsContainerCategory: "MAIN",
            oddsContainerTitle: "UNKNOWN",
            marketType: "UNKNOWN",
            eventSorting: "UNKNOWN",
            pageType: "UNKNOWN",
            defaultPage: "UNKNOWN",
            reuseSelection: false,
            isLiveStreamPlaying: null,
            device: "DESKTOP",
            displayMode: "LIGHT",
            language: "zh_CN",
            timeZone: null,
          },
        },
      ],
      clientVersion: "master_9036928d",
    };
    return option;
  },

  async betting(account, option) {
    const selection = (option.data?.selections as Array<{ uniqueRequestId?: string }> | undefined)?.[0];
    if (!selection?.uniqueRequestId) {
      return new BetResult(account.provider, false, "requestId error");
    }

    let status: string | undefined;
    let body: PbBuyResponse | undefined;
    try {
      const path = `/bet-placement/buyV4?uniqueRequestId=${pbUuid()}&locale=zh_CN&_=${Date.now()}&withCredentials=true`;
      body = await pbPost<PbBuyResponse>(account, path, option.data, {
        "content-type": "application/json; charset=UTF-8",
      });
      status = body?.response?.[0]?.status;
      const errorCode = body?.response?.[0]?.errorCode;
      const ok = status === "ACCEPTED" || status === "PENDING_ACCEPTANCE";
      return new BetResult(account.provider, ok, errorCode ?? status ?? body?.errorMessage, undefined, body);
    } finally {
      if (status === "PENDING_ACCEPTANCE") {
        void startPbRejectPoll(account, Date.now());
      }
    }
  },
};
