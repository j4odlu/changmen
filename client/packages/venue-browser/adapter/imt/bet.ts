import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformProvider } from "../contract";
import { useMessageStore } from "../shared/webBridge";

import { accountImtPost, accountImtPostJson } from "./accountHttp";
import { buildImtAccountHeaders, imtAccountUrl } from "./auth";

const IMT_STATUS: Record<number, string> = {
  400: "我们暂时无法处理您的请求，请稍候再试。",
  429: "您的请求过于频繁, 请稍后再试。",
  500: "我们暂时无法处理您的请求。您必须登录以访问此页。",
  503: "系统正在做维护",
  99998: "请重新登录尝试",
  99999: "我们暂时无法处理您的请求。请稍候再试。",
};

interface ImtBetInfoResponse {
  StatusCode?: number;
  wss?: Array<{ o?: number; eid?: number; m?: number; otid?: number; btid?: number; mlid?: number; wsid?: number; btsid?: number; h?: string; ortid?: number; spf?: string }>;
  bset?: Array<{ mab?: number; mib?: number }>;
}

export const imtProvider: PlatformProvider = {
  async getBalance(account) {
    try {
      const url = imtAccountUrl(account, "/mobilesitev2/api/Member/GetMemberBalance");
      const res = await accountImtPost<{ StatusCode?: number; ab?: number }>(
        account,
        url,
        "",
        buildImtAccountHeaders(account),
      );
      if (res.data?.StatusCode !== 100) return undefined;
      return {
        balance: Number(res.data.ab) || 0,
        currency: "CNY",
      };
    } catch {
      return undefined;
    }
  },

  async checkBet(account, option) {
    const url = imtAccountUrl(account, "/mobilesitev2/api/PlaceBet/GetBetInfo");
    const [spid, eid] = option.matchId.split(":").map(Number);
    const [map, btid, mlid] = option.betId.split(":").map(Number);
    const [btsid, wsid] = option.itemId.split(":").map(Number);

    const payload = {
      wss: [
        {
          spid,
          eid,
          btid,
          pid: 1,
          otid: 3,
          mlid,
          wsid,
          btsid,
          o: option.odds,
          spf: `gamenr=${map}`,
          md: 0,
          sid: 1,
          refid: mlid,
          wt: 1,
        },
      ],
      wt: 1,
    };

    const res = await accountImtPostJson<ImtBetInfoResponse>(
      account,
      url,
      payload,
      buildImtAccountHeaders(account),
    );
    const body = res.data;
    option.response = body;
    const foEntry = {
      id: option.itemId,
      odds: 0,
      isLock: true,
      betId: option.betId,
      time: Date.now(),
    };

    if (body?.StatusCode !== 100) {
      const code = body?.StatusCode ?? 0;
      option.checkError = IMT_STATUS[code] || `StatusCode:${code}`;
      saveVenueOdds(account.provider, foEntry);
      return option;
    }

    const live = body.wss?.[0];
    const liveOdds = Number(live?.o) || 0;
    option.newOdds = liveOdds;
    saveVenueOdds(account.provider, {
      ...foEntry,
      odds: liveOdds,
      isLock: false,
    });

    if (liveOdds - option.odds < -0.01) {
      option.checkError = `赔率变更为：${liveOdds}`;
      return option;
    }

    let betMoney = option.betMoney;
    if (liveOdds - option.odds > 0.01) {
      betMoney = Math.floor(betMoney * (option.odds / liveOdds));
    }

    const limits = body.bset?.[0];
    if (limits && (betMoney > (limits.mab ?? 0) || betMoney < (limits.mib ?? 0))) {
      option.checkError = useMessageStore().limitMessage(account, {
        match: option.match?.title,
        bet: option.bet?.getBetName(),
        odds: option.odds,
        betMoney: option.betMoney,
        limit: limits.mab ?? 0,
      });
      return option;
    }

    option.betMoney = betMoney;
    option.data = {
      s: betMoney,
      ws: {
        spid,
        eid: live?.eid,
        m: live?.m,
        otid: live?.otid,
        btid: live?.btid,
        mlid: live?.mlid,
        wsid: live?.wsid,
        btsid: live?.btsid,
        h: live?.h,
        o: live?.o,
        ortid: live?.ortid,
        spf: live?.spf,
        pid: 1,
      },
      sw: 1,
      fpf: "iPhone",
      vt: "v4",
    };
    return option;
  },

  async betting(account, option) {
    const url = imtAccountUrl(account, "/mobilesitev2/api/PlaceBet/SinglePlaceBet");
    const res = await accountImtPostJson<{ StatusCode?: number; ao?: number; ab?: number }>(
      account,
      url,
      option.data,
      buildImtAccountHeaders(account),
    );
    const body = res.data;
    const ok = body?.StatusCode === 100;
    const message = ok
      ? `实际赔率:${body.ao},余额:${body.ab}`
      : IMT_STATUS[body?.StatusCode ?? 0] || `StatusCode:${body?.StatusCode ?? "?"}`;
    return new BetResult(account.provider, ok, message, option.data, body);
  },
};
