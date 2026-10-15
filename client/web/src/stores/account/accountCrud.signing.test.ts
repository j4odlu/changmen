import type { AccountStoreContext } from "./context";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), prepare: vi.fn(), track: vi.fn(), save: vi.fn(),
  migrate: vi.fn(), auth: "login-1", epoch: 0 }));
vi.mock("@/api/esport", () => ({ getAccounts: mocks.get, getTagPlatforms: vi.fn(), createTagPlatform: vi.fn(),
  deletePlayer: vi.fn(), saveAccounts: vi.fn(), saveSportAccount: vi.fn(), saveMoneyLog: vi.fn() }));
vi.mock("@/models/platformAccount", () => ({ PlatformAccount: class { constructor(row: object) { Object.assign(this, row); } } }));
vi.mock("@/stores/account/balanceRefresh", () => ({ refreshAllFromVenues: vi.fn(), startBalanceRefreshLoop: vi.fn() }));
vi.mock("@/stores/account/pbAccountHostsSync", () => ({ syncPbAccountHosts: vi.fn() }));
vi.mock("@/stores/account/betGateway", () => ({ resumePendingVenueConfirmations: vi.fn() }));
vi.mock("@/security/pmVault", () => ({ mergeVaultKeysIntoAccounts: vi.fn(), migrateTokenPrivateKeysToVault: mocks.migrate,
  normalizePmVaultUserId: String, refreshPmVaultAccountUi: vi.fn(), stripPrivateKeysForPersist: vi.fn() }));
vi.mock("@/security/pmVault/retainedPmSession", () => ({ getRetainedPmSessionEpoch: () => mocks.epoch,
  trackPmAccounts: mocks.track, removeRetainedPmAccount: vi.fn(), saveRetainedPmSession: mocks.save }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ preparePolymarketAccountRuntimes: mocks.prepare, warmAllPolymarketUserWs: vi.fn() }));
vi.mock("@changmen/venue-adapter/predictfun", () => ({}));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "u" }) }));
vi.mock("@/lib/authSession", () => ({ getAuthSessionVersion: () => mocks.auth, isAuthSessionCurrent: (version: string) => version === mocks.auth }));
import { loadAccounts } from "./accountCrud";
const store = () => ({ accounts: [], loading: false, loaded: false } as unknown as AccountStoreContext);
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth = "login-1"; mocks.epoch = 0;
  mocks.get.mockResolvedValue([{ accountId: 1, provider: "Polymarket", token: "credentials" }]);
  mocks.prepare.mockResolvedValue([]); mocks.migrate.mockResolvedValue(0);
});

it("registers loaded wallets for lock cleanup before starting asynchronous initialization", async () => {
  const state = store();
  await loadAccounts(state);
  expect(mocks.track).toHaveBeenCalledWith(state.accounts, "u");
  expect(mocks.track.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepare.mock.invocationCallOrder[0]);
  expect(mocks.prepare).toHaveBeenCalledWith(state.accounts);
  expect(state.loading).toBe(false);
});

it("discards an account response belonging to the previous login", async () => {
  let release!: (rows: unknown[]) => void;
  mocks.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const state = store(); const pending = loadAccounts(state);
  mocks.auth = "login-2";
  release([{ accountId: 1, provider: "Polymarket", token: "old-credentials" }]);
  await pending;
  expect(state.accounts).toEqual([]);
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});

it.each(["migration", "initialization"])("lock during %s cannot start or save obsolete wallet preparation", async phase => {
  if (phase === "migration") mocks.migrate.mockImplementationOnce(async () => { mocks.epoch++; return 0; });
  else mocks.prepare.mockImplementationOnce(async () => { mocks.epoch++; return []; });
  await loadAccounts(store());
  if (phase === "migration") expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
