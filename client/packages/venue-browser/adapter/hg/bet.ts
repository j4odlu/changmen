import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformProvider } from "../contract";
import { accountHgPost } from "./accountHttp";
import {
  hgTransformUrl,
  parseHgItemId,
  parseHgServerResponse,
  parseHgToken,
} from "./parse";

const HG_FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };

let oddsTypeEuropeSet = false;

function formBody(params: Record<string, string | number>): string {
  return new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  ).toString();
}

async function hgPost(
  account: Parameters<NonNullable<PlatformProvider["getBalance"]>>[0],
  params: Record<string, string | number>,
): Promise<string> {
  const token = parseHgToken(account.token);
  if (!account.gateway || !token) return "";
  const url = hgTransformUrl(account.gateway, token);
  const res = await accountHgPost<string>(account, url, formBody(params), HG_FORM_HEADERS);
  return typeof res.data === "string" ? res.data : String(res.data ?? "");
}

async function ensureOddsTypeEurope(
  account: Parameters<NonNullable<PlatformProvider["getBalance"]>>[0],
): Promise<void> {
  if (oddsTypeEuropeSet) return;
  const token = parseHgToken(account.token);
  if (!token) return;
  const xml = await hgPost(account, {
    p: "memSet",
    ver: token.ver,
    uid: token.uid,
    val: '{"odd_f_type":"E"}',
    langx: "zh-cn",
    action: "send",
  });
  if (xml.trim() === "1") oddsTypeEuropeSet = true;
}

export const hgProvider: PlatformProvider = {
  async getBalance(account) {
    try {
      const token = parseHgToken(account.token);
      if (!account.gateway || !token) return undefined;
      await ensureOddsTypeEurope(account);
      const xml = await hgPost(account, {
        p: "get_member_data",
        uid: token.uid,
        ver: token.ver,
        langx: "zh-cn",
        change: "all",
      });
      const body = parseHgServerResponse(xml);
      if (body.code === "error") return undefined;
      return {
        currency: body.currency || "CNY",
        balance: Number(body.maxcredit) || 0,
      };
    } catch {
      return undefined;
    }
  },

  async checkBet(account, option) {
    const token = parseHgToken(account.token);
    if (!account.gateway || !token) {
      option.checkError = "账号参数读取失败";
      return option;
    }

    const parts = parseHgItemId(option.itemId);
    const rtype = `${parts.wtype}${parts.team}`;
    const payload = {
      p: `${parts.gtype}_order_view`,
      uid: token.uid,
      ver: token.ver,
      langx: "zh-cn",
      odd_f_type: "E",
      gid: parts.gid,
      gtype: parts.gtype,
      wtype: parts.wtype,
      chose_team: parts.team,
    };
    option.request = payload;

    const xml = await hgPost(account, payload);
    const body = parseHgServerResponse(xml);
    option.response = body;

    if (body.code !== "501") {
      option.checkError = body.errormsg ?? String(body.code ?? "");
      return option;
    }

    option.data = {
      p: `${parts.gtype}_bet`,
      uid: token.uid,
      ver: token.ver,
      langx: "zh-cn",
      odd_f_type: "E",
      golds: option.betMoney,
      gid: parts.gid,
      gtype: parts.gtype,
      wtype: parts.wtype,
      rtype,
      chose_team: parts.team,
      ioratio: body.ioratio,
      con: body.con,
      ratio: body.ratio,
      autoOdd: "Y",
      timestamp: Date.now(),
      timestamp2: "",
      isRB: "Y",
      imp: "N",
      ptype: "",
      isYesterday: "N",
      f: "1R",
    };
    return option;
  },

  async betting(account, option) {
    const token = parseHgToken(account.token);
    if (!token || !option.data) {
      return new BetResult(account.provider, false, "账号参数错误", option.data);
    }

    const xml = await hgPost(account, option.data as Record<string, string | number>);
    const body = parseHgServerResponse(xml);
    const ok = body.code === "560";
    const message = ok ? `余额:${body.nowcredit}` : body.errormsg || body.code;
    return new BetResult(account.provider, ok, message, option.data, body);
  },
};
