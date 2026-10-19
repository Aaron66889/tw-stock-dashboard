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

test('Risk Shadow computes seven candidates but cannot change formal live permissions',()=>{
 const data=rows(750,true).map((r,i)=>({...r,low:r.close-.25,high:r.close+.024}));
 const baselineLive=b.live(official(),{open:101.1});
 const research=b.riskResearch(data,[]);
 assert.equal(research.mode,'SHADOW_ONLY');
 assert.equal(research.recommendation,'NO_AUTO_PROMOTION');
 assert.equal(research.variants.extension2.stats.signals<=research.variants.extension25.stats.signals,true);
 assert.equal(research.variants.extension25.stats.signals<=research.variants.extension3.stats.signals,true);
 assert.equal(research.variants.extension3.stats.signals<=research.variants.baseline.stats.signals,true);
 assert.deepEqual(b.live(official(),{open:101.1}),baselineLive);
 assert.equal(research.variants.marketGuard.stats.signals,0);
 assert.equal(research.variants.combined.stats.signals,0);
});
test('Data QA flags suspicious historical price discontinuity without changing any bars',()=>{
 const data=rows(750,true).map((r,i)=>({...r,low:r.close-.25,high:r.close+.024}));
 data[370]={...data[370],open:data[370].open/4,high:data[370].high/4,low:data[370].low/4,close:data[370].close/4,adjclose:data[370].adjclose/4};
 const before=JSON.stringify(data);
 const study=b.riskResearch(data);
 assert.equal(study.ready,false);
 assert.equal(study.dataStatus,'PRICE_QA_WARNING');
 assert.ok(study.qa.issues.some(x=>x.type==='DAILY_DISCONTINUITY'));
 assert.equal(JSON.stringify(data),before);
});
test('Risk comparison retains common signal days and discounts confirmed fills until later open',()=>{
 const data=rows(750,true).map(r=>({...r,low:r.close-.25,high:r.close+.024}));
 const r=b.compare(data);
 assert.equal(r.riskResearch.mode,'SHADOW_ONLY');
 assert.match(r.riskResearch.assumptions,/次交易日開盤/);
 const base=r.riskResearch.variants.baseline,confirmed=r.riskResearch.variants.nextClose;
 assert.equal(base.stats.signals>=confirmed.stats.signals,true);
 assert.ok(confirmed.pairedDelta20.samples<=confirmed.stats.period[20].samples);
 assert.ok(confirmed.rejected.signals>=0);
});

test('Performance export flags unclear entry snapshots and groups same-breakout trend fills as one episode',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const app=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
 const begin=app.indexOf('function modelTradeDataAudit('),end=app.indexOf('function performanceDiagnosticPayload(){',begin);
 assert.ok(begin>0&&end>begin);
 const audit=vm.runInNewContext(app.slice(begin,end)+';modelTradeDataAudit',{
  modelFamilyOf:t=>t.tradeType==='manual'?'manual':t.modelFamily
 });
 const trade=(id,code,modelFamily,day,status)=>({id,code,modelFamily,entryDate:day,tradeType:'model',shares:10,
  snapshot:{modelStatusText:status}});
 const result=audit([
  trade('t1','0050','trend','2026-10-06','強勢突破／可小額加碼'),
  trade('t2','0050','trend','2026-10-06','強勢突破／可小額加碼'),
  trade('t3','0050','trend','2026-10-07','突破後回踩／可小額加碼'),
  trade('t4','0056','trend','2026-10-05','順勢買點成立／可小額'),
  trade('t5','0050','reasonable','2026-10-13','Gate暫停')
 ]);
 assert.equal(result.trendTradeCount,4);
 assert.equal(result.trendEpisodes,2);
 assert.equal(result.episodes.find(x=>x.code==='0050').entries,3);
 assert.equal(result.potentialSnapshotInconsistencies.length,1);
 assert.equal(result.potentialSnapshotInconsistencies[0].flag,'REVIEW_CONFIRMATION_OR_GATE');
 assert.match(app,/audit:modelTradeDataAudit\(MODEL_TRADES\)/);
});

