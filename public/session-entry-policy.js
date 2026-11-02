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
 function calculate({open,atr,environmentScore,chaseRisk,chaseWarningThreshold=80,
  chaseHardThreshold=88,hardVeto=false}={}){
  const o=Number(open),a=Number(atr),env=Number(environmentScore),risk=Number(chaseRisk);
  if(!(o>0))return{active:false,maxFirstZoneHigh:null,headroom:0,mode:'NO_VERIFIED_OPEN',version:'l1-session-flex-v1'};
  const valid=finite(atr)&&atr>0&&finite(environmentScore)&&finite(chaseRisk);
  const defensive=hardVeto||!valid||env<=-65||risk>=Number(chaseWarningThreshold)||risk>=Number(chaseHardThreshold);
  // Max 0.40 ATR and 0.8% of the exchange-verified open; bearish but
  // non-critical environments reduce the headroom further.
  const envFactor=Math.max(.6,Math.min(1,1+Math.min(0,env)/200));
  const headroom=defensive?0:Math.max(0,Math.min(a*.4,o*.008)*envFactor);
  return{active:true,maxFirstZoneHigh:o+headroom,headroom,
   mode:defensive?'STRICT_OPEN':'ATR_LIMITED',
   version:'l1-session-flex-v1',
   explain:defensive?'市場風險較高，第一層不超過今日開盤價':'市場風險允許時，第一層可在開盤價上方有限ATR範圍內等待回檔確認'};
 }
 return Object.freeze({calculate});
});
