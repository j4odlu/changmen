import type { ArbMarketWatchGroup } from "@/extensions/arbMarketWatch/watchSinks";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { LoseOrder } from "@/models/loseOrder";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbProgressPayload } from "@/stores/betting/autoBet/arbExecutionTrace";
import type { OrderRow } from "@/types/order";
import { defineStore } from "pinia";
import { sendMessage } from "@/api/esport";
import { isArbScanSkipSummary } from "@/domain/betting/describeArbPrepareSkip";
import { formatMarketWatchGroup } from "@/extensions/arbMarketWatch/formatMarketWatch";
import { formatArbProgressTelegramBody } from "@/extensions/notify/formatArbProgress";
import { classifyLinkId, formatDate, formatDateKey, formatLinkId, linkIdSourceLabel, percent, toFixed } from "@changmen/client-core/shared/format";
import { wait } from "@changmen/client-core/shared/wait";
import { useUserStore } from "@/stores/userStore";
import { makeupDisplayOdds } from "@/extensions/arbBet/makeupOddsBand";
import { NOTIFY_TYPES } from "@/types/notifyTypes";

/**
 * [A8 可证实] bundle 固定报表群 / 发布群（Gi 中 g4e / m4e）。
 * 暂停发往 A8 运营群；后期自建时改 chat id 并置 true。
 */
export const FIXED_BROADCAST_TELEGRAM_ENABLED = false;

/** 启用后替换为你自己的 Telegram 超级群/频道 chat_id */
export const REPORT_CHAT_ID = "-1001949068832";
export const PUBLISH_CHAT_ID = "-4855267884";
const DEDUP_PREFIX = "MSG_DEDUP:";

export interface BettingMessageLeg {
  account: PlatformAccount;
  result: BetResult;
  options: BetOption;
  reject?: boolean;
}

/** 比例 9999 单边模式：对侧不下单，Telegram 仍保持双腿版式 */
export interface BettingMessageSingleLegRatePeer {
  kind: "singleLegRate" | "lowOddsSingle";
  options: BetOption;
  platformLabel: string;
}

export type BettingMessagePeer = BettingMessageLeg | BettingMessageSingleLegRatePeer;

function isSingleLegRatePeer(
  leg: BettingMessagePeer,
): leg is BettingMessageSingleLegRatePeer {
  return "kind" in leg && (leg.kind === "singleLegRate" || leg.kind === "lowOddsSingle");
}

function htmlTitle(text: string, urgent = false) {
  return urgent ? `<b>🔴 ${text}</b>` : `<b>${text}</b>`;
}

/** 对齐 A8 `Gi.send` 的 `l`：下单类标题前缀 📣 + 双腿状态 */
function orderHtmlTitle(text: string, legStatus = "📣📣") {
  return `<b>📣${legStatus}${text}</b>`;
}

/** 对齐 A8 `Gi.send` 的 `d`：单腿成功/失败/拒单 */
function orderLegStatusEmoji(success?: boolean, rejected?: boolean) {
  if (rejected)
    return "🔴";
  return success ? "✅" : "❌";
}

function accountLine(acc: PlatformAccount) {
  return `${acc.platformName || acc.provider} / ${acc.playerName}`;
}

/** 对齐 A8 `Gi.send` 账号摘要行（含余额） */
function balanceAccountLine(acc: PlatformAccount) {
  const user = useUserStore();
  return `#${user.userName} ${acc.platformName || acc.provider}，账号：${acc.playerName}，余额：${toFixed(acc.balance ?? 0, 0).toLocaleString()}，场馆：${acc.provider}`;
}

function profitEmoji(n: number) {
  return n >= 0 ? "🟢" : "🔴";
}