test('Shadow fingerprints find historical data revisions when same first/last price and count are unchanged',()=>{
 const original=rows(750,true),revised=original.map((r,i)=>i===380?{...r,close:r.close+.031,adjclose:r.adjclose+.031}:r);
 assert.equal(original.length,revised.length);
 assert.deepEqual(original[0],revised[0]);
 assert.deepEqual(original.at(-1),revised.at(-1));
 const first=b.compare(original),second=b.compare(revised);
 assert.notStrictEqual(first,second,'cache must not reuse results for changed middle OHLC');
 assert.notEqual(first.historyFingerprint.hash,second.historyFingerprint.hash);
 const y=original[380].date.slice(0,4);
 assert.notEqual(first.historyFingerprint.byYear[y],second.historyFingerprint.byYear[y]);
 for(const other of Object.keys(first.historyFingerprint.byYear))if(other!==y)
  assert.equal(first.historyFingerprint.byYear[other],second.historyFingerprint.byYear[other]);
 assert.equal(b.historyFingerprint(original).hash,first.historyFingerprint.hash);
});
test('UI replaces saved valid Shadow stats when only hidden historical bars change',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),app=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
 const start=app.indexOf('function trendResearchChoose('),end=app.indexOf('function trendResearchDisplay(',start);
 assert.ok(start>=0&&end>start);
 const choose=vm.runInNewContext(app.slice(start,end)+';trendResearchChoose',{});
 const model=(hash)=>({ok:true,historySource:'Yahoo Finance 0056.TW',historyOfficial:true,
  backtest:{signals:83},abPriceCore:{ready:true,historyDays:4608,lastDate:'2026-10-19',
   entryBandResearch:{bands:[{},{},{}]},historyFingerprint:{hash,byYear:{'2012':hash}}}});
 const first=choose(null,model('a'),'2026-10-19T07:00:00Z');
 const second=choose(first.snapshot,model('b'),'2026-10-19T07:22:00Z');
 assert.equal(second.historyRevised,true);
 assert.ok(second.persist);
 assert.equal(second.changedYears.join(','),'2012');
 assert.equal(second.snapshot.fingerprint.hash,'b');
});

test('Regression: 0050 cash adjusted historical data preserves missing source OPEN values',()=>{
 const {select0050CashHistory}=require('../0050-cash-canonical');
 const rows=[];for(let i=0;i<1040;i++){
  const date=new Date(Date.UTC(2024,0,1)+i*86400000).toISOString().slice(0,10);
  if(date>'2025-06-10'&&date<'2025-06-18')continue;
  rows.push({date,close:100,open:100,high:101,low:99,adjclose:100,adjopen:100,adjhigh:101,adjlow:99,
    priceBasis:'normalized-split-scale-v2'});
 }
 const incomplete=rows.find(x=>x.date==='2024-05-28');incomplete.open=null;incomplete.adjopen=null;
 const hist={code:'0050',source:'Yahoo Finance 0050.TW',validation:{backtestReadyPass:true},rows};
 const events=[['2024-01-17',3],['2024-07-16',1],['2025-01-17',2.7],
  ['2025-07-21',.36],['2026-01-22',1],['2026-07-21',.6]].map(([date,amount])=>({date,amount}));
 const result=select0050CashHistory(hist,{complete:true,errors:[],events},{enabled:true});
 assert.equal(result.status,'ACTIVE');
 assert.equal(result.hist.rows.find(x=>x.date==='2024-05-28').adjopen,null);
});


test('0056 isolated source correction dry-run is disabled by default and preserves raw data',()=>{
 const {select0056History}=require('../0056-dividend-correction');
 const h={code:'0056',rows:[{date:'2008-01-02',close:12,rawClose:25,preAdjusted:true}]};
 const v=select0056History(h);
 assert.equal(v.status,'DISABLED');
 assert.strictEqual(v.hist,h);
 assert.equal(select0056History({...h,code:'0050'},{enabled:true}).switched,false);
});
