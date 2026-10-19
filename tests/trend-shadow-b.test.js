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


test('ONE-OFF PRODUCTION READONLY 0050 source QA (never merge)',{timeout:165000},async()=>{
 for(const path of ['/api/history-status','/api/0050-cash-audit']){
  try{
   const start=Date.now(),resp=await fetch('https://tw-stock-dashboard-5.onrender.com'+path,
     {headers:{Accept:'application/json'},signal:AbortSignal.timeout(115000)});
   const payload=await resp.json();
   console.log('PRODUCTION_DIAGNOSTIC_HTTP',path,resp.status,Date.now()-start);
   if(path.includes('cash-audit')){
    console.log('PRODUCTION_0050_QA',JSON.stringify({
     ok:payload.ok,state:payload.state,dividendCount:payload.qa?.dividendCount,
     normalizedDividendCount:payload.qa?.normalizedDividendCount,dividendBasis:payload.qa?.dividendBasis,
     issues:payload.qa?.issues,warnings:payload.qa?.warnings,coverageByYear:payload.qa?.coverageByYear,
     anchorChecks:payload.qa?.anchorChecks,historyOfficial:payload.historyOfficial,
     dividendFeedReportedComplete:payload.dividendFeedReportedComplete,
     dividendErrors:payload.dividendErrors,splitBoundary:payload.qa?.splitBoundary,
     comparison:payload.comparison&&{splitOnly:payload.comparison.splitOnly,cashAdjusted:payload.comparison.cashAdjusted}
    }));
   }else{
    const x=(payload.history||[]).find(v=>v.code==='0050');
    console.log('PRODUCTION_0050_HISTORY',JSON.stringify({rows:x?.rows,first:x?.first,last:x?.last,
     status:x?.status,fullHistoryPass:x?.fullHistoryPass,backtestReadyPass:x?.backtestReadyPass,error:x?.error}));
   }
  }catch(e){console.log('PRODUCTION_DIAGNOSTIC_ERROR',path,String(e))}
 }
});

