'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {create0050CashResearch,amountForScale,ANCHORS}=require('../0050-cash-audit');
function bars(){
 const a=[];for(let i=0;i<1040;i++){let date=new Date(Date.UTC(2024,0,1)+86400000*i).toISOString().slice(0,10);
  if(date>'2025-06-10'&&date<'2025-06-18')continue;
  a.push({date,open:100,high:101,low:99,close:100,adjclose:100,
   priceBasis:'normalized-split-scale-v2',source:'Yahoo Finance 0050.TW daily OHLC'});}
 return a;
}
function events(){
 const e=[
  {date:'2024-01-17',amount:3},{date:'2024-07-16',amount:1},
  {date:'2025-01-17',amount:2.7},{date:'2025-07-21',amount:.36},
  {date:'2026-01-22',amount:1},{date:'2026-07-21',amount:.6}
 ];
 return e;
}
test('2025 pre-split 2.7 dividend is 0.675 on normalized post-split price',()=>{
 assert.equal(amountForScale({date:'2025-01-17',amount:2.7},'HISTORICAL_PER_SHARE'),.675);
 assert.equal(amountForScale({date:'2025-07-21',amount:.36},'HISTORICAL_PER_SHARE'),.36);
 assert.equal(ANCHORS.find(e=>e.date==='2024-01-17').postScaleAmount,.75);
});
test('research only: dividend changes earlier adjusted bars, preserves split-only cash close and latest price',()=>{
 const src=bars(),ev=events(); // Synthetic data begins in 2024 and covers 2 events in 2024/2025/2026.
 const result=create0050CashResearch(src,ev,{asOfDate:'2026-10-19'});
 assert.equal(result.state,'RESEARCH_READY',JSON.stringify(result.qa.issues));
 assert.equal(result.canPromoteToLive,false);
 assert.equal(result.events.find(e=>e.date==='2025-01-17').normalizedAmount,.675);
 const x=result.rows.find(r=>r.date==='2025-01-16'),y=result.rows.find(r=>r.date==='2025-01-17');
 assert.ok(x.adjclose<y.adjclose);
 assert.equal(y.close,100);
 assert.equal(x.close,100);
 assert.equal(result.rows.at(-1).adjclose,src.at(-1).close);
 assert.ok(result.qa.splitBoundary.alreadyNormalized);
 assert.equal(result.qa.splitBoundary.firstPostSplitTradingDay,'2025-06-18');
});
test('missing dividends, mixed scales, invalid price basis all block canonical promotion',()=>{
 const src=bars();
 const dropped=create0050CashResearch(src,events().filter(e=>e.date!=='2025-01-17'));
 assert.equal(dropped.state,'BLOCKED');assert.ok(dropped.qa.issues.includes('DIVIDEND_ANCHOR_MISMATCH'));
 const wrong=create0050CashResearch(src,events().map(e=>e.date==='2024-07-16'?{...e,amount:.25}:e));
 assert.equal(wrong.state,'BLOCKED');assert.ok(wrong.qa.issues.includes('DIVIDEND_UNIT_SCALE_AMBIGUOUS'));
 const wrongBasis=create0050CashResearch(src.map(x=>({...x,priceBasis:'other'})),events());
 assert.equal(wrongBasis.state,'BLOCKED');assert.ok(wrongBasis.qa.issues.includes('NOT_0050_SPLIT_ONLY_BASIS'));
});
test('does not apply each cash factor twice or adjust the split event as a cash dividend',()=>{
 const src=bars(),out=create0050CashResearch(src,events());
 assert.equal(out.qa.normalizedDividendCount,6);
 const before=out.rows.find(x=>x.date==='2024-01-16'),after=out.rows.find(x=>x.date==='2024-01-17');
 assert.ok(before.adjclose<after.adjclose);
 assert.equal(out.events.some(e=>e.date==='2025-06-18'),false);
 assert.equal(out.rows.find(x=>x.date==='2025-06-18').close,100);
});
