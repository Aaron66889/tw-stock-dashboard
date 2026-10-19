'use strict';
// 0056 isolated historical Yahoo adjusted-price QA and the three early dividends
// omitted by the vendor's AdjClose factor. Never touches quotes, holdings or DB.
const VERSION='0056-cash-missing-early-v1';
const EVENTS=Object.freeze([
 {date:'2009-10-23',amount:2.0},
 {date:'2011-10-26',amount:2.2},
 {date:'2012-10-24',amount:1.3},
]);
const RECENT_ANCHORS=Object.freeze([
 {date:'2021-10-22',amount:1.8},
 {date:'2022-10-19',amount:2.1},
 {date:'2024-01-17',amount:.7},
 {date:'2024-10-17',amount:1.07},
 {date:'2025-10-23',amount:.866},
 {date:'2026-07-21',amount:1.35},
]);
const KEYS=['close','adjclose','open','high','low','adjopen','adjhigh','adjlow'];
function select0056History(hist,{enabled=false,asOfDate='2026-10-19'}={}){
 const fallback=(reason,details={})=>({hist,switched:false,status:'FALLBACK',reason,...details});
 if(!enabled)return{hist,switched:false,status:'DISABLED',reason:null};
 const src=hist?.rows;
 if(hist?.code!=='0056'||hist?.normalizationVersion!=='yahoo-adjusted-v1'||
    hist?.validation?.backtestReadyPass!==true||!Array.isArray(src)||src.length<340||
    src[0]?.date>'2009-01-01'||src.at(-1)?.date<'2012-10-24')
  return fallback('SOURCE_NOT_ELIGIBLE');
 if(src.some(x=>x?.preAdjusted!==true||x?.priceBasis!=='yahoo-adjusted-total-return-v1'||
    !(x?.rawClose>0&&x?.adjclose>0&&x?.close>0)))
  return fallback('SOURCE_PRICE_BASIS_CHANGED');
 if(asOfDate<'2012-10-24')return fallback('UNSUPPORTED_HISTORICAL_DATE');
 const index=new Map(src.map((x,i)=>[x.date,i]));
 if(index.size!==src.length)return fallback('DUPLICATE_TRADING_DATE');
 const audits=[];
 // Compare the Yahoo adjustment factors across the historical ex-date.
 // The old chart has no step on these three ex-dates. If Yahoo later fixes
 // them itself, this fails CLOSED instead of applying a double dividend.
 for(const e of EVENTS){
  const i=index.get(e.date);
  if(!(i>0))return fallback('MISSING_EX_DATE',{at:e.date});
  const previous=src[i-1],current=src[i];
  const f0=previous.adjclose/previous.rawClose,f1=current.adjclose/current.rawClose;
  const ratio=f0/f1;
  const implied=previous.rawClose*(1-ratio);
  if(!Number.isFinite(ratio)||!(previous.rawClose>e.amount)||Math.abs(implied)>.07)
   return fallback('DIVIDEND_ALREADY_ADJUSTED_OR_SOURCE_CHANGED',{at:e.date,observedDividend:implied});
  const factor=(previous.rawClose-e.amount)/previous.rawClose;
  if(!(factor>.75&&factor<1))return fallback('DIVIDEND_FACTOR_INVALID',{at:e.date});
  audits.push({...e,previousRawClose:previous.rawClose,observedDividend:implied,factor,index:i});
 }
 // Additional independent 2013+ reference events must still be correctly
 // represented by the provider, otherwise don't modify the series.
 const recent=[];
 for(const e of RECENT_ANCHORS){
  if(e.date>asOfDate)continue;
  const i=index.get(e.date);
  if(!(i>0))return fallback('ANCHOR_MISSING',{at:e.date});
  const previous=src[i-1],current=src[i];
  const observed=previous.rawClose*(1-(previous.adjclose/previous.rawClose)/(current.adjclose/current.rawClose));
  if(!Number.isFinite(observed)||Math.abs(observed-e.amount)>.12)
   return fallback('ANCHOR_DIVIDEND_MISMATCH',{at:e.date,expected:e.amount,observedDividend:observed});
  recent.push({...e,observedDividend:observed});
 }
 const corrected=src.map(x=>({...x}));
 for(const ev of audits){
  for(let i=0;i<ev.index;i++){
   const x=corrected[i];
   for(const k of KEYS)if(x[k]!=null&&Number.isFinite(x[k]))x[k]*=ev.factor;
   if(Number.isFinite(x.adjFactor))x.adjFactor*=ev.factor;
  }
 }
 for(let i=0;i<corrected.length;i++){
  const o=src[i],r=corrected[i],isValid=(v)=>v!=null&&Number.isFinite(v)&&v>0;
  if(o.date!==r.date||o.rawClose!==r.rawClose||o.rawOpen!==r.rawOpen||
     o.rawHigh!==r.rawHigh||o.rawLow!==r.rawLow||o.volume!==r.volume||
     !isValid(r.close)||!isValid(r.adjclose)||Math.abs(r.close-r.adjclose)>1e-6)
   return fallback('ORIGINAL_PRICE_PARITY_FAILED',{at:o.date});
  for(const [a,b] of [['open','adjopen'],['high','adjhigh'],['low','adjlow']]){
   if(isValid(o[a])!==isValid(r[a])||isValid(o[b])!==isValid(r[b]))
    return fallback('OHLC_FIELDS_CHANGED',{at:o.date,key:a});
  }
  if(isValid(r.high)&&isValid(r.low)&&!(r.high>=r.low))
   return fallback('OHLC_ENVELOPE_FAILED',{at:o.date});
 }
 // 2009–2012 factors must not affect the recent 20/60/120/250 day statistics.
 const same=(a,b)=>Math.abs(a-b)<1e-7;
 for(const days of [20,60,120,250]){
  const before=src.slice(-days),after=corrected.slice(-days);
  if(before.some((r,i)=>!same(r.close,after[i].close)))
   return fallback('RECENT_250_DAY_PRICE_DRIFT',{days});
 }
 if(src.at(-1).close!==corrected.at(-1).close)return fallback('LATEST_PRICE_CHANGED');
 const rows=corrected.map(x=>({...x,priceBasis:'yahoo-adjusted-total-return-plus-early-0056-cash-v1'}));
 return{hist:{...hist,rows,
   source:String(hist.source||'')+'｜2009/2011/2012三筆現金配息補正（原始行情不變）',
   cashAdjusted:{status:'ACTIVE',version:VERSION,corrections:audits.length,
    source:'0056歷史配息錨點核對（元大、Yahoo台股；獨立於Yahoo調整序列）',lastCheckedAsOf:asOfDate}},
  switched:true,status:'ACTIVE',reason:null,events:audits,recentChecks:recent};
}
module.exports={VERSION,EVENTS,RECENT_ANCHORS,select0056History};