test('ONE-OFF LIVE READONLY 0050 alternate dividends upstream probe',{timeout:120000},async()=>{
 const urls=[
  'https://query1.finance.yahoo.com/v8/finance/chart/0050.TW?period1=1220227200&period2=1792454400&interval=1d&events=div%2Csplits',
  'https://query2.finance.yahoo.com/v8/finance/chart/0050.TW?period1=1220227200&period2=1792454400&interval=1d&events=div%2Csplits',
  'https://www.cmoney.tw/etf/tw/0050/cashdividend',
  'https://tw.stock.yahoo.com/quote/0050/dividend',
  'https://www.twse.com.tw/zh/ETFortune/dividendList?startDate=2025&endDate=2026&stkNo=0050'
 ];
 await Promise.all(urls.map(async(url)=>{
  const key=new URL(url).hostname,newSince=Date.now();
  try{
   const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,application/json,*/*'},signal:AbortSignal.timeout(25000)});
   const ct=r.headers.get('content-type');const text=await r.text();
   const outcome={url:key,status:r.status,contentType:ct,bytes:text.length,seconds:(Date.now()-newSince)/1000,
     start:text.slice(0,120).replace(/\s/g,' ')};
   if(key.includes('finance.yahoo.com')&&r.ok){
    const o=JSON.parse(text),root=o.chart?.result?.[0]||{},div=root.events?.dividends||{},splits=root.events?.splits||{};
    const samples=Object.values(div).filter(e=>['2025','2024','2026'].includes(new Date(e.date*1000).toISOString().slice(0,4))).map(e=>({date:new Date(e.date*1000).toISOString().slice(0,10),amount:e.amount})).sort((a,b)=>a.date.localeCompare(b.date));
    outcome.dividends=Object.keys(div).length;outcome.splits=Object.keys(splits).length;outcome.samples=samples.slice(-12);
   }
   console.log('UPSTREAM_0050_DIVIDENDS',JSON.stringify(outcome));
  }catch(e){console.log('UPSTREAM_0050_DIVIDENDS',JSON.stringify({url:key,error:String(e),seconds:(Date.now()-newSince)/1000}))}
 }));
});

test('ONE-OFF 0050 Yahoo dividend calendar, price factor and split anchor probe',{timeout:35000},async()=>{
 const url='https://query2.finance.yahoo.com/v8/finance/chart/0050.TW?period1=1220227200&period2=1792454400&interval=1d&events=div%2Csplits';
 const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(25000)});
 const d=(await r.json()).chart.result[0],div=Object.values(d.events?.dividends||{}).map(x=>({day:new Date(x.date*1000).toISOString().slice(0,10),amount:x.amount})).sort((a,b)=>a.day.localeCompare(b.day));
 const q=d.indicators.quote[0],adj=d.indicators.adjclose?.[0]?.adjclose||[];
 const sampled=['2009-01-02','2012-01-17','2024-01-16','2024-01-17','2025-01-16','2025-01-17','2025-06-17','2025-06-18','2025-07-18','2025-07-21','2026-01-21','2026-01-22','2026-07-20','2026-07-21','2026-10-19'];
 const dates=d.timestamp.map(x=>new Date(x*1000).toISOString().slice(0,10));
 const prices=sampled.map(date=>{const i=dates.indexOf(date);return {date,i,close:i>=0?q.close[i]:null,adjClose:i>=0?adj[i]:null}});
 console.log('LIVE_YAHOO_ALL_DIVIDENDS',JSON.stringify(div));
 console.log('LIVE_YAHOO_HISTORICAL_CLOSE_VS_ADJCLOSE',JSON.stringify(prices));
});

test('ONE-OFF 0050 prod vs vendor OHLC 2009-2026 detect wrong split factor',{timeout:65000},async()=>{
 const urls=['https://tw-stock-dashboard-5.onrender.com/api/etf-history?code=0050','https://query2.finance.yahoo.com/v8/finance/chart/0050.TW?period1=1220227200&period2=1792454400&interval=1d&events=div%2Csplits'];
 try{
  const responses=await Promise.all(urls.map(u=>fetch(u,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(45000)})));
  const [production,vendor]=await Promise.all(responses.map(x=>x.json()));
  const h=production.rows||[],r=vendor.chart?.result?.[0],prices=r.indicators.quote[0].close,adjusted=r.indicators.adjclose?.[0]?.adjclose||[];
  const vm=new Map(r.timestamp.map((t,i)=>[new Date(t*1000).toISOString().slice(0,10),{close:prices[i],adjusted:adjusted[i]}]));
  const xx=h.map(x=>{const v=vm.get(x.date);return v&&v.close>0?{date:x.date,c:x.close,adj:x.adjclose,v:v.close,vadj:v.adjusted,ratio:x.close/v.close,basis:x.priceBasis}:null}).filter(Boolean);
  let groups=[],run=null;
  for(const x of xx){const rat=Number(x.ratio.toFixed(3));if(!run||Math.abs(run.ratio-rat)>.01){run={start:x.date,end:x.date,ratio:rat,count:1};groups.push(run)}else{run.end=x.date;run.count++}}
  console.log('PROD_0050_HISTORY_IDENTITY',JSON.stringify({count:h.length,vendor:r.timestamp.length,matching:xx.length,source:production.source,ready:production.validation?.backtestReadyPass,groups:groups.slice(0,25)}));
  console.log('PROD_0050_DATE_SAMPLES',JSON.stringify(['2009-01-02','2010-01-04','2011-01-03','2012-01-17','2013-01-02','2013-10-24','2014-01-02','2014-10-24','2015-01-02','2024-01-17','2025-06-17','2025-06-18','2026-10-19'].map(d=>xx.find(x=>x.date===d)||null)));
  const bad=[];for(let i=1;i<h.length;i++){const move=h[i].close/h[i-1].close-1;if(Math.abs(move)>.20)bad.push({date:h[i].date,movePct:Number((move*100).toFixed(2)),prev:h[i-1].close,next:h[i].close})}
  console.log('PROD_0050_INTERNAL_JUMPS',JSON.stringify(bad.slice(0,30)));
 }catch(e){console.log('PROD_0050_COMPARE_ERROR',String(e))}
});

test('ONEOFF inspect 0050 dividend tables HTML for robust parsing',{timeout:50000},async()=>{
 const urls=['https://tw.stock.yahoo.com/quote/0050.TW/dividend','https://finlab.finance/stocks/0050/dividend','https://www.cmoney.tw/etf/tw/0050/cashdividend'];
 for(const url of urls){
  try{
   const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(12000)});
   const h=await r.text(),plain=h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ');
   let hit=[];
   for(const key of ['2009/10/23','2009-10-23','2012/10/24','2012-10-24','2020/01/31','2020-01-31','2022/08/02']){
    const k=h.indexOf(key),p=plain.indexOf(key);hit.push({key,htmlIndex:k,plainIndex:p,plainNearby:p>=0?plain.slice(Math.max(0,p-140),p+140):null,htmlNearby:k>=0?h.slice(Math.max(0,k-80),k+100):null});
   }
   console.log('0050_DIVIDEND_HTML_STRUCTURE',JSON.stringify({url,status:r.status,bytes:h.length,plainBytes:plain.length,yearCount: (plain.match(/2009|2010|2011|2012/g)||[]).length,hits:hit}));
  }catch(e){console.log('0050_DIVIDEND_HTML_STRUCTURE',url,String(e))}
 }
});

test('ONEOFF parse structured dividend embedded records from Yahoo Taiwan',{timeout:20000},async()=>{
 const resp=await fetch('https://tw.stock.yahoo.com/quote/0050.TW/dividend',{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Mozilla/5.0'}});
 const html=await resp.text(),clean=html.replace(/\\+"/g,'"');
 const re=/"exDate":"(\d{4}-\d{2}-\d{2})T[^"]*","year":"[^"]+","period":"[^"]+","symbol":"0050","totalDividend":"([0-9.]+)"/g;
 const ev=[...clean.matchAll(re)].map(m=>({date:m[1],amount:Number(m[2])}));
 const uniq=[...new Map(ev.map(e=>[e.date,e])).values()];
 console.log('YAHOO_TAIWAN_FULL_DIVIDEND_PARSE',JSON.stringify({count:ev.length,unique:uniq.length,first:uniq.slice(-7),last:uniq.slice(0,7),has2009:uniq.some(x=>x.date==='2009-10-23'),has2026:uniq.some(x=>x.date==='2026-07-21'),extra20220802:uniq.some(x=>x.date==='2022-08-02')}));
});

test('ONE-OFF POST DEPLOY 0050 public cash research audit consistency',{timeout:125000},async()=>{
 const t=Date.now();
 const res=await fetch('https://tw-stock-dashboard-5.onrender.com/api/0050-cash-audit',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(115000)});
 const d=await res.json();
 console.log('POST_DEPLOY_0050_AUDIT',JSON.stringify({http:res.status,elapsedMs:Date.now()-t,
  ok:d.ok,state:d.state,source:d.dividendsFrom,sourceUrl:d.sourceUrl,feedComplete:d.dividendFeedReportedComplete,
  sourceQA:d.dividendSourceQA,qa:{issues:d.qa?.issues,warning:d.qa?.warnings,sourcePriceBasis:d.qa?.sourcePriceBasis,
   splitBoundary:d.qa?.splitBoundary,dividendBasis:d.qa?.dividendBasis,
   dividendCount:d.qa?.dividendCount,normalizedDividendCount:d.qa?.normalizedDividendCount},
  comparison:d.comparison,dividendErrors:d.dividendErrors,verdict:d.verdict
 }));
 assert.equal(res.status,200);
 assert.equal(d.state,'RESEARCH_READY',JSON.stringify(d.qa?.issues));
 assert.equal(d.qa?.dividendBasis,'HISTORICAL_PER_SHARE');
 assert.equal(d.qa?.normalizedDividendCount,28);
 assert.ok(d.comparison?.cashAdjusted?.priceCore20);
 assert.equal(d.verdict,'NO_LIVE_MODEL_CHANGE');
});
