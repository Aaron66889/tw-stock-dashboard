'use strict';
/*
 * Shared authoritative session-entry policy.
 * A cash-session open is a reference, NOT a universal maximum executable
 * limit price. A small volatility-based headroom is permitted only when
 * the model's independent risk filters do not signal high chase risk.
 * This module authorizes no trade: L1 still requires a new market quote,
 * a touched zone, a stable/rebounding price and an official Gate pass.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SessionEntryPolicy=api;
})(typeof window!=='undefined'?window:null,function(){
 const finite=x=>typeof x==='number'&&Number.isFinite(x);
 function calculate({open,referenceClose,atr,environmentScore,chaseRisk,chaseWarningThreshold=80,
  chaseHardThreshold=88,hardVeto=false}={}){
  const o=Number(open),ref=Number(referenceClose),a=Number(atr),
   env=Number(environmentScore),risk=Number(chaseRisk);
  if(!(o>0))return{active:false,maxFirstZoneHigh:null,headroom:0,mode:'NO_VERIFIED_OPEN',version:'l1-session-depth-v2'};
  // An exchange-verified open is necessary, but not sufficient to identify
  // a genuine dip: 0.11 below the current quote is not an entry rationale.
  const valid=typeof atr==='number'&&Number.isFinite(atr)&&atr>0&&
   typeof environmentScore==='number'&&Number.isFinite(environmentScore)&&
   typeof chaseRisk==='number'&&Number.isFinite(chaseRisk);
  const hasReference=typeof referenceClose==='number'&&Number.isFinite(referenceClose)&&ref>0;
  const defensive=hardVeto||!valid||env<=-65||
   risk>=Number(chaseWarningThreshold)||risk>=Number(chaseHardThreshold);
  const envFactor=Math.max(.6,Math.min(1,1+Math.min(0,env)/200));
  const headroom=defensive?0:Math.max(0,Math.min(a*.4,o*.008)*envFactor);
  const openCeiling=o+headroom;
  // Minimum *discount from a stable reference*, not an every-tick moving
  // target: 0.40 ATR in supportive markets, rising smoothly to at most
  // 0.80 ATR as the environment deteriorates.
  const minimumAtr=valid?Math.max(.4,Math.min(.8,.4+Math.max(0,-env)/200)):null;
  const minimumDepth=hasReference&&valid?
   Math.max(a*minimumAtr,ref*.0035):null;
  const referenceCeiling=minimumDepth===null?null:ref-minimumDepth;
  const cap=referenceCeiling!==null&&referenceCeiling>0?
   Math.min(openCeiling,referenceCeiling):o;
  const depthApplied=referenceCeiling!==null&&referenceCeiling>0&&
   referenceCeiling<openCeiling-1e-8;
  return{active:true,maxFirstZoneHigh:cap,headroom,openCeiling,
   referenceClose:hasReference?ref:null,referenceCeiling,
   minimumDepth,minimumAtr,depthApplied,
   mode:!hasReference||!valid?'STRICT_OPEN_NO_REFERENCE':
    depthApplied?'MINIMUM_PULLBACK':defensive?'STRICT_OPEN':'ATR_LIMITED',
   version:'l1-session-depth-v2',
   explain:depthApplied?'開盤價只是參考，第一層還須滿足相對有效昨收的最低ATR回檔深度':
    defensive?'市場風險較高，不放寬開盤上限':'仍須觸價並止跌，僅在風險允許時給予有限ATR上限'};

 }
 return Object.freeze({calculate});
});
