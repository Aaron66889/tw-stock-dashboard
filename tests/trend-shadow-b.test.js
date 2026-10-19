'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const b=require('../trend-shadow-b');
function official(extra={}) {
 return{status:'TREND_BUY',score:90,price:101.2,
   levels:{breakout20:101},trend:{atr:1},...extra};
}
test('B is shadow-only and only activates with official valid A and independent break/candle gates',()=>{
 const valid=b.live(official(),{open:101.1});
 assert.equal(valid.status,'B_CANDIDATE');
 assert.equal(valid.eligible,true);
 assert.equal(valid.mode,'SHADOW_ONLY');
 assert.equal(b.live(official({status:'WAIT'}),{open:101.1}).status,'WAIT_A');
 assert.equal(b.live(official({score:77}),{open:101.1}).status,'WAIT_SCORE');
 assert.equal(b.live(official({price:101.01}),{open:100.9}).status,'WAIT_STRENGTH');
 assert.equal(b.live(official({price:101.4}),{open:101.1}).status,'WAIT_CHASE');
 assert.equal(b.live(official(),{open:101.3}).status,'WAIT_CANDLE');
});
test('Missing OHLC is not a bullish candle confirmation',()=>{
 assert.equal(b.live(official(),{}).status,'DATA_INCOMPLETE');
 assert.equal(b.live(official({trend:{atr:null}}),{open:101}).status,'DATA_INCOMPLETE');
});
function rows(n=470,up=true){
 const st=Date.UTC(2023,0,1);
 return Array.from({length:n},(_,i)=>{
  const close=20+i*.045+(i%31===0?0.07:0);
  const date=new Date(st+i*86400000).toISOString().slice(0,10);
  return{date,open:close-(up?.02:-.04),high:close+.024,low:close-.055,
   close,adjclose:close};
 });
}
test('Historical A/B uses the same bars and B is a strict subset of A',()=>{
 const r=b.signalCandidates(rows());
 const a=new Set(r.candidateA.map(x=>x.date));
 for(const t of r.candidateB)assert.ok(a.has(t.date));
 for(const x of r.candidateA) {
   assert.equal(x.entryDate,r.bars[x.entryIndex].date);
   assert.equal(x.entry,r.bars[x.entryIndex].o);
   assert.ok(x.entryIndex>x.signalIndex);
 }
});
test('Price-core replay does not manufacture signals from close-only data',()=>{
 const r=b.compare(rows().map(({date,close,adjclose})=>({date,close,adjclose})));
 assert.equal(r.ready,false);
 assert.match(r.error,/資料|OHLC/);
});
test('Maturity is required for each horizon and costs reduce net return',()=>{
 const seq=rows(),bars=b.barsFrom(seq);
 const e={entryIndex:bars.length-9,entry:bars[bars.length-9].o,breakout:20,variant:'A'};
 const out=b.scoreEvent(e,bars);
 assert.notEqual(out.returnPct[5],null);
 assert.equal(out.returnPct[20],null);
 assert.equal(out.returnPct[60],null);
 const gross=(bars[bars.length-4].c/e.entry-1)*100;
 assert.ok(Math.abs(out.returnPct[5]-(gross-b.COST_PCT))<1e-8);
});
test('B candle filter rejects bearish candidate while A rules stay identical',()=>{
 const up=b.signalCandidates(rows(470,true));
 const down=b.signalCandidates(rows(470,false));
 assert.deepEqual(up.candidateA.map(x=>x.date),down.candidateA.map(x=>x.date));
 assert.equal(down.candidateB.length,0);
});
test('2026 check is labeled as exploratory and not marketed as untouched OOS',()=>{
 const r=b.compare(rows(1100));
 assert.ok(r.disclosure.includes('不可當作'));
 assert.ok(r.limitations.includes('並非完整重播'));
 assert.equal(r.execution.includes('次交易日開盤'),true);
});
test('Shadow entry bands are nested; extra ranges only count incremental fills',()=>{
 const seq=rows(470,true),bars=b.barsFrom(seq),idx=370;
 const ref=bars[idx].o,atr=1;
 const make=offset=>b.scoreEvent({date:bars[idx-1].date,entryDate:bars[idx].date,
  signalIndex:idx-1,entryIndex:idx,entry:ref,breakout:ref-offset*atr,atr,breakoutAtr:.1},bars);
 const result=b.entryBandResearch([make(.20),make(.39),make(.52),make(.70),make(-.15)]);
 assert.equal(result.mode,'SHADOW_ONLY');
 assert.deepEqual(result.bands.map(x=>x.stats.signals),[1,2,3]);
 assert.deepEqual(result.extras.map(x=>x.stats.signals),[1,1]);
 assert.equal(result.signalPool,5);
 assert.equal(result.bands[0].stats.period[20].samples,1);
 assert.ok(result.assumptions.includes('隔一交易日'));
});
test('Research output is read-only: prior official A and B signals are unchanged',()=>{
 const history=rows(500,true);
 const baseline=b.signalCandidates(history);
 const before=b.live(official({status:'WAIT'}),{open:100.9});
 const output=b.compare(history);
 const after=b.live(official({status:'WAIT'}),{open:100.9});
 assert.deepEqual(before,after);
 assert.equal(output.entryBandResearch?.mode,'SHADOW_ONLY');
 assert.deepEqual(b.signalCandidates(history).candidateA,baseline.candidateA);
});

test('Last-good research data stays visible but is never considered a buy signal',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const app=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
 const start=app.indexOf('// Read-only historical research cache.'),end=app.indexOf('// Read-only research panel:',start);
 assert.ok(start>=0&&end>start);
 const choose=vm.runInNewContext(app.slice(start,end)+';trendResearchChoose',{});
 const base={ok:true,historySource:'TWSE',historyOfficial:true,backtest:{signals:28},
  abPriceCore:{ready:true,historyDays:900,lastDate:'2026-10-16',entryBandResearch:{bands:[{},{},{}]}}};
 const a=choose(null,base,'2026-10-16T10:00:00Z');
 assert.equal(a.snapshot.backtest.signals,28);
 assert.ok(a.persist);
 const empty=choose(a.snapshot,{ok:false,error:'history timeout'},'2026-10-16T10:01:00Z');
 assert.equal(empty.snapshot.backtest.signals,28);
 assert.equal(empty.stale,true);
 assert.equal(empty.persist,null);
 const fallback=choose(a.snapshot,{...base,historySource:'Yahoo fallback',historyOfficial:false,
  backtest:{signals:4},abPriceCore:{...base.abPriceCore,historyDays:500,lastDate:'2026-10-16'}},'2026-10-16T10:02:00Z');
 assert.equal(fallback.snapshot.backtest.signals,28);
 assert.equal(fallback.stale,true);
 const updated=choose(a.snapshot,{...base,backtest:{signals:29},abPriceCore:{...base.abPriceCore,historyDays:901,lastDate:'2026-10-19'}},'2026-10-19T10:00:00Z');
 assert.equal(updated.snapshot.backtest.signals,29);
 assert.equal(updated.stale,false);
 assert.ok(updated.persist);
 assert.match(app,/本輪不得視為買入訊號/);
 assert.match(app,/bt=hist\.snapshot\?\.backtest\|\|\{\}/);
});
