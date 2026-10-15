'use strict';
/*
 * Separate forward-only ledger of LIVE observed reasonable-buy zones blocked by
 * the existing official hard Gate.  A blocked price is hypothetical, never an
 * order, confirmation or fill. Historical prices are used only after maturity.
 */
const TREND=require('./trend-forward-ledger');
const CODES=['0050','0056','00878','00919'];
const VERSION='gate-blocked-forward-v1';
const RECORD_CODE='__GATE_BLOCKED__';
const LEASE_ID='__GATE_BLOCKED_SCAN_LEASE__';
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const positive=x=>finite(x)&&Number(x)>0;
const round=x=>finite(x)?Number(Number(x).toFixed(4)):null;
const validDay=d=>/^20\d{2}-\d{2}-\d{2}$/.test(String(d||''));
function observationCandidates(code,model,quote,data,{day,nowMs=Date.now()}={}){
 if(!CODES.includes(code)||!validDay(day)||!Number.isFinite(nowMs))return[];
 if(data?.modelFreshByCode?.[code]!==true||!TREND.quoteValid(quote,day,nowMs))return[];
 if(!model||model.modelVariant!=='official'||model.hardVeto!==true||
   !String(model.hardVetoReason||'').includes('至少兩項急殺')||
   model.referenceReliable===false||model.corporateActionReferenceMissing===true)return[];
 const generated=Date.parse(data?.fetchedAt||'');
 if(!Number.isFinite(generated)||generated>nowMs+15000||nowMs-generated>110000)return[];
 const current=Number(quote.last);
 // Recheck the actual quote and official model calculated from this observation.
 if(!positive(model.price)||Math.abs(Number(model.price)-current)>Math.max(.02,current*.0006))return[];
 const zones=[model.raw?.first,model.raw?.second,model.raw?.third];
 const independent=data?.researchGateAudit?.[code],out=[];
 for(let j=0;j<3;j++){
  const z=zones[j];
  if(!positive(z?.low)||!positive(z?.high)||z.high<z.low||current<z.low||current>z.high)continue;
  const layer=j+1;
  out.push({
   id:eventId(code,day,layer),version:VERSION,code,day,layer,
   observedAt:new Date(nowMs).toISOString(),quoteFetchedAt:quote.serverFetchedAt,
   quoteTime:quote.time||null,source:String(quote.source||'').slice(0,100),
   price:round(current),zone:{low:round(z.low),high:round(z.high)},
   initialDecision:'BLOCKED_HARD_GATE',officialScore:finite(model.score)?Number(model.score):null,
   officialHardGate:true,reason:String(model.hardVetoReason).slice(0,180),
   environmentScore:finite(model.environmentScore)?Number(model.environmentScore):null,
   healthScore:finite(model.health?.score)?Number(model.health.score):null,
   healthUsable:model.health?.usable===true,chaseRisk:finite(model.chaseRisk)?Number(model.chaseRisk):null,
   officialModelVariant:'official',independentGateAudit:independent?{
    originalCount:independent.existing?.flagCount??null,
    independentCount:independent.independent?.flagCount??null,
    hits:(independent.flags||[]).filter(x=>x.hit).map(x=>x.id)
   }:null,
   // This is LIVE observed quote in a zone, NOT the user browser's two-cycle
   // CONFIRMED_IN, and NOT a guaranteed executable market price.
   evidence:'LIVE_QUOTE_INSIDE_ZONE_NOT_CONFIRMED',
   entryBasis:'hypothetical-observed-live-quote-no-execution',
   classification:'FORWARD_SHADOW_ONLY'
  });
 }
 return out;
}
function eventId(code,day,layer){return'__GATE_BLOCKED_EVT_'+code+'_'+day.replaceAll('-','')+'_L'+layer}
function evaluate(record,rows,today){
 if(!record||!validDay(today))return null;
 const result=TREND.outcome(record.price,record.day,null,rows,today);
 return{...record,outcome:result};
}
const mean=rows=>rows.length?rows.reduce((sum,x)=>sum+x,0)/rows.length:null;
function metrics(events,h){
 const x=events.map(e=>e.outcome?.horizons?.[h]).filter(x=>finite(x?.netReturnPct));
 return{matured:x.length,meanNetPct:round(mean(x.map(v=>Number(v.netReturnPct)))),
  winRatePct:x.length?round(x.filter(v=>v.netReturnPct>0).length/x.length*100):null,
  meanMAEPct:round(mean(x.map(v=>Number(v.maePct)).filter(Number.isFinite))),
  meanMFEPct:round(mean(x.map(v=>Number(v.mfePct)).filter(Number.isFinite)))};
}
function summarize(events){
 const all=events.filter(e=>CODES.includes(e.code)),byCode={};
 for(const code of CODES){
  const subset=all.filter(e=>e.code===code),byLayer={};
  for(const layer of [1,2,3]){
   const layerRows=subset.filter(e=>e.layer===layer);
   byLayer['L'+layer]={events:layerRows.length,byHorizon:Object.fromEntries([5,20,60].map(h=>[h,metrics(layerRows,h)]))};
  }
  byCode[code]={events:subset.length,byLayer,
   byHorizon:Object.fromEntries([5,20,60].map(h=>[h,metrics(subset,h)]))};
 }
 return{events:all.length,byCode,
  byHorizon:Object.fromEntries([5,20,60].map(h=>[h,metrics(all,h)]))};
}
module.exports={CODES,VERSION,RECORD_CODE,LEASE_ID,observationCandidates,eventId,evaluate,metrics,summarize};
