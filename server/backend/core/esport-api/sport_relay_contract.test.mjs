import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({configured:true,available:true,ttl:900,now:1000000,query:vi.fn(),init:vi.fn(),getPool:vi.fn(),hasConfig:vi.fn(),sign:vi.fn(),fetch:vi.fn()}));
vi.mock("@changmen/db", async original=>({...await original(),hasDatabaseUrlConfig:()=>m.hasConfig(),initDatabaseUrl:()=>m.init(),getPgPool:(...a)=>m.getPool(...a)}));
vi.mock("../../../../rds/resolve_database_url.js",async original=>({...await original(),hasDatabaseUrlConfig:()=>m.hasConfig(),initDatabaseUrl:()=>m.init()}));
vi.mock("../../../../rds/pg_pool.js",async original=>({...await original(),getPgPool:(...a)=>m.getPool(...a)}));
vi.mock("../../../../rds/rds/jwt.js",async original=>({...await original(),get JWT_ACCESS_TTL_SEC(){return m.ttl;},signJwt:(...a)=>m.sign(...a)}));
vi.mock("./sport_list_cache.js",()=>({readFreshSportListCache:()=>null,readSportListCache:()=>null,writeSportListCache:vi.fn()}));
const envKeys=["PROBE_TOKEN","ESPORT_TEST_TOKEN","PREDICT_FUN_HTTP_RELAY_TOKEN","HK_RELAY_ORIGIN","VITE_HK_RELAY_ORIGIN","VITE_PM_HK_RELAY_ORIGIN","VITE_PREDICT_FUN_API_KEY"];
const request=async(key="test")=>(await import("./sport_predictfun_fetch.js")).fetchPredictFunSportAsClientMatchDtos({gameCode:"mlb",cacheKey:key});
const tokens=()=>m.fetch.mock.calls.filter(([url])=>url.includes("/esport/http-relay")).map(([,options])=>options.headers.token);
beforeEach(()=>{
  vi.resetModules();vi.resetAllMocks();m.configured=true;m.available=true;m.ttl=900;m.now=1000000;
  for(const key of envKeys)vi.stubEnv(key,"");
  vi.stubEnv("PREDICT_FUN_API_KEY","synthetic-api-key");vi.stubEnv("PREDICT_FUN_HTTP_RELAY_ORIGIN","https://relay.invalid/");vi.stubEnv("JWT_SECRET","synthetic-secret-at-least-sixteen");
  m.hasConfig.mockImplementation(()=>m.configured);m.getPool.mockImplementation(()=>m.available?{query:m.query}:null);m.query.mockResolvedValue({rows:[{id:" user-id "}]});
  m.sign.mockReturnValue("synthetic-signed-token");m.fetch.mockImplementation(async url=>{if(!url.includes("/esport/http-relay"))throw new Error("synthetic direct failure");return new Response(JSON.stringify({data:[]}));});
  vi.stubGlobal("fetch",m.fetch);vi.spyOn(Date,"now").mockImplementation(()=>m.now);vi.spyOn(console,"warn").mockImplementation(()=>{});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("Predict.fun relay published behavior",()=>{
  it("does not read an identity or sign a token when direct HTTP succeeds",async()=>{
    m.fetch.mockResolvedValue(new Response(JSON.stringify({data:[]})));expect(await request()).toEqual([]);expect(m.query).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled();
  });
  it.each(["PROBE_TOKEN","ESPORT_TEST_TOKEN","PREDICT_FUN_HTTP_RELAY_TOKEN"])("uses the configured %s before database lookup",async key=>{
    vi.stubEnv(key," configured-token ");expect(await request()).toEqual([]);expect(tokens()).toEqual(["configured-token"]);expect(m.hasConfig).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled();
  });
  it("keeps environment token precedence",async()=>{
    for(const [index,key]of ["PROBE_TOKEN","ESPORT_TEST_TOKEN","PREDICT_FUN_HTTP_RELAY_TOKEN"].entries())vi.stubEnv(key,"token-"+index);
    await request();expect(tokens()).toEqual(["token-0"]);
  });
  it("keeps ordered profile selection, token claims and relay headers",async()=>{
    await request();expect(m.getPool).toHaveBeenCalledWith("sport-pf-relay");expect(m.query.mock.calls[0][0]).toContain("ORDER BY p.id LIMIT 1");
    expect(m.sign).toHaveBeenCalledWith({sub:"user-id",typ:"access",session_id:"sport-predictfun-fetch"},"synthetic-secret-at-least-sixteen",900);
    const [url,options]=m.fetch.mock.calls[1];expect(url).toBe("https://relay.invalid/esport/http-relay");
    expect(options.headers).toMatchObject({Accept:"application/json",token:"synthetic-signed-token","x-api-key":"synthetic-api-key","x-proxy-referer":"https://predict.fun/","x-proxy-origin":"https://predict.fun"});expect(options.headers["x-proxy-url"]).toContain("/v1/categories?");
    expect(m.init.mock.invocationCallOrder[0]).toBeLessThan(m.query.mock.invocationCallOrder[0]);expect(m.query.mock.invocationCallOrder[0]).toBeLessThan(m.sign.mock.invocationCallOrder[0]);
  });
  it.each([[7200,3600],[0,3600],[120,120]])("preserves TTL cap/fallback for %s",async(raw,expected)=>{m.ttl=raw;await request();expect(m.sign.mock.calls[0][2]).toBe(expected);});
  it("refreshes cached tokens at the exact sixty-second margin",async()=>{
    m.ttl=120;await request("one");m.now+=59999;await request("two");expect(m.query).toHaveBeenCalledTimes(1);
    m.now+=1;await request("three");expect(m.query).toHaveBeenCalledTimes(2);expect(m.fetch).toHaveBeenCalledTimes(4);
  });
  it("uses cached token before checking a subsequently missing secret",async()=>{
    await request("one");vi.stubEnv("JWT_SECRET","");await request("two");expect(tokens()).toEqual(["synthetic-signed-token","synthetic-signed-token"]);expect(m.query).toHaveBeenCalledTimes(1);
  });
  it.each(["short-secret","no-config","no-pool","empty-profile","blank-id"])("keeps missing identity/config behavior: %s",async state=>{
    if(state==="short-secret")vi.stubEnv("JWT_SECRET","short");if(state==="no-config")m.configured=false;if(state==="no-pool")m.available=false;
    if(state==="empty-profile")m.query.mockResolvedValue({rows:[]});if(state==="blank-id")m.query.mockResolvedValue({rows:[{id:"  "}]});
    await expect(request()).rejects.toThrow("http-relay 需要 PROBE_TOKEN 或可签发 JWT（JWT_SECRET + RDS）");expect(tokens()).toEqual([]);expect(m.sign).not.toHaveBeenCalled();
    if(state==="short-secret"||state==="no-config")expect(m.init).not.toHaveBeenCalled();
  });
  it.each(["init","query","sign"])("retains caught %s failure without caching a failed token",async stage=>{
    const error=new Error("synthetic "+stage+" failure");m[stage].mockImplementationOnce(()=>{throw error;});
    await expect(request("failed")).rejects.toThrow("http-relay 需要");expect(console.warn).toHaveBeenCalledWith("[sportPf] relay JWT skipped",error.message);
    await expect(request("retry")).resolves.toEqual([]);expect(tokens()).toEqual(["synthetic-signed-token"]);
  });
  it("preserves relay HTTP failure text",async()=>{
    m.fetch.mockImplementation(async url=>{if(!url.includes("/esport/http-relay"))throw new Error("direct");return new Response("synthetic relay rejection",{status:401});});
    await expect(request()).rejects.toThrow("synthetic relay rejection");
  });
});
