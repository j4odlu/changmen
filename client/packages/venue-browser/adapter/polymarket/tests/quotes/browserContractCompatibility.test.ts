import {expect,it} from 'vitest';
import {isValidClobPrice as legacyValid} from '../../pmDetection';
import {isValidClobPrice as hostValid} from '../../submission/preflight/pmDetection';
import {isValidClobPrice as canonicalValid} from "../../../../polymarket/pmPriceValidity";
import {PolymarketPriceAboveDetectionError as LegacyError,isPolymarketPriceAboveDetectionError as legacyCheck} from '../../pmTokenQuote';
import {PolymarketPriceAboveDetectionError as HostError,isPolymarketPriceAboveDetectionError as hostCheck} from '../../quotes/pmTokenQuote';
import {PolymarketPriceAboveDetectionError as CanonicalError,isPolymarketPriceAboveDetectionError as canonicalCheck} from "../../../../polymarket/pmPriceError";

it('all price predicates retain one implementation and the original open interval',()=>{
 expect(legacyValid).toBe(canonicalValid);expect(hostValid).toBe(canonicalValid);
 for(const value of [NaN,Infinity,-Infinity,-1,0,1,2])expect(canonicalValid(value)).toBe(false);
 for(const value of [Number.MIN_VALUE,0.5,1-Number.EPSILON])expect(canonicalValid(value)).toBe(true);
});
it('all error paths share one constructor and preserve instanceof in both directions',()=>{
 expect(LegacyError).toBe(CanonicalError);expect(HostError).toBe(CanonicalError);
 expect(legacyCheck).toBe(canonicalCheck);expect(hostCheck).toBe(canonicalCheck);
 for(const Constructor of [LegacyError,HostError,CanonicalError]){
  const error=new Constructor('original message',0.6,0.5);
  expect(error).toBeInstanceOf(Error);expect(error).toBeInstanceOf(LegacyError);expect(error).toBeInstanceOf(CanonicalError);
  expect(error.name).toBe('PolymarketPriceAboveDetectionError');expect(error.message).toBe('original message');
  expect(error.bestAskPrice).toBe(0.6);expect(error.detectionMaxPrice).toBe(0.5);
  expect(legacyCheck(error)).toBe(true);expect(canonicalCheck(error)).toBe(true);
 }
 expect(canonicalCheck(new Error('same message'))).toBe(false);
 expect(canonicalCheck({name:'PolymarketPriceAboveDetectionError',bestAskPrice:0.6,detectionMaxPrice:0.5})).toBe(false);
});
