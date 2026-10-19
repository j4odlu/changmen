import {expect,it} from 'vitest';
import * as originalTicks from '../../pmTickPrice';
import * as quoteTicks from '../../quotes/pmTickPrice';
import * as canonicalTicks from "../../../../polymarket/pmTickPrice";
import {pmBuyOrderShares as originalShares} from '../../pmBuyOrderShares';
import {pmBuyOrderShares as preflightShares} from '../../submission/preflight/pmBuyOrderShares';
import {pmBuyOrderShares as canonicalShares} from "../../../../polymarket/pmBuyOrderShares";
import {polymarketMarketOrderOptions as originalOptions} from '../../pmMarketOrderOptions';
import {polymarketMarketOrderOptions as preflightOptions} from '../../submission/preflight/pmMarketOrderOptions';
import {polymarketMarketOrderOptions as canonicalOptions} from "../../../../polymarket/pmMarketOrderOptions";

it('all tick entry points expose exactly the same functions',()=>{
 expect(Object.keys(originalTicks).sort()).toEqual(Object.keys(canonicalTicks).sort());
 expect(Object.keys(quoteTicks).sort()).toEqual(Object.keys(canonicalTicks).sort());
 for(const name of Object.keys(canonicalTicks) as Array<keyof typeof canonicalTicks>){
  expect(originalTicks[name]).toBe(canonicalTicks[name]);
  expect(quoteTicks[name]).toBe(canonicalTicks[name]);
 }
});
it('old and canonical BUY share calculations are one implementation',()=>{
 expect(originalShares).toBe(canonicalShares);expect(preflightShares).toBe(canonicalShares);
});
it('old and canonical order-book validators are one implementation',()=>{
 expect(originalOptions).toBe(canonicalOptions);expect(preflightOptions).toBe(canonicalOptions);
});
