'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const l=require('../trend-forward-ledger');

const code='0050',day='2026-10-13',stamp='2026-10-13T02:10:00.000Z';
const quote={last:116.5,date:day,realtime:true,lastGoodFallback:false,referenceReliable:true,
 source:'mock live',serverFetchedAt:'2026-10-13T02:09:50.000Z'};
function model(status='B_CANDIDATE'){
 return{ok:true,status:'TREND_BUY',score:93,action:'可小額加碼',levels:{breakout20:116,maxChase:117},
  trend:{atr:2},shadowB:{status,eligible:status==='B_CANDIDATE',reason:status==='B_CANDIDATE'?'通過':'突破不足',breakoutAtr:.25}};
}
const mk=(d=stamp,p=116.5,b='B_CANDIDATE')=>
 l.signalObservation(code,model(b),{...quote,last:p,serverFetchedAt:new Date(Date.parse(d)-10_000).toISOString()},day,new Date(d));
const bars=(n=110,entryDayIndex=10)=>{
 const epoch=Date.UTC(2026,9,1);
 return Array.from({length:n},(_,i)=>{
  const date=new Date(epoch+i*86400000).toISOString().slice(0,10);
  const close=115+i*.05;
  return{date,close,adjclose:close*.995,open:close-.1,high:close+.5,low:close-.5};
 });
};
test('Only fresh, same-day, session-eligible and reliable live quotes can create A snapshot',()=>{
 assert.equal(l.activeTradingWindow({weekday:'Tue',h:9,m:3}),true);
 assert.equal(l.activeTradingWindow({weekday:'Tue',h:13,m:26}),false);
 assert.equal(l.activeTradingWindow({weekday:'Sat',h:10,m:3}),false);
 assert.ok(mk());
 assert.equal(l.signalObservation(code,model(),{...quote,date:'2026-10-12'},day,new Date(stamp)),null);
 assert.equal(l.signalObservation(code,model(),{...quote,serverFetchedAt:'2026-10-13T02:00:00Z'},day,new Date(stamp)),null);
 assert.equal(l.signalObservation(code,model(),{...quote,lastGoodFallback:true},day,new Date(stamp)),null);
 assert.equal(l.signalObservation(code,model(),{...quote,referenceReliable:false},day,new Date(stamp)),null);
 assert.equal(l.signalObservation(code,{...model(),status:'WAIT_BREAKOUT'},quote,day,new Date(stamp)),null);
});
test('First A quote is immutable; later same episode B can qualify at a separate price',()=>{
 const first=mk(stamp,116.5,'WAIT_STRENGTH');
 const base=l.newEvent(first);
 assert.equal(base.id,'__TREND_AB_EVT_0050_20261013');
 assert.equal(base.b,null);
 assert.equal(base.a.entryPrice,116.5);
 const later=mk('2026-10-13T02:20:00.000Z',116.7,'B_CANDIDATE');
 const next=l.updateEvent(base,later);
 assert.equal(next.a.entryPrice,116.5);
 assert.equal(next.b.entryPrice,116.7);
 assert.equal(next.b.entryAt,later.observedAt);
 assert.equal(base.b,null);
 assert.equal(l.updateEvent(next,mk('2026-10-13T02:25:00Z',118)).b.entryPrice,116.7);
});
test('Dedup groups same ETF within 10 actual trading sessions; resets on tenth interval',()=>{
 const seq=Array.from({length:20},(_,i)=>({date:new Date(Date.UTC(2026,8,i+1)).toISOString().slice(0,10)}));
 const old=l.newEvent({...mk(),day:seq[0].date});
 assert.equal(l.matchEpisode([old],code,seq[9].date,seq)?.id,old.id);
 assert.equal(l.matchEpisode([old],code,seq[10].date,seq),null);
 assert.equal(l.matchEpisode([old],'0056',seq[3].date,seq),null);
 assert.equal(l.matchEpisode([old],code,'2026-11-12',seq),null);
});
test('OHLC maturity only uses fully closed historical days; incomplete days remain missing',()=>{
 const seq=bars(80),at=seq[10],today=seq[16].date;
 const res=l.outcome(at.close,at.date,at.close-.25,seq,today);
 // Six available completed dates [0..15] -> exactly five days after entry.
 assert.ok(res.horizons[5]);assert.equal(res.horizons[20],null);
 assert.equal(res.horizons[60],null);
 assert.equal(res.horizons[5].maturedOn,seq[15].date);
 assert.equal(res.horizons[5].netReturnPct,
  Number((((seq[15].adjclose/at.adjclose)-1)*100-l.COST_PCT).toFixed(3)));
 assert.ok(res.horizons[5].maePct<res.horizons[5].mfePct);
 assert.equal(l.outcome(at.close,at.date,99,seq,at.date).horizons[5],null);
});
test('No fabricated excursion when high/low missing',()=>{
 const seq=bars(80).map(({date,close,adjclose})=>({date,close,adjclose}));
 const x=l.outcome(seq[10].close,seq[10].date,115,seq,'2027-01-20');
 assert.equal(x.horizons[5],null);
 assert.equal(x.horizons[20],null);
});
test('Historical adjustment respects entry-day factor across a later dividend',()=>{
 const seq=bars(80),at=seq[10]; // Simulated 10% ex-dividend adjustment changing entry factor only.
 for(let i=0;i<=10;i++)seq[i].adjclose=seq[i].close*.90;
 for(let i=11;i<seq.length;i++)seq[i].adjclose=seq[i].close;
 const r=l.outcome(at.close,at.date,115,seq,'2027-01-20');
 assert.equal(r.horizons[5].netReturnPct,
  Number((((seq[15].adjclose/(at.close*.90))-1)*100-l.COST_PCT).toFixed(3)));
});
test('Metrics are computed for A-all, B-only and excluded-A cohorts without fake equal signal counts',()=>{
 const seq=bars(90),a=l.newEvent({...mk(stamp,116.5,'WAIT_STRENGTH'),day:seq[10].date});
 a.a.entryPrice=seq[10].close;a.a.breakout20=100;
 const b=l.newEvent({...mk('2026-10-13T03:10:00Z'),day:seq[12].date});
 b.a.entryPrice=seq[12].close;b.a.breakout20=100;
 b.b={status:'B_CANDIDATE',entryPrice:seq[13].close,entryAt:seq[13].date+'T04:00:00.000+08:00'};
 const e=[l.evaluateEvent(a,seq,'2027-01-01'),l.evaluateEvent(b,seq,'2027-01-01')];
 const s=l.summarize(e);
 assert.equal(s.events,2);assert.equal(s.bPassedEvents,1);assert.equal(s.bPendingEvents,1);
 assert.equal(s.byPeriod[20].a.samples,2);assert.equal(s.byPeriod[20].b.samples,1);
 assert.equal(s.byPeriod[20].aWhenBExcluded.samples,1);
 assert.equal(s.byPeriod[20].aWhenBMatched.samples,1);
});
test('Missing entry-day data never invents any mature returns',()=>{
 const seq=bars(80);
 const x=l.outcome(120,'2026-08-01',115,seq,'2027-01-01');
 assert.equal(x.horizons[5],null);assert.equal(x.horizons[20],null);
});
