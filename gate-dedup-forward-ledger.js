'use strict';
/*
 * Prospective, read-only counterfactual ledger: an old four-vote crash Gate
 * WOULD hard-block, while the corrected independent-input Gate does not.
 * This is NOT a confirmed signal, an order, or evidence of a fill.
 */
const TREND=require('./trend-forward-ledger');
const GATE=require('./gate-blocked-ledger');
const VERSION='gate-dedup-forward-v1',RECORD_CODE='__GATE_DEDUP__';
const num=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const positive=x=>num(x)!==null&&Number(x)>0;
function eventId(code,day,layer){return'__GATE_DEDUP_EVT_'+code+'_'+String(day).replaceAll('-','')+'_L'+layer}
function observationCandidates(code,model,quote,data,{day,nowMs=Date.now()}={}){
 if(!GATE.CODES.includes(code)||!/^20\d{2}-\d{2}-\d{2}$/.test(day||'')||
   !Number.isFinite(nowMs)||data?.modelFreshByCode?.[code]!==true||
   !TREND.quoteValid(quote,day,nowMs))return[];
 const risk=model?.riskGate;
 if(!model||model.modelVariant!=='official'||model.hardVeto!==false||
   risk?.version!=='independent-crash-gate-v2'||
   risk?.legacy?.blocked!==true||risk?.independent?.blocked!==false||
   risk?.overlapRisk!==true||risk.hardBlocked===true||
   model.referenceReliable===false||model.corporateActionReferenceMissing===true)return[];
 const generated=Date.parse(data?.fetchedAt||'');
 if(!Number.isFinite(generated)||generated>nowMs+15000||nowMs-generated>110000)return[];
 const px=Number(quote.last);
 if(!positive(model.price)||Math.abs(model.price-px)>Math.max(.02,px*.0006))return[];
 const zones=[model.raw?.first,model.raw?.second,model.raw?.third];
 const out=[];
 for(let i=0;i<3;i++){
  const z=zones[i];
  // Strict live quote actually inside the zone, not inferred from today's low.
  if(!positive(z?.low)||!positive(z?.high)||z.high<z.low||px<z.low||px>z.high)continue;
  const layer=i+1;
  out.push({id:eventId(code,day,layer),version:VERSION,code,day,layer,
   observedAt:new Date(nowMs).toISOString(),quoteFetchedAt:quote.serverFetchedAt,quoteTime:quote.time||null,
   source:String(quote.source||'').slice(0,100),price:Number(px.toFixed(4)),
   zone:{low:Number(z.low.toFixed(4)),high:Number(z.high.toFixed(4))},
   initialDecision:'LEGACY_VETO_CURRENT_GATE_PASS',classification:'FORWARD_SHADOW_ONLY',
   evidence:'LIVE_QUOTE_INSIDE_ZONE_NOT_CONFIRMED',
   officialHardGate:false,officialScore:num(model.score),
   independentCount:risk.independent.count,legacyCount:risk.legacy.count,
   independentHits:risk.flags.filter(x=>x.hit&&x.group!=='derived').map(x=>x.id),
   reason:'舊四票模型會擋；現行獨立風險硬Gate未擋（仍須正式止跌確認）',
   entryBasis:'hypothetical-observed-live-quote-no-execution'});
 }
 return out;
}
module.exports={VERSION,RECORD_CODE,eventId,observationCandidates};
