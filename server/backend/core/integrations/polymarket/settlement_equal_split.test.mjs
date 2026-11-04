import { expect, test, vi } from "vitest";
import { computePolymarketSettlementFromOrderRaw, computePolymarketSettlement, enrichMarketsFromClob, mapDbStatus } from "./settlement.js";
const condition="0x"+"a".repeat(64);
for(const version of ["v1","v2"]){
  const asset=version==="v2"?"201":"101";
  const market={version,conditionId:condition,closed:true,outcomePrices:'["0.5","0.5"]',
    ...(version==="v2"?{positionIds:["201","202"],clobTokenIds:'["101","102"]'}:{clobTokenIds:'["101","102"]'}),
    finalResolution:{condition_id:condition,status:"resolved",payouts:[500000,500000]}};
  test.each([[40,10,"win"],[60,-10,"lose"],[50,0,"return"]])(`${version} backend uses final half payout with cost %j`,(cost,money,status)=>{
    const raw={pmTokenId:asset,pmConditionId:condition,pmShares:100};
    expect(computePolymarketSettlementFromOrderRaw(raw,market,cost)).toEqual({status,money,reward:50,kind:"equal_split",pmMatchResult:"equal_split"});
    expect(computePolymarketSettlement({asset_id:asset,market:condition,size:"100"},market,cost)).toMatchObject({status,money,reward:50});
    expect(computePolymarketSettlementFromOrderRaw({...raw,pmConditionId:"other"},market,cost)).toBeNull();
    expect(mapDbStatus(status)).toBe(status==="win"?"Win":status==="lose"?"Lose":"Return");
  });
  test(`${version} backend binds final resolution to the condition and token aliases`,async()=>{
    const base={...market,finalResolution:undefined},map=new Map([[condition,base]]);
    const fetchMock=vi.fn(async url=>({ok:true,json:async()=>String(url).includes("/v2/resolutions?")?{data:[market.finalResolution]}:{version,condition_id:condition,closed:true,tokens:[{token_id:asset,winner:false},{token_id:version==="v2"?"202":"102",winner:false}]}}));
    vi.stubGlobal("fetch",fetchMock);
    try{
      await enrichMarketsFromClob(map,[condition]);
      expect(map.get(condition).finalResolution).toEqual(market.finalResolution);
      expect(map.get("token:"+asset)).toBe(map.get(condition));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }finally{vi.unstubAllGlobals();}
  });
}
