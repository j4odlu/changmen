import { defineStore } from "pinia";
import type { VenueOrder, VenueOrderStatus } from "@changmen/venue-browser/adapter/contract";
import {
  getFootballOrders,
  getOpenFootballOrders,
  saveObFootballOrder,
  type FootballOrderDto,
} from "@/api/footballOrder";
import { saveOrders } from "@/api/order";
import {
  fetchObSportAccountOrderPatches,
  fetchObSportPendingOrderPatches,
  waitObSportVenueOrderHydration,
} from "@/runtime/obSportBetRecord";
import { pickObSportBetAccount } from "@/runtime/obSportBetAccount";
import { isPlaceholderTeam, type ObSportOrderStatusPatch } from "@/runtime/obSportOrderStatus";
import { readPodBetSettings } from "@/runtime/podBetSettings";
import {
  footballOrderSettledProfit,
  isFootballOrderPending,
  mergePodSportOrder,
  parsePodSportOrders,
  type PodSportOrder,
} from "@/runtime/podSportOrders";
import { accountOrderDisplayName } from "@/shared/accountDisplayName";
import { todayKey } from "@/shared/dateKey";
import { useAccountStore } from "@/stores/accountStore";

function asDto(row: PodSportOrder | FootballOrderDto): FootballOrderDto {
  return row;
}

function dateOf(row: Pick<FootballOrderDto, "at">): string {
  const at = Number(row.at) || 0;
  return todayKey(at > 0 ? new Date(at) : new Date());
}

function normalizeVenueKey(venue: unknown): string {
  return String(venue || "OB").trim() || "OB";
}

function isObFootballVenue(venue: unknown): boolean {
  return normalizeVenueKey(venue).toUpperCase() === "OB";
}

function toVenueOrderStatus(status: unknown): VenueOrderStatus {
  const s = String(status || "").trim().toLowerCase();
  if (s === "win")
    return "win";
  if (s === "lose")
    return "lose";
  if (s === "reject" || s === "rejected")
    return "reject";
  if (s === "return" || s === "void")
    return "return";
  if (s === "pending")
    return "pending";
  return "none";
}

function footballVenueOrderFromDto(row: FootballOrderDto, venue: string, source?: string): VenueOrder {
  const title = [row.home, row.away].map(v => String(v || "").trim()).filter(Boolean).join(" vs ");
  const stake = Number(row.stake) || 0;
  const odds = Number(row.odds) || 0;
  const orderSource = String(source || "").trim() || (row.auto ? "football-pod-auto" : "football-pod");
  return {
    provider: venue as VenueOrder["provider"],
    orderId: String(row.orderId || row.id || `${venue}-${Number(row.at) || Date.now()}`),
    odds,
    createAt: Number(row.at) || Date.now(),
    betMoney: stake,
    reward: stake > 0 && odds > 0 ? Math.round(stake * odds * 10000) / 10000 : 0,
    money: Number(row.profit) || 0,
    status: toVenueOrderStatus(row.status),
    game: "football",
    match: title || "足球",
    bet: String(row.marketLabel || "").trim(),
    item: String(row.sideLabel || "").trim(),
    domain: "sports",
    sport: "football",
    source: orderSource,
    podClientId: String(row.id || "").split("#PM#")[0].trim() || undefined,
    podPmMatchId: String(row.pmMatchId || "").trim() || undefined,
    ...(venue === "Polymarket" ? {
      pmTokenId: String(row.oid || "").trim() || undefined,
      pmConditionId: String(row.obMid || "").trim() || undefined,
      pmOrigin: "changmen" as const,
      pmSide: "buy" as const,
    } : {}),
  };
}

let loadSeq = 0;
let syncing = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const pendingPersists = new Map<string, FootballOrderDto>();

function persistKey(row: FootballOrderDto): string {
  return String(row.orderId || row.id || "").trim();
}

type FootballOrderAccount = {
  accountId?: number;
  playerName?: string;
  provider?: string;
};

type SaveOrderAccount = Parameters<typeof saveOrders>[0];

export function stopFootballOrderRuntime() {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  syncing = false;
  pendingPersists.clear();
}

/**
 * 足球订单：对齐电竞 orderStore（Pinia 内存 + 按日 RDS），不写 localStorage。
 * OB 足球写 football_orders；非 OB 足球按 orders 兼容存储，但必须带 domain=sports/sport=football。
 * 禁止写 PlatformAccount.today / unsettle / orderCount / winBalance（电竞账号条字段）。
 */
