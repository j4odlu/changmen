import type { BetOption } from "@changmen/client-core/models/betOption";
import { parseVenueCreateAt } from "@changmen/shared/time/match_time";
import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformProvider, VenueOrder, VenueOrderStatus } from "../contract";
import { accountTfGet, accountTfPost } from "./accountHttp";
import { getCurrency } from "@changmen/shared/currency";
import { parseTfItemId, tfOddsPayload } from "./parse";
import { PLATFORMS } from "../shared/platforms";

interface TfProbeResponse {
  code?: number;
  msg?: string;
  value?: string;
  member_odds?: string | number;
  member_odds_style?: string;
}

interface TfTransactionsResponse {
  results?: Array<Record<string, unknown>>;
}

function parseEuroFromProbeValue(value: unknown): number {
  const text = String(value ?? "");
  const m = /^([0-9.]+)/.exec(text);
  return m ? Number(m[1]) : 0;
}

function buildTicket(option: BetOption, euroOdds: number) {
  const { selection } = parseTfItemId(option.itemId);
  const { odds, memberOdds } = tfOddsPayload(euroOdds);
  return {
    amount: option.betMoney.toFixed(2),
    accept_any_odds: false,
    tickets: [
      {
        market_id: option.betId,
        bet_type_selection: selection,
        odds,
        member: {
          odds: memberOdds,
          odds_type: "euro",
        },
      },
    ],
  };
}

function formatDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mapTfOrderStatus(raw: unknown): VenueOrderStatus {
  switch (String(raw ?? "")) {
    case "win":
      return "win";
    case "loss":
      return "lose";
    case "cancelled":
      return "return";
    default:
      return "none";
  }
}

export const tfProvider: PlatformProvider = {
  async getBalance(account) {
    try {
      const res = await accountTfGet<{ currency?: string; balance?: number }>(
        account,
        "/api/game-client/v8/wallet/",
      );
      const data = res.data;
      if (!data?.currency) return undefined;
      return {
        currency: getCurrency(data.currency),
        balance: Number(data.balance) || 0,
      };
    } catch {
      return undefined;
    }
  },

  async checkBet(account, option) {
    const { selection } = parseTfItemId(option.itemId);

    if (!option.loseOrder) {
      let probe: { status: number; data: TfProbeResponse };
      try {
        probe = await accountTfPost<TfProbeResponse>(
          account,
          "/api/game-client/v8/single-bet/",
          {
            amount: "11.00",
            accept_any_odds: false,
            tickets: [
              {
                market_id: option.betId,
                bet_type_selection: selection,
                odds: "-0.05",
                member: { odds: "21", odds_type: "euro" },
              },
            ],
          },
          { forceDirect: true },
        );
      } catch (err) {
        const resp = (err as { response?: unknown })?.response ?? err;
        option.response = resp;
        option.checkError = err instanceof Error ? err.message : String(err);
        option.updateOdds(0);
        return option;
      }

      const body = probe.data;
      option.response = body;
      const oddsPattern = /^([0-9.]+)/;

      if (body.code === 4 && oddsPattern.test(String(body.value ?? ""))) {
        const liveOdds = parseEuroFromProbeValue(body.value);
        option.updateOdds(liveOdds);
        if (option.odds > liveOdds + 0.01) {
          option.checkError = `${body.msg ?? ""} ${body.value ?? ""}`.trim();
          return option;
        }
        option.odds = liveOdds;
      } else {
        option.checkError = body.msg || "预检失败";
        option.updateOdds(0);
        return option;
      }
    }

    option.data = buildTicket(option, option.odds);
    return option;
  },

  async getOrders(account): Promise<VenueOrder[]> {
    const tz = "Asia%2FShanghai";
    const current = await accountTfGet<TfTransactionsResponse>(
      account,
      `/api/v8/transactions/?transaction_type=current&timing=all&page=1&page_size=20&timezone=${tz}&lang=zh`,
      { signed: true, forceDirect: true },
    );
    if (current.status !== 200) return [];

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const from = formatDateYmd(yesterday);
    const to = formatDateYmd(new Date());

    const history = await accountTfGet<TfTransactionsResponse>(
      account,
      `/api/v8/transactions/?transaction_type=history&from_date=${from}&to_date=${to}&page=1&page_size=20&timezone=${tz}&lang=zh`,
      { signed: true, forceDirect: true },
    );
    if (history.status !== 200) return [];

    const orders: VenueOrder[] = [];
    for (const batch of [current.data, history.data]) {
      for (const row of batch?.results ?? []) {
        const tickets = (row.tickets ?? []) as Array<Record<string, unknown>>;
        const ticket = tickets[0];
        if (!ticket) continue;

        const amount = Number(row.amount) || 0;
        let reward = 0;
        let money = 0;
        const status = mapTfOrderStatus(row.result_status);
        if (status === "lose") {
          money = -amount;
        } else if (status === "win") {
          reward = Number(row.earnings) || 0;
          money = reward - amount;
        }

        orders.push({
          provider: PLATFORMS.TF,
          orderId: String(row.ticket_num ?? ""),
          odds: Number(row.euro_odds) || 0,
          createAt: parseVenueCreateAt(row.date_created),
          betMoney: amount,
          reward,
          money,
          status,
          game: String(ticket.game_name ?? ""),
          match: String(ticket.event_name ?? ""),
          bet: String(ticket.game_market_name ?? ""),
          item: String(ticket.bet_type_selection_name ?? ""),
        });
      }
    }
    return orders;
  },

  async betting(account, option) {
    let res: { status: number; data: TfProbeResponse };
    try {
      res = await accountTfPost<TfProbeResponse>(
        account,
        "/api/game-client/v8/single-bet/",
        option.data,
      );
    } catch (err) {
      const body = (err as { data?: TfProbeResponse })?.data;
      const message = err instanceof Error ? err.message : String(err);
      return new BetResult(account.provider, false, message, option.data, body ?? err);
    }

    const body = res.data;
    let newOdds = 0;
    if (body?.code === 16 && body.value) {
      newOdds = Number(body.value) || 0;
    } else if (body?.member_odds_style === "euro" && body.member_odds) {
      newOdds = Number(body.member_odds) || 0;
    } else if (body?.code === 4 && body.value) {
      newOdds = parseEuroFromProbeValue(body.value);
    }

    option.updateOdds(Number(newOdds.toFixed(2)));
    const ok = res.status === 201;
    const message = ok
      ? `实际赔率:${body?.member_odds ?? newOdds}`
      : `${body?.msg ?? "下单失败"} ${body?.value ?? ""}`.trim();
    return new BetResult(account.provider, ok, message, option.data, body ?? res);
  },
};