/** 对齐 A8 Pinia `Gi`：Telegram 推送队列 + 去重 */
export const useMessageStore = defineStore("message", {
  state: () => ({
    running: false,
    telegramQueue: [] as string[],
    pushQueue: [] as string[],
    reportQueue: [] as string[],
    publishQueue: [] as string[],
  }),

  actions: {
    start() {
      if (this.running)
        return;
      this.running = true;
      void this.runLoop();
    },

    stop() {
      this.running = false;
      this.telegramQueue.length = 0;
      this.pushQueue.length = 0;
      this.reportQueue.length = 0;
      this.publishQueue.length = 0;
    },

    async runLoop() {
      while (this.running) {
        try {
          const user = useUserStore();
          const cfg = user.message;
          const telegram = this.telegramQueue.pop();
          if (telegram && cfg.telegramId) {
            await this.deliver(cfg.telegramId, telegram);
          }
          const push = this.pushQueue.pop();
          if (push && cfg.pushOrderId) {
            await this.deliver(cfg.pushOrderId, push);
          }
          if (FIXED_BROADCAST_TELEGRAM_ENABLED) {
            const report = this.reportQueue.pop();
            if (report)
              await this.deliver(REPORT_CHAT_ID, report);
            const publish = this.publishQueue.pop();
            if (publish)
              await this.deliver(PUBLISH_CHAT_ID, publish);
          }
          else {
            this.reportQueue.length = 0;
            this.publishQueue.length = 0;
          }
        }
        catch (err) {
          console.error("[messageStore]", err);
        }
        await wait(1000);
      }
    },

    async deliver(chatIds: string, text: string) {
      const ids = chatIds
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      await Promise.all(
        ids.map(chat_id =>
          sendMessage({ chat_id, text, parse_mode: "HTML" }).catch(() => false),
        ),
      );
    },

    /** typeIndex 对应 NOTIFY_TYPES；cooldownSec=0 表示不去重 */
    shouldNotify(typeIndex: number, key: string, cooldownSec = 1800) {
      if (cooldownSec === 0)
        return true;
      const storageKey = `${DEDUP_PREFIX}${typeIndex}:${key}`;
      const last = Number(sessionStorage.getItem(storageKey) || 0);
      if (Date.now() - last < cooldownSec * 1000)
        return false;
      sessionStorage.setItem(storageKey, String(Date.now()));
      return true;
    },

    enqueueTelegram(text: string) {
      this.telegramQueue.push(text);
    },

    enqueuePush(text: string) {
      this.pushQueue.push(text);
    },

    /** 对齐 A8 `Gi.send.BalanceMessage`：余额 ≥ maxBalance 时 Telegram 提醒 */
    balanceMessage(account: PlatformAccount, cooldownSec = 1800) {
      if (!account.maxBalance || (account.balance ?? 0) < account.maxBalance)
        return;
      const idx = NOTIFY_TYPES.indexOf("Balance");
      if (!this.shouldNotify(idx, String(account.accountId), cooldownSec))
        return;
      const body = [
        htmlTitle("余额超限提醒"),
        balanceAccountLine(account),
        `<blockquote>当前余额：${(account.balance ?? 0).toLocaleString()}，大于设定值：${account.maxBalance.toLocaleString()}</blockquote>`,
      ].join("\n");
      this.enqueueTelegram(body);
    },

    /** 对齐 A8 `Gi.send.ProfitMessage`：totalProfit ≥ maxProfit 时 Telegram 提醒 */
    profitMessage(account: PlatformAccount, cooldownSec = 1800) {
      if (
        !account.maxProfit
        || !account.totalProfit
        || account.totalProfit < account.maxProfit
        || account.pause
      ) {
        return;
      }
      const idx = NOTIFY_TYPES.indexOf("Profit");
      if (!this.shouldNotify(idx, String(account.accountId), cooldownSec))
        return;
      const body = [
        htmlTitle("账号盈利超过预设值"),
        balanceAccountLine(account),
        `<blockquote>当前盈利：${account.totalProfit.toLocaleString()}，大于设定值：${account.maxProfit.toLocaleString()}</blockquote>`,
      ].join("\n");
      this.enqueueTelegram(body);
    },

    collectMessage(platform: string, detail: string) {
      const idx = NOTIFY_TYPES.indexOf("Balance");
      if (!this.shouldNotify(idx, platform, 600))
        return;
      const body = [
        htmlTitle(`${platform} 本地采集发生错误`),
        `<blockquote>${detail}</blockquote>`,
      ].join("\n");
      this.enqueueTelegram(body);
    },

    /** 对齐 A8 `Gi.send.LimitMessage`：入队 Telegram 并返回 HTML 文案供 checkError */
    limitMessage(
      account: PlatformAccount,
      payload: {
        match?: string;
        bet?: string;
        odds: number;
        betMoney: number;
        limit: number;
      },
    ): string {
      const body = [
        htmlTitle("限红提醒"),
        accountLine(account),
        `<blockquote>${payload.match ?? ""} / ${payload.bet ?? ""}`,
        `买入金额：${payload.betMoney}@${payload.odds}`,
        `限红金额：${payload.limit}</blockquote>`,
      ].join("\n");
      this.enqueueTelegram(body);
      return body;
    },

    /** [A8 可证实] `Gi.send.DelayMessage`：耗时 ≥2s 时 Telegram 延迟提醒 */
    delayMessage(account: PlatformAccount, elapsedMs: number) {
      if (elapsedMs < 2000)
        return;
      const body = [
        htmlTitle("注单延迟收单提醒"),
        balanceAccountLine(account),
        `<blockquote>买入延迟：${toFixed(elapsedMs / 1000, 1)}秒</blockquote>`,
      ].join("\n");
      this.enqueueTelegram(body);
    },

    /**
     * [changmen 扩展] 套利执行进度报告（方案 A：与 A8 bettingMessage 并存）。
     */
    arbProgressMessage(payload: ArbProgressPayload) {
      const user = useUserStore();
      if (!user.message?.telegramId?.trim())
        return;
      if (user.message.notifyArbProgress !== true)
        return;

      if (payload.outcome === "skip" && isArbScanSkipSummary(payload.summary))
        return;

      const cooldown
        = payload.outcome === "fail"
          ? 120
          : payload.outcome === "skip"
            ? 300
            : 120;
      const storageKey = `${DEDUP_PREFIX}arb-progress:${payload.matchId}:${payload.betId}:${payload.outcome}:${payload.summary}`;
      const last = Number(sessionStorage.getItem(storageKey) || 0);
      if (Date.now() - last < cooldown * 1000)
        return;
      sessionStorage.setItem(storageKey, String(Date.now()));

      this.enqueueTelegram(formatArbProgressTelegramBody(payload));
    },

    /**
     * [changmen 扩展] 全盘口盯盘 Telegram（arbMarketWatch；与 arbProgressMessage 独立）。
     */
    marketWatchMessage(group: ArbMarketWatchGroup) {
      const user = useUserStore();
      if (!user.message?.telegramId?.trim())
        return;
      if (user.message.notifyArbOpportunity !== true)
        return;

      if (group.kind === "appeared") {
        const storageKey = `${DEDUP_PREFIX}arb-opp:appeared:${group.anchor}`;
        const last = Number(sessionStorage.getItem(storageKey) || 0);
        if (Date.now() - last < 600_000)
          return;
        sessionStorage.setItem(storageKey, String(Date.now()));
      }

      this.enqueueTelegram(formatMarketWatchGroup(group));
    },

    /**
     * @param linkId [changmen 扩展] 套利 Attempt linkId；有值时写入 Telegram（对齐 admin LinkID）
     */
    bettingMessage(legA: BettingMessagePeer, legB: BettingMessagePeer, linkId?: number) {
      const formatPeer = (leg: BettingMessagePeer) => {
        if (isSingleLegRatePeer(leg)) {
          if (leg.kind === "lowOddsSingle") {
            return [
              `${leg.platformLabel}（🎯 高赔腿）`, "<blockquote>",
              `参考方向：${leg.options.target}`,
              `参考赔率：${leg.options.newOdds || leg.options.odds}`,
              "预检通过，本侧按模式跳过下注；不补单。</blockquote>",
            ].join("\n");
          }
          return [
            `${leg.platformLabel}（比例 9999 单边模式）`,
            "<blockquote>",
            `买入队伍：${leg.options.target}`,
            `买入金额：${leg.options.betMoney}@${leg.options.odds}`,
            "买入结果：本侧不下单（对侧自动单边）",
            "备注信息：比例 9999</blockquote>",
          ].join("\n");
        }
        const lines = [
          accountLine(leg.account),
          "<blockquote>",
          `买入队伍：${leg.options.target}`,
          `买入金额：${leg.options.betMoney}@${leg.options.odds}`,
          `买入结果：${leg.result.pending ? "⏳ 待确认" : leg.result.success ? "✅ 成功" : "❌ 失败"}`,
        ];
        if (leg.result.success && !leg.result.pending) {
          lines.push(`是否拒单：${leg.reject ? "🔴是" : "否"}`);
        }
        lines.push(`备注信息：${leg.result.message ?? "N/A"}</blockquote>`);
        return lines.join("\n");
      };

      const peerStatusEmoji = (leg: BettingMessagePeer) => {
        if (isSingleLegRatePeer(leg))
          return "⏭";
        return orderLegStatusEmoji(leg.result.success, leg.reject);
      };

      const legStatus = [peerStatusEmoji(legA), peerStatusEmoji(legB)].join("");
      const matchTitle = legA.options.match?.title ?? legB.options.match?.title ?? "";
      const betName
        = legA.options.bet?.getBetName?.() ?? legB.options.bet?.getBetName?.() ?? "";
      // 完整数字便于排障；徽标与 admin 类型标签对齐
      const linkLine = (() => {
        const n = Number(linkId);
        if (!Number.isFinite(n) || n === 0)
          return "";
        const kind = linkIdSourceLabel(classifyLinkId(n));
        const badge = formatLinkId(n);
        const full = String(n);
        return kind
          ? `LinkID：${full}${badge !== full ? `（${badge} · ${kind}）` : `（${kind}）`}`
          : `LinkID：${full}`;
      })();

      const body = [
          orderHtmlTitle("下单提醒", legStatus),
          `${matchTitle} / ${betName}`,
          ...(linkLine ? [linkLine] : []),
          "",
          formatPeer(legA),
          formatPeer(legB),
        ].join("\n");
      this.enqueueTelegram(body);

      const homeLeg = [legA, legB].find(
        leg => leg.options.target === "Home" && !isSingleLegRatePeer(leg),
      );
      const awayLeg = [legA, legB].find(
        leg => leg.options.target === "Away" && !isSingleLegRatePeer(leg),
      );
      if (homeLeg && awayLeg && !isSingleLegRatePeer(homeLeg) && !isSingleLegRatePeer(awayLeg)) {
        const implied = 1 / (1 / homeLeg.options.odds + 1 / awayLeg.options.odds);
        const homePlatform = homeLeg.account.platformName || homeLeg.account.provider;
        const awayPlatform = awayLeg.account.platformName || awayLeg.account.provider;
        this.enqueuePush(
          [
            "<b>📣赛事推单</b>",
            `<b>⚽️赛事：${matchTitle}</b>`,
            `<b>1️⃣[${homePlatform}] 主队赔率：${homeLeg.options.odds}</b>`,
            `<b>2️⃣[${awayPlatform}] 客队赔率：${awayLeg.options.odds}</b>`,
            `<b>本单对冲利润：${percent(implied)}（投100块可无风险获利${toFixed(implied * 100 - 100, 2)}元利润）</b>`,
          ].join("\n"),
        );
      }
    },

    loseOrderMessage(
      account: PlatformAccount,
      order: LoseOrder,
      option: BetOption,
      rejected: boolean,
    ) {
      const matchTitle = option.match?.title ?? order.match;
      const betName = option.bet?.getBetName?.() ?? order.bet;
      const body = [
        htmlTitle("补单提醒", rejected),
        accountLine(account),
        `${matchTitle} / ${betName} / ${option.target}`,
        "<blockquote>",
        `原订单时间：${formatDate(order.createAt)}`,
        `原补单金额：${order.getBetMoney(order.betOdds)}@${makeupDisplayOdds(order, useUserStore().config.makeProfit, useUserStore().extensionPrefs?.makeupOddsBand)}`,
        `补单金额：${option.betMoney}@${option.odds}`,
        `是否拒单：${rejected ? "🔴是" : "否"}`,
        "</blockquote>",
      ].join("\n");
      this.enqueueTelegram(body);
    },

    orderReportMessage(accounts: PlatformAccount[], orders: OrderRow[]) {
      if (!orders.length)
        return;
      const today = formatDateKey();
      const firstDay = formatDateKey(new Date(Number(orders[0].CreateAt) || Date.now()));
      const reportIdx = NOTIFY_TYPES.indexOf("OrderReport");
      if (firstDay !== today || !this.shouldNotify(reportIdx, "ORDERREPORT", 3600))
        return;

      const totalProfit = orders.reduce((sum, r) => sum + (Number(r.Money) || 0), 0);
      const lines = [
        htmlTitle(`${today} 统计报表`),
        `总余额：${Math.round(accounts.reduce((s, a) => s + (a.balance ?? 0), 0)).toLocaleString()} 盈亏：${profitEmoji(totalProfit)}${Math.round(totalProfit).toLocaleString()} 总订单：${orders.length} 未结订单：${accounts.reduce((s, a) => s + (a.unsettle ?? 0), 0)}`,
        "",
      ];
      for (const acc of accounts) {
        lines.push(
          accountLine(acc),
          "<blockquote>",
          `盈亏:${profitEmoji(acc.today ?? 0)}${Math.round(acc.today ?? 0).toLocaleString()}，总盈亏：${toFixed(acc.totalProfit ?? 0, 0)}，`,
          `订单：${acc.orderCount ?? 0}笔，未结：${acc.unsettle ?? 0}笔`,
          "</blockquote>",
        );
      }
      const text = lines.join("\n");
      this.enqueueTelegram(text);
      if (FIXED_BROADCAST_TELEGRAM_ENABLED) {
        this.reportQueue.push(text);
      }
    },

    async publishLoseOrderMessage() {
      if (!FIXED_BROADCAST_TELEGRAM_ENABLED)
        return;
      const user = useUserStore();
      if (!user.setting?.Publisher)
        return;
      const { useLoseOrderStore } = await import("@/stores/loseOrderStore");
      const loseStore = useLoseOrderStore();
      const lines = [htmlTitle(`[${user.userName}] 补单队列变化`)];
      for (const order of loseStore.orders.values()) {
        lines.push("<blockquote>", order.match, order.bet, `目标：${order.target}`, "</blockquote>");
      }
      if (lines.length <= 1)
        return;
      this.publishQueue.push(lines.join("\n"));
    },
  },
});
