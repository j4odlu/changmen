import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: true,
  prepare: vi.fn(),
  boot: vi.fn(),
  loadTags: vi.fn(),
  startBalance: vi.fn(),
  startMain: vi.fn(),
}));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({
  preparePolymarketAccountRuntimes: mocks.prepare,
  applyPmAutoTransportOnLogin: async () => ({ marketWsMode: "relay" }),
}));
vi.mock("@changmen/venue-browser/adapter/predictfun", () => ({ applyPfAutoTransportOnLogin: vi.fn() }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => "session-1", isAuthSessionCurrent: () => mocks.current }));
vi.mock("@/extensions/arbOpportunity/syncArbRuntime", () => ({
  installArbRuntimeSync: vi.fn(), syncArbRuntime: vi.fn(), teardownArbRuntimeSync: vi.fn(),
}));
vi.mock("@/runtime/sessionBoot", () => ({ bootSessionRuntime: mocks.boot, stopSessionRuntime: vi.fn() }));
vi.mock("@/runtime/venueTransportSession", () => ({ applyVenueTransportRoutingOnLogin: vi.fn() }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({
  accounts: [], loadAccounts: vi.fn(), loadTagPlatforms: mocks.loadTags,
  startBalanceRefreshLoop: mocks.startBalance, stopBalanceRefreshLoop: vi.fn(),
}) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "user-1" }) }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => ({ startMainLoop: mocks.startMain }) }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({ start: vi.fn() }) }));
vi.mock("@/stores/oddsStore", () => ({ useOddsStore: vi.fn() }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: vi.fn() }));
vi.mock("@/stores/footballOrderStore", () => ({
  stopFootballOrderRuntime: vi.fn(),
  useFootballOrderStore: () => ({ loading: false, load: vi.fn(), syncVenueSettlement: vi.fn() }),
}));
vi.mock("@/security/pmVault", () => ({
  hasVault: async () => false, normalizePmVaultUserId: (id: string) => id,
  ensurePmVaultForAccounts: vi.fn(), mergeVaultKeysIntoAccounts: vi.fn(),
  migrateTokenPrivateKeysToVault: vi.fn(), lockPmVault: vi.fn(), resetPmVaultAccountUi: vi.fn(),
}));

import { mountAppSession } from "./appSession";
import { mountSportsSession, stopSportsSession } from "./sportsSession";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.current = true;
  mocks.prepare.mockResolvedValue([]);
});
afterEach(() => stopSportsSession());

function holdWalletPreparation() {
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  mocks.prepare.mockImplementationOnce(() => {
    entered();
    return new Promise<void>(resolve => { finish = resolve; });
  });
  return { started, finish: () => finish() };
}

describe("session cancellation while preparing PM wallets", () => {
  it("does not boot collectors after logout during wallet initialization", async () => {
    const wallet = holdWalletPreparation();
    const mounting = mountAppSession();
    await wallet.started;
    mocks.current = false;
    wallet.finish();
    await mounting;
    expect(mocks.boot).not.toHaveBeenCalled();
    expect(mocks.startMain).not.toHaveBeenCalled();
    expect(mocks.loadTags).not.toHaveBeenCalled();
  });

  it("does not fetch account metadata after sports unmount during wallet initialization", async () => {
    const wallet = holdWalletPreparation();
    const mounting = mountSportsSession();
    await wallet.started;
    stopSportsSession();
    wallet.finish();
    await mounting;
    expect(mocks.loadTags).not.toHaveBeenCalled();
    expect(mocks.startBalance).not.toHaveBeenCalled();
  });
});