export const useFootballOrderStore = defineStore("footballOrders", {
  state: () => ({
    rows: [] as FootballOrderDto[],
    todayRows: [] as FootballOrderDto[],
    settlementRows: [] as FootballOrderDto[],
    loaded: false,
    loading: false,
    persistError: "",
    orderDate: todayKey(),
    filterAccountId: 0,
  }),
  getters: {
    count(): number {
      return this.todayRows.length;
    },
    todayStake(): number {
      let sum = 0;
      for (const row of this.todayRows)
        sum += Number(row.stake) || 0;
      return sum;
    },
    todayProfit(): number {
      let sum = 0;
      for (const row of this.todayRows)
        sum += footballOrderSettledProfit(row);
      return sum;
    },
    todayOpenStake(): number {
      let sum = 0;
      for (const row of this.todayRows) {
        if (isFootballOrderPending(row.status))
          sum += Number(row.stake) || 0;
      }
      return sum;
    },
    filteredRows(): FootballOrderDto[] {
      if (!this.filterAccountId)
        return this.rows;
      return this.rows.filter(row => Number(row.playerId) === this.filterAccountId);
    },
    accountOptions(): { value: number; label: string }[] {
      const accounts = useAccountStore().accounts;
      const seen = new Set(accounts.map(a => a.accountId));
      const opts = accounts.map(a => ({
        value: a.accountId,
        label: `${a.platformName || a.provider}/${accountOrderDisplayName(a)}`,
      }));
      for (const row of this.rows) {
        const pid = Number(row.playerId) || 0;
        if (!pid || seen.has(pid))
          continue;
        seen.add(pid);
        const name = String(row.accountName || "").trim() || `#${pid}`;
        const venue = String(row.venue || "OB").trim();
        opts.push({ value: pid, label: `${venue}/${name}` });
      }
      return [{ value: 0, label: "全部" }, ...opts];
    },
  },
  actions: {
    playerLabel(row: FootballOrderDto): string {
      const pid = Number(row.playerId) || 0;
      const acc = pid ? useAccountStore().findAccount(pid) : null;
      if (acc) {
        const platform = acc.platformName || acc.provider || row.venue || "OB";
        return `${platform} / ${accountOrderDisplayName(acc)}`;
      }
      const venue = String(row.venue || "OB").trim();
      const name = String(row.accountName || "").trim();
      if (name)
        return `${venue} / ${name}`;
      return pid ? `${venue} / #${pid}` : venue;
    },
    platformClass(row: FootballOrderDto): string | undefined {
      const pid = Number(row.playerId) || 0;
      const acc = pid ? useAccountStore().findAccount(pid) : null;
      if (acc?.active)
        return "Stop";
      return undefined;
    },
    mergeLocal(row: FootballOrderDto) {
      const next = asDto(row);
      if (!isObFootballVenue(next.venue))
        return;
      if (dateOf(next) === this.orderDate)
        this.rows = mergePodSportOrder(this.rows, next) as FootballOrderDto[];
      if (dateOf(next) === todayKey())
        this.todayRows = this.orderDate === todayKey()
          ? this.rows
          : mergePodSportOrder(this.todayRows, next) as FootballOrderDto[];
    },
    async load(date?: string) {
      const seq = ++loadSeq;
      this.loading = true;
      try {
        const nextDate = date || this.orderDate || todayKey();
        this.orderDate = nextDate;
        const today = todayKey();
        const [server, todayServer, openServer] = await Promise.all([
          getFootballOrders({ date: nextDate }),
          nextDate === today ? Promise.resolve(null) : getFootballOrders({ date: today }),
          // 兼容前端先于后端发布：旧后端不认识该增强 action 时，当天订单仍须正常显示。
          getOpenFootballOrders({ days: 7 }).catch(() => [] as FootballOrderDto[]),
        ]);
        if (seq !== loadSeq)
          return;
        this.rows = parsePodSportOrders(server) as FootballOrderDto[];
        this.todayRows = todayServer == null
          ? this.rows
          : parsePodSportOrders(todayServer) as FootballOrderDto[];
        this.settlementRows = parsePodSportOrders(openServer) as FootballOrderDto[];
        this.loaded = true;
        this.persistError = "";
        this.syncVenueSettlementSoon(100);
      }
      catch (err) {
        if (seq !== loadSeq)
          return;
        this.persistError = err instanceof Error ? err.message : String(err);
      }
      finally {
        if (seq === loadSeq)
          this.loading = false;
      }
    },
    async persist(row: FootballOrderDto) {
      const key = persistKey(row);
      try {
        const saved = await saveObFootballOrder(row);
        if (!saved || typeof saved !== "object")
          throw new Error("保存未返回订单");
        const next = asDto({ ...row, ...saved, id: saved.id || row.id });
        if (key)
          pendingPersists.delete(key);
        this.mergeLocal(next);
        this.persistError = "";
        return next;
      }
      catch (err) {
        this.persistError = err instanceof Error ? err.message : String(err);
        this.mergeLocal(row);
        if (key)
          pendingPersists.set(key, row);
        this.loading = false;
        return row;
      }
    },
    async flushPendingPersists() {
      for (const row of [...pendingPersists.values()])
        await this.persist(row);
    },
    async appendPlaced(
      row: PodSportOrder,
      account?: FootballOrderAccount | null,
    ) {
      return this.appendVenuePlaced(row, account, { venue: "OB", hydrateOb: true });
    },
    async appendVenuePlaced(
      row: PodSportOrder,
      account?: FootballOrderAccount | null,
      opts: { venue?: string; hydrateOb?: boolean; source?: string } = {},
    ) {
      const venue = normalizeVenueKey(opts.venue || row.venue || "OB");
      const picked = account || pickObSportBetAccount(
        useAccountStore().accounts,
        readPodBetSettings().followAccountIds[0] || readPodBetSettings().followAccountId,
      ) as FootballOrderAccount | null;
      const playerId = Number(row.playerId) || Number(picked?.accountId) || 0;
      // 对齐电竞：本地只作占位；队名/赔率等以官网注单为准，占位队名不落库
      const home = isPlaceholderTeam(row.home) ? "" : String(row.home || "").trim();
      const away = isPlaceholderTeam(row.away) ? "" : String(row.away || "").trim();
      const dto: FootballOrderDto = {
        ...row,
        home,
        away,
        status: row.status || "None",
        profit: Number(row.profit) || 0,
        venue,
        playerId,
        accountName: String(row.accountName || picked?.playerName || ""),
      };
      const orderId = String(dto.orderId || "").trim();
      if (isObFootballVenue(venue)) {
        // P0：下注接口成功后先落最小占位，不能等待场馆注单列表（最多约 4.8 秒）后才保存。
        const saved = await this.persist(dto);
        if (orderId && opts.hydrateOb !== false) {
          void waitObSportVenueOrderHydration({ orderId, playerId })
            .then(patches => this.applyVenueStatus(patches))
            .catch((err) => {
              if (import.meta.env?.DEV)
                console.warn("[football] wait venue order skipped", err);
            });
        }
        this.syncVenueSettlementSoon();
        return saved;
      }

      try {
        if (picked) {
          const saveAccount = picked as SaveOrderAccount;
          await saveOrders(saveAccount, [footballVenueOrderFromDto(dto, venue, opts.source)]);
        }
        this.persistError = "";
      }
      catch (err) {
        this.persistError = err instanceof Error ? err.message : String(err);
      }
      return dto;
    },
    async applyVenueStatus(
      patches: ObSportOrderStatusPatch[],
      opts: { discoverMissing?: boolean; playerId?: number } = {},
    ) {
      if (!patches.length)
        return;
      for (const patch of patches) {
        const orderId = String(patch.orderId || "").trim();
        if (!orderId)
          continue;
        const row = this.rows.find(item => item.orderId === orderId)
          || this.todayRows.find(item => item.orderId === orderId)
          || this.settlementRows.find(item => item.orderId === orderId);
        if (!row && !opts.discoverMissing)
          continue;
        const account = opts.playerId
          ? useAccountStore().findAccount(opts.playerId)
          : null;
        const nextStatus = patch.status || row?.status || "None";
        const nextProfit = patch.status && !isFootballOrderPending(patch.status)
          ? Number(patch.profit) || 0
          : (row ? Number(row.profit) || 0 : Number(patch.profit) || 0);
        const venueHome = patch.home && !isPlaceholderTeam(patch.home) ? patch.home : "";
        const venueAway = patch.away && !isPlaceholderTeam(patch.away) ? patch.away : "";
        const keepHome = row?.home && !isPlaceholderTeam(row.home) ? row.home : "";
        const keepAway = row?.away && !isPlaceholderTeam(row.away) ? row.away : "";
        const merged: FootballOrderDto = {
          ...(row || {
            id: `venue:OB:${orderId}`,
            orderId,
            at: Number(patch.at) || Date.now(),
            home: "",
            away: "",
            sideLabel: "",
            marketLabel: "",
            odds: 0,
            stake: 0,
            oid: "",
            obMid: "",
            auto: false,
            status: "None",
            profit: 0,
            venue: "OB",
            playerId: Number(opts.playerId) || 0,
            accountName: String(account?.playerName || ""),
          }),
          orderId,
          status: nextStatus,
          profit: nextProfit,
          home: venueHome || keepHome,
          away: venueAway || keepAway,
          ...(patch.odds && patch.odds > 1 ? { odds: patch.odds } : {}),
          ...(patch.stake && patch.stake > 0 ? { stake: patch.stake } : {}),
          ...(patch.sideLabel ? { sideLabel: patch.sideLabel } : {}),
          ...(patch.marketLabel ? { marketLabel: patch.marketLabel } : {}),
          ...(patch.oid ? { oid: patch.oid } : {}),
          ...(patch.obMid ? { obMid: patch.obMid } : {}),
          ...(patch.at && patch.at > 0 ? { at: patch.at } : {}),
        };
        if (
          row
          && row.status === merged.status
          && Number(row.profit) === Number(merged.profit)
          && Number(row.odds) === Number(merged.odds)
          && Number(row.stake) === Number(merged.stake)
          && row.home === merged.home
          && row.away === merged.away
          && row.sideLabel === merged.sideLabel
          && row.marketLabel === merged.marketLabel
        )
          continue;
        try {
          const saved = await saveObFootballOrder(merged);
          if (!saved || typeof saved !== "object")
            continue;
          const next = asDto({ ...merged, ...saved, id: saved.id || merged.id || orderId });
          if (!next.id)
            continue;
          this.mergeLocal(next);
          this.settlementRows = isFootballOrderPending(next.status)
            ? mergePodSportOrder(this.settlementRows, next) as FootballOrderDto[]
            : this.settlementRows.filter(item => String(item.orderId || "") !== orderId);
          this.persistError = "";
        }
        catch (err) {
          this.persistError = err instanceof Error ? err.message : String(err);
        }
      }
    },
    async syncVenueAccountOrders(playerId: number) {
      const pid = Math.round(Number(playerId) || 0);
      if (pid <= 0)
        return;
      await this.flushPendingPersists();
      try {
        const patches = await fetchObSportAccountOrderPatches(pid);
        await this.applyVenueStatus(patches, { discoverMissing: true, playerId: pid });
      }
      catch (err) {
        if (import.meta.env?.DEV)
          console.warn("[football] venue account orders skipped", err);
      }
    },
    async syncVenueSettlement() {
      if (syncing)
        return;
      const seen = new Set<string>();
      const pending: { orderId: string; playerId: number; at: number }[] = [];
      // 对齐电竞：持续扫未结算单；足球额外带最近历史未结，避免旧单停在 None。
      for (const row of [...this.todayRows, ...this.rows, ...this.settlementRows]) {
        if (String(row.venue || "OB").trim() !== "OB")
          continue;
        if (!isFootballOrderPending(row.status))
          continue;
        const orderId = String(row.orderId || "").trim();
        if (!orderId || seen.has(orderId))
          continue;
        seen.add(orderId);
        pending.push({ orderId, playerId: Number(row.playerId) || 0, at: Number(row.at) || 0 });
      }
      if (!pending.length)
        return;
      syncing = true;
      try {
        await this.flushPendingPersists();
        const patches = await fetchObSportPendingOrderPatches(pending);
        await this.applyVenueStatus(patches);
      }
      catch (err) {
        if (import.meta.env?.DEV)
          console.warn("[football] venue settlement skipped", err);
      }
      finally {
        syncing = false;
      }
    },
    syncVenueSettlementSoon(delayMs = 800) {
      if (settleTimer)
        clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        void this.syncVenueSettlement();
      }, delayMs);
    },
  },
});
