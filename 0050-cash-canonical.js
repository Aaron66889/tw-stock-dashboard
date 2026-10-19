'use strict';
// Safe 0050 adjusted history selection. RAW close and all model rules are untouched.
// Roll back with ETF0050_CASH_ADJUSTED=0 (or unset).
const {create0050CashResearch}=require('./0050-cash-audit');
const VERSION='0050-cash-verified-v1';
function select0050CashHistory(hist,dividendResponse,{enabled=false,asOfDate='2026-10-19'}={}){
 const legacy=hist;
 if(!enabled)return{hist:legacy,switched:false,status:'DISABLED',reason:null};
 if(hist?.code!=='0050'||hist?.validation?.backtestReadyPass!==true||!Array.isArray(hist?.rows)||hist.rows.length<340)
  return{hist:legacy,switched:false,status:'FALLBACK',reason:'LEGACY_HISTORY_NOT_VERIFIED'};
 if(dividendResponse?.complete!==true||dividendResponse?.errors?.length)
  return{hist:legacy,switched:false,status:'FALLBACK',reason:'DIVIDEND_SOURCE_NOT_VERIFIED'};
 const audit=create0050CashResearch(hist.rows,dividendResponse.events,{asOfDate});
 if(audit.state!=='RESEARCH_READY'||audit.qa?.issues?.length||audit.qa?.warnings?.length)
  return{hist:legacy,switched:false,status:'FALLBACK',reason:'CASH_QA_FAILED',issues:audit.qa?.issues||[]};
 const src=hist.rows,corrected=audit.rows;
 if(corrected.length!==src.length)return{hist:legacy,switched:false,status:'FALLBACK',reason:'ROW_COUNT_CHANGED'};
 for(let i=0;i<src.length;i++){
  const a=src[i],b=corrected[i];
  const p=v=>v!=null&&Number.isFinite(Number(v))&&Number(v)>0;
  const shapeOk=[['open','adjopen'],['high','adjhigh'],['low','adjlow']]
    .every(([rawKey,adjustedKey])=>p(a[rawKey])===p(b[adjustedKey]));
  // The original vendor price record can have a missing OPEN (e.g. 2009-08-13).
  // Missing fields must remain missing, not become invented positive values.
  const envelopeOk=!p(a.high)||!p(a.low)||(p(b.adjhigh)&&p(b.adjlow)&&
    b.adjlow<=b.adjhigh &&
    (!p(a.close)||a.close<=a.high*1.002||b.adjclose<=b.adjhigh*1.002) &&
    (!p(a.close)||a.close>=a.low*.998||b.adjclose>=b.adjlow*.998));
  if(a.date!==b.date||Math.abs(a.close-b.close)>0.000001||!p(b.adjclose)||!shapeOk||!envelopeOk)
   return{hist:legacy,switched:false,status:'FALLBACK',reason:'PRICE_BAR_PARITY_FAILED',at:a.date};
 }
 const last=src.at(-1),latest=corrected.at(-1);
 if(Math.abs(latest.adjclose-last.close)>0.000001||latest.adjclose<=0)
  return{hist:legacy,switched:false,status:'FALLBACK',reason:'LATEST_PRICE_ANCHOR_CHANGED'};
 // A converted cash history must not cause surprise intraday threshold jumps.
 // These are data-integrity bounds, NOT new trading entry rules. Exceeding
 // them leaves the old 0050 model untouched and reports the guard failure.
 const avgLast=(rows,n)=>{
  const x=rows.slice(-n);return x.reduce((a,r)=>a+Number(r.adjclose??r.close),0)/x.length;
 };
 for(const [days,maxDeltaPct] of [[20,.5],[60,.5],[120,1],[250,2.5]]){
  const oldAvg=avgLast(src,days),newAvg=avgLast(corrected,days);
  const deltaPct=Math.abs(newAvg/oldAvg-1)*100;
  if(!Number.isFinite(deltaPct)||deltaPct>maxDeltaPct)
   return{hist:legacy,switched:false,status:'FALLBACK',reason:'RECENT_HISTORY_DRIFT_GUARD',days,deltaPct};
 }
 const converted=corrected.map(({researchOnly,...r})=>({...r,priceBasis:VERSION}));
 // Never write adjusted history back to the legacy local disk cache.
 const h={...hist,rows:converted,source:hist.source+'｜現金配息校正(2009起、來源QA通過)',
  cashAdjusted:{version:VERSION,status:'ACTIVE',dividendCount:audit.qa.normalizedDividendCount,
   source:dividendResponse.source,historyPeriodStart:src[0].date,asOfDate}};
 return{hist:h,switched:true,status:'ACTIVE',reason:null};
}
module.exports={VERSION,select0050CashHistory};
