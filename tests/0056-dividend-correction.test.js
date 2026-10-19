'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EVENTS,select0056History}=require('../0056-dividend-correction');
function fixture(){
 const rows=[];
 // Trading days span all three early ex-dates; no future dividends are fabricated.
 for(let day=new Date('2008-01-02T00:00:00Z');day<=new Date('2013-01-05T00:00:00Z');day.setUTCDate(day.getUTCDate()+1)){
  if(day.getUTCDay()===0||day.getUTCDay()===6)continue;
  const date=day.toISOString().slice(0,10),rawClose=30;
  rows.push({date,rawClose,rawOpen:30,rawHigh:31,rawLow:29,close:15,adjclose:15,open:15,
   high:15.5,low:14.5,adjopen:15,adjhigh:15.5,adjlow:14.5,adjFactor:.5,volume:100,
   preAdjusted:true,priceBasis:'yahoo-adjusted-total-return-v1'});
 }
 return{code:'0056',source:'Yahoo Finance 0056.TW adjusted',normalizationVersion:'yahoo-adjusted-v1',
  validation:{backtestReadyPass:true,fullHistoryPass:true},rows};
}
test('default off leaves the original model source untouched',()=>{
 const h=fixture(),out=select0056History(h);assert.strictEqual(out.hist,h);assert.equal(out.status,'DISABLED');
});
test('corrects exactly the three historical missing dividends; raw quotes, OHLC shape and latest price unchanged',()=>{
 const h=fixture(),snapshot=JSON.stringify(h),out=select0056History(h,{enabled:true,asOfDate:'2013-01-05'});
 assert.equal(out.status,'ACTIVE',JSON.stringify(out));
 assert.equal(out.events.length,3);assert.equal(out.hist.rows.length,h.rows.length);
 const expected=EVENTS.reduce((v,e)=>v*(30-e.amount)/30,1);
 assert.ok(Math.abs(out.hist.rows[0].close/(h.rows[0].close)-expected)<1e-10);
 assert.equal(out.hist.rows.at(-1).close,h.rows.at(-1).close);
 assert.equal(out.hist.rows[0].rawClose,h.rows[0].rawClose);
 assert.equal(out.hist.rows[0].rawHigh,h.rows[0].rawHigh);
 assert.equal(out.hist.rows[0].volume,h.rows[0].volume);
 assert.equal(out.hist.cashAdjusted.status,'ACTIVE');
 assert.deepEqual(h,JSON.parse(snapshot));
});
test('source already independently corrected: no double counting and exact fallback',()=>{
 const h=fixture(),i=h.rows.findIndex(x=>x.date==='2011-10-26');
 for(let j=0;j<i;j++){h.rows[j].close*=.92;h.rows[j].adjclose*=.92;}
 const out=select0056History(h,{enabled:true,asOfDate:'2013-01-05'});
 assert.equal(out.switched,false);
 assert.equal(out.reason,'DIVIDEND_ALREADY_ADJUSTED_OR_SOURCE_CHANGED');
 assert.strictEqual(out.hist,h);
});
test('only 0056 preadjusted Yahoo basis accepted; other ETFs never affected',()=>{
 for(const other of ['0050','00878','00919']){
  const h={...fixture(),code:other};
  const o=select0056History(h,{enabled:true,asOfDate:'2013-01-05'});
  assert.strictEqual(o.hist,h);assert.equal(o.switched,false);
 }
 const h=fixture();h.rows[3].priceBasis='unverified';
 assert.equal(select0056History(h,{enabled:true,asOfDate:'2013-01-05'}).switched,false);
});
test('missing historical source events or unverified history fails closed',()=>{
 const h=fixture();
 const drop={...h,rows:h.rows.filter(x=>x.date!=='2012-10-24')};
 assert.equal(select0056History(drop,{enabled:true,asOfDate:'2013-01-05'}).switched,false);
 assert.equal(select0056History({...h,validation:{backtestReadyPass:false}},{enabled:true,asOfDate:'2013-01-05'}).switched,false);
});
