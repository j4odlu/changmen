import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { applyGtcCommand, createGtcExecution } from "@changmen/shared/pm_gtc";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { gtcProgress, startGtcRuntime, stopGtcRuntime } from "@/orderModes/gtc/runtime";
import { updateVenueOrders } from "@/stores/account/venueOrders";

const mocks = vi.hoisted(() => ({ list: vi.fn(), command: vi.fn(), getOrders: vi.fn(), save: vi.fn(), update: vi.fn(), mark: vi.fn(), accounts: [] as unknown[] }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => true }));
vi.mock("./ordersApi", () => ({ saveOrders: mocks.save, refreshGtcOrders: vi.fn(async () => {}) }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ refreshOrderListAfterBind: vi.fn() }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ getOrders: mocks.getOrders }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner", extensionPrefs: { pmArbOrderMode: "FOK", pmGtcV1Participant: true } }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: (id: number) => mocks.accounts.find(a => (a as { accountId: number }).accountId === id), updateVenueOrders: mocks.update }) }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: mocks.mark }));
vi.mock("@/orderModes/gtc/api", () => ({ listGtc: mocks.list, commandGtc: mocks.command }));
const gtcLink = 1791558222471; const fokLink = 1791559000999;
function record() {
  const plan = { playerId: 1, otherPlayerId: 2, shares: "10", tokenId: "token", orderHash: `0x${"a".repeat(64)}`, betRowId: 2, target: "Home", otherTarget: "Away", otherProvider: "RAY", otherOdds: 2, otherStake: 100, otherVenueMatchId: "old-gtc-match", otherVenueItemId: "old-gtc-item", originalPmLeg: "B", linkId: gtcLink } as GtcPlan;
  const row = createGtcExecution("old-gtc", "owner", "wallet", "maker", plan, Date.now() - 60000);
  row.decision = "closed"; row.manual = true;
  row.other = { state: "unknown", orderId: null, submittedAt: Date.now() - 60000, message: "POST timeout" };
  return row;
}
function newFokOrder() {
  return { provider: "RAY", orderId: "new-fok-ray-leg", status: "none", odds: 2, betMoney: 100, createAt: Date.now(), link: fokLink, venueMatchId: "new-fok-match", venueItemId: "new-fok-item", money: 0, reward: 0, match: "new FOK match", bet: "Full", item: "Home", game: "CS2" } as VenueOrder;
}
beforeEach(() => {
  stopGtcRuntime(); vi.clearAllMocks();
  mocks.accounts = [new PlatformAccount({ accountId: 2, playerName: "RAY account", provider: "RAY" })];
  mocks.update.mockImplementation(updateVenueOrders);
  mocks.command.mockImplementation(async (row: GtcExecution, command: GtcCommand) => applyGtcCommand(row, command, Date.now()));
  mocks.save.mockResolvedValue(undefined);
  mocks.getOrders.mockImplementation(async () => [newFokOrder()]);
});
afterEach(() => stopGtcRuntime());
it("unresolved old GTC cannot save or bind a newer unrelated FOK order while current mode is FOK", async () => {
  mocks.list.mockResolvedValue([record()]); startGtcRuntime("owner");
  await vi.waitFor(() => expect(mocks.getOrders).toHaveBeenCalledOnce());
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(gtcProgress.records[0]!.other.state).toBe("unknown");
});
it("known GTC ID selects only its own order and preserves every FOK row", async () => {
  const row = record(); row.other.orderId = "old-gtc-ray-leg";
  const fok = newFokOrder(); const original = { ...newFokOrder(), orderId: "old-gtc-ray-leg", link: 123 };
  mocks.getOrders.mockResolvedValue([fok, original]);
  mocks.list.mockResolvedValue([row]); startGtcRuntime("owner");
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0]![1]).toEqual([{ ...original, link: gtcLink, pmGtcExecutionId: row.id }]);
  expect(fok.link).toBe(fokLink); expect(original.link).toBe(123);
  expect(mocks.update).not.toHaveBeenCalled();
});
