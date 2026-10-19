'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {select0050CashHistory,VERSION}=require('../0050-cash-canonical');
function hist(){
 const rows=[];for(let i=0;i<1040;i++){const date=new Date(Date.UTC(2024,0,1)+i*86400000).toISOString().slice(0,10);
  if(date>'2025-06-10'&&date<'2025-06-18')continue;
  rows.push({date,close:100,open:100,high:101,low:99,adjclose:100,adjopen:100,adjhigh:101,adjlow:99,priceBasis:'normalized-split-scale-v2'});
 }
 return{code:'0050',source:'Yahoo Finance 0050.TW',validation:{backtestReadyPass:true,fullHistoryPass:false},rows};
}
const dates=[['2024-01-17',3],['2024-07-16',1],['2025-01-17',2.7],['2025-07-21',.36],['2026-01-22',1],['2026-07-21',.6]];
const feed=()=>({complete:true,errors:[],events:dates.map(([date,amount])=>({date,amount}))});
test('default off does not change 0050 model input',()=>{
 const h=hist();const result=select0050CashHistory(h,feed());
 assert.equal(result.status,'DISABLED');assert.strictEqual(result.hist,h);
});
test('corrected adjusted series preserves all cash source prices, current close and immutable holdings',()=>{
 const h=hist(),previous=JSON.stringify(h),out=select0050CashHistory(h,feed(),{enabled:true});
 assert.equal(out.status,'ACTIVE',JSON.stringify(out.issues||[]));
 assert.equal(out.hist.validation,h.validation);
 assert.equal(out.hist.rows.length,h.rows.length);
 assert.equal(out.hist.rows.at(-1).adjclose,h.rows.at(-1).close);
 assert.equal(out.hist.rows.at(-1).close,h.rows.at(-1).close);
 assert.equal(out.hist.cashAdjusted.dividendCount,6);
 assert.equal(out.hist.rows.at(-1).priceBasis,VERSION);
 assert.equal(out.hist.rows.some(x=>x.researchOnly),false);
 assert.deepEqual(h,JSON.parse(previous));
});
test('invalid or incomplete providers fail safely to unchanged old history',()=>{
 const h=hist();
 for(const f of [null,{complete:false,errors:[],events:feed().events},{complete:true,errors:['timeout'],events:feed().events},
  {complete:true,errors:[],events:feed().events.slice(1)}]){
   const out=select0050CashHistory(h,f,{enabled:true});
   assert.equal(out.switched,false);assert.strictEqual(out.hist,h);
 }
 const untrusted={...h,rows:h.rows.map(x=>({...x,priceBasis:'unverified'}))};
 assert.equal(select0050CashHistory(untrusted,feed(),{enabled:true}).switched,false);
});
test('other ETF history never adjusted by 0050 dividend mapping',()=>{
 const h={...hist(),code:'0056'},out=select0050CashHistory(h,feed(),{enabled:true});
 assert.strictEqual(out.hist,h);assert.equal(out.switched,false);
});

test('0050 old source has a missing 2009 open: preserve null without disabling otherwise valid cash adjustment',()=>{
 const h=hist(),target=h.rows[148];target.open=null;target.adjopen=null;
 const result=select0050CashHistory(h,feed(),{enabled:true});
 assert.equal(result.status,'ACTIVE',JSON.stringify(result));
 assert.equal(result.hist.rows[148].adjopen,null);
 assert.equal(result.hist.rows[148].open,null);
 assert.equal(result.hist.rows[148].close,target.close);
});

test('safe activation rejects unexpectedly large recent adjusted-average drift',()=>{
 const h=hist();
 // Keep valid OHLC shape but introduce an unrealistic latest historical
 // source factor through a large cash-adjustment divergence.
 const f=feed();
 f.events[f.events.length-1].amount=20;
 const result=select0050CashHistory(h,f,{enabled:true});
 assert.equal(result.switched,false);
 assert.strictEqual(result.hist,h);
});
test('deployment code keeps explicit off switch and 0050-only scope',()=>{
 const fs=require('node:fs'),path=require('node:path'),s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert.match(s,/function enabled0050CashAdjustment\(/);
 assert.match(s,/ETF0050_CASH_ADJUSTED\?\?'1'/);
 assert.match(s,/code!=='0050'\|\|!enabled0050CashAdjustment\(\)/);
 assert.match(s,/activeFlag:enabled0050CashAdjustment\(\)/);
 assert.match(s,/fetch0050DividendHistory\(\)\.catch/);
 assert.match(s,/CASH_0050_CANONICAL\.select0050CashHistory/);
});
