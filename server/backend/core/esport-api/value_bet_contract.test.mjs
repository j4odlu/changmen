import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ pool: null, getPool: vi.fn(), query: vi.fn(), matches: vi.fn(), now: 1000000 }));
vi.mock("@changmen/db", async original => ({ ...await original(), getPgPool: (...a) => m.getPool(...a), fetchClientMatches: (...a) => m.matches(...a) }));
vi.mock("../../../db/rds/common.js", async original => ({ ...await original(), getPgPool: (...a) => m.getPool(...a) }));
vi.mock("../account/admin_service.js", () => ({}));
vi.mock("../account/admin_leaderboard.js", () => ({}));
vi.mock("../account/report_service.js", () => ({}));
vi.mock("../auth/role_filter.js", () => ({}));
const load = () => import("./value_bet_service.js");
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); m.now = 1000000; m.pool = { query: m.query };
  m.getPool.mockImplementation(() => m.pool); m.query.mockResolvedValue({ rows: [] }); m.matches.mockResolvedValue([]);
  vi.spyOn(Date, "now").mockImplementation(() => m.now);
  for (const [k,v] of Object.entries({ VB_SHARP_PLATFORM: "PB", VB_SOFT_PLATFORMS: "OB,IM", VB_MIN_EDGE: "0.03", VB_KELLY_MULTIPLIER: "0.25", VB_MIN_ODDS: "1.4", VB_MAX_ODDS: "5" })) vi.stubEnv(k,v);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("value-bet dashboard published behavior", () => {
  it("keeps the empty-dashboard shape without configured storage", async () => {
    m.pool = null; const {getValueBetDashboard} = await load();
    expect(await getValueBetDashboard()).toEqual({ available: true, dbAvailable: false, signals: [], stats: [], platformDist: [], queriedAt: m.now,
      diagnostics: { matchCount: 0, totalBets: 0, betsWithSharp: 0, sharpPct: 0, platformCoverage: [], edgeDist: {}, topEdges: [],
        config: { sharpPlatform: "PB", softPlatforms: ["OB","IM"], minEdge: .03, kellyMultiplier: .25, minOdds: 1.4, maxOdds: 5 } } });
    expect(m.query).not.toHaveBeenCalled(); expect(m.matches).toHaveBeenCalledTimes(1);
  });
  it("keeps database row names and numeric strings unchanged", async () => {
    const signals=[{ id:"9007199254740993", edge:"0.12345", soft_platform:"OB", extra:"retained" }];
    const stats=[{status:"open",count:1,avg_edge:"0.12345",max_edge:"0.12345"}]; const platformDist=[{soft_platform:"OB",count:1,avg_edge:"0.12345"}];
    m.query.mockResolvedValueOnce({rows:signals}).mockResolvedValueOnce({rows:stats}).mockResolvedValueOnce({rows:platformDist});
    const result=await (await load()).getValueBetDashboard();
    expect(result).toMatchObject({available:true,dbAvailable:true,signals,stats,platformDist});
  });
  it("starts all three queries after match loading without serializing them", async () => {
    let finish; m.matches.mockImplementation(() => new Promise(resolve => { finish=resolve; }));
    const complete=[]; m.query.mockImplementation(() => new Promise(resolve => complete.push(resolve)));
    const pending=(await load()).getValueBetDashboard(); expect(m.getPool).toHaveBeenCalledTimes(1); expect(m.query).not.toHaveBeenCalled();
    finish([]); await vi.waitFor(() => expect(m.query).toHaveBeenCalledTimes(3));
    expect(m.query.mock.calls.map(c=>c[0])).toEqual([expect.stringContaining("ORDER BY edge DESC LIMIT 100"),expect.stringContaining("GROUP BY status ORDER BY status"),expect.stringContaining("GROUP BY soft_platform ORDER BY count DESC")]);
    for(const resolve of complete) resolve({rows:[]}); await expect(pending).resolves.toMatchObject({dbAvailable:true});
  });
  it.each([true,false])("captures database availability before awaiting matches (%s)", async available => {
    const pool=m.pool; m.pool=available?pool:null; let finish;
    m.matches.mockImplementation(() => new Promise(resolve => { finish=resolve; }));
    const pending=(await load()).getValueBetDashboard(); m.pool=available?null:pool; finish([]);
    expect((await pending).dbAvailable).toBe(available); expect(m.query).toHaveBeenCalledTimes(available?3:0);
  });
  it.each([0,1,2])("missing-table failure discards all partial query results (%s)", async index => {
    m.query.mockImplementation((...args) => m.query.mock.calls.length-1===index?Promise.reject(Object.assign(new Error("missing"),{code:"42P01"})):Promise.resolve({rows:[{partial:true}]}));
    expect(await (await load()).getValueBetDashboard()).toMatchObject({available:true,dbAvailable:false,signals:[],stats:[],platformDist:[]});
  });
  it.each(["42501","08006",undefined])("preserves non-missing-table errors (%s)", async code => {
    const error=Object.assign(new Error("synthetic query failure"),{code}); m.query.mockRejectedValue(error);
    await expect((await load()).getValueBetDashboard()).rejects.toBe(error);
  });
  it("does not query signals after match loading fails", async () => {
    const error=new Error("match snapshot failed"); m.matches.mockRejectedValue(error);
    await expect((await load()).getValueBetDashboard()).rejects.toBe(error); expect(m.query).not.toHaveBeenCalled();
  });
  it("caches even empty match snapshots for exactly eight seconds, not signal queries", async () => {
    const {getValueBetDashboard}=await load(); await getValueBetDashboard(); m.now+=7999; await getValueBetDashboard();
    expect(m.matches).toHaveBeenCalledTimes(1); m.now+=1; await getValueBetDashboard();
    expect(m.matches).toHaveBeenCalledTimes(2); expect(m.query).toHaveBeenCalledTimes(9);
  });
  it("retains diagnostics, locked-source filtering and odds calculations", async () => {
    m.matches.mockResolvedValue([{title:"A vs B",game:"cs2",bets:{Bets:[{Name:"Winner",Map:1,Sources:{PB:{HomeOdds:1.9,AwayOdds:1.9},OB:{HomeOdds:2.2,AwayOdds:1.8},IM:{HomeOdds:5,AwayOdds:5,Status:"Locked"}}}]}}]);
    const {diagnostics:d}=await (await load()).getValueBetDashboard();
    expect(d).toMatchObject({matchCount:1,totalBets:1,betsWithSharp:1,sharpPct:100,edgeDist:{neg:1,"10+":1}});
    expect(d.topEdges).toEqual([{edge:.1,platform:"OB",side:"Home",softOdds:2.2,fairOdds:2,sharpHome:1.9,sharpAway:1.9,match:"A vs B",game:"cs2",betName:"Winner",map:1},{edge:-.1,platform:"OB",side:"Away",softOdds:1.8,fairOdds:2,sharpHome:1.9,sharpAway:1.9,match:"A vs B",game:"cs2",betName:"Winner",map:1}]);
  });
  it("keeps ignoring sharp books without positive overround", async () => {
    m.matches.mockResolvedValue([{bets:[{Sources:{PB:{HomeOdds:2,AwayOdds:2},OB:{HomeOdds:2.2,AwayOdds:1.8}}}]}]);
    expect((await (await load()).getValueBetDashboard()).diagnostics).toMatchObject({betsWithSharp:1,topEdges:[]});
  });
  it("retains the real admin route success envelope", async () => {
    const {handleAdminAction}=await import("./admin_routes.ts");
    expect(await handleAdminAction("Client_AdminValueBet",{}, {user:{id:"operator"}})).toMatchObject({success:1,msg:"ok",info:{available:true,dbAvailable:true,queriedAt:m.now}});
  });
  it("retains real route rejection for its caller to handle", async () => {
    const error=new Error("synthetic route failure");m.query.mockRejectedValue(error);
    const {handleAdminAction}=await import("./admin_routes.ts");await expect(handleAdminAction("Client_AdminValueBet",{}, {user:{id:"operator"}})).rejects.toBe(error);
  });
});
