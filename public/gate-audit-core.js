/* October 2026 Gate audit: local-only comparison; never authorizes orders.
 * Uses immutable, forward-observed Gate events and this device's existing trades.
 * The cloud Gate API does NOT receive personal trades.
 */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.GateAuditCore=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const CODES=new Set(['0050','0056','00878','00919']);
 const RANGE={start:'2026-10-01',end:'2026-10-31'};
 const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 function category(e){
  const a=e?.independentGateAudit||{};
  const total=number(a.originalCount),independent=number(a.independentCount);
  if(total===null||independent===null)return'UNKNOWN';
  if(independent>=2)return'INDEPENDENT_BLOCK';
  if(total>=2&&independent<2)return'DERIVED_OVERLAP';
  return'UNKNOWN';
 }
 function dayOfTrade(t){
  const day=String(t?.entryDate||'');
  if(/^\d{4}-\d{2}-\d{2}$/.test(day))return day;
  const dt=Date.parse(t?.entryAt||'');
  if(!Number.isFinite(dt))return'';
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(dt));
 }
 function summarizeHorizon(events,h){
  const eligible=events.map(e=>e?.outcome?.horizons?.[h]).filter(x=>number(x?.netReturnPct)!==null);
  const n=eligible.length;
  const mean=field=>{const v=eligible.map(x=>number(x[field])).filter(x=>x!==null);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
  const pct=mean('netReturnPct');
  return{matured:n,pending:events.length-n,meanNetPct:pct,winRatePct:n?eligible.filter(x=>Number(x.netReturnPct)>0).length/n*100:null,
   meanMAEPct:mean('maePct'),meanMFEPct:mean('mfePct')};
 }
 function audit(events,trades,range=RANGE){
  const first=String(range?.start||RANGE.start),last=String(range?.end||RANGE.end);
  const rows=(Array.isArray(events)?events:[]).filter(e=>CODES.has(e?.code)&&e?.day>=first&&e?.day<=last);
  const byId=new Map();for(const e of rows){const k=e.id||[e.code,e.day,e.layer].join(':');if(!byId.has(k))byId.set(k,e)}
  const observed=[...byId.values()].sort((a,b)=>String(a.observedAt||'').localeCompare(String(b.observedAt||'')));
  const seenTrades=new Set(),validTrades=[];
  for(const t of Array.isArray(trades)?trades:[]){
   if(!t||t._deleted||!CODES.has(t.code))continue;
   const day=dayOfTrade(t);if(day<first||day>last)continue;
   const id=String(t.id||[t.code,t.entryAt,t.entryPrice,t.shares].join(':'));
   if(seenTrades.has(id))continue;seenTrades.add(id);
   const type=t.tradeType==='manual'||t.modelFamily==='manual'?'manual':t.tradeType==='model'?'model':'other';
   validTrades.push({...t,_auditDay:day,_auditType:type});
  }
  const classification={DERIVED_OVERLAP:0,INDEPENDENT_BLOCK:0,UNKNOWN:0},detailed=observed.map(e=>{
   const type=category(e);classification[type]++;
   const matching=validTrades.filter(t=>t.code===e.code&&t._auditDay===e.day);
   const at=Date.parse(e.observedAt||'');
   const counted={modelBefore:0,modelAfter:0,manualBefore:0,manualAfter:0,unknownTime:0};
   for(const t of matching){
    const entry=Date.parse(t.entryAt||'');
    if(!Number.isFinite(at)||!Number.isFinite(entry)){counted.unknownTime++;continue}
    if(t._auditType==='model')counted[entry<at?'modelBefore':'modelAfter']++;
    if(t._auditType==='manual')counted[entry<at?'manualBefore':'manualAfter']++;
   }
   return{event:e,category:type,sameDayTrades:counted};
  });
  const groups={};
  for(const type of ['DERIVED_OVERLAP','INDEPENDENT_BLOCK','UNKNOWN']){
   const group=observed.filter(x=>category(x)===type);
   groups[type]={observations:group.length,horizons:Object.fromEntries([5,20,60].map(h=>[h,summarizeHorizon(group,h)]))};
  }
  return{
   start:first,end:last,observations:observed.length,uniqueDays:new Set(observed.map(x=>x.day)).size,
   uniqueCodeDays:new Set(observed.map(x=>x.code+':'+x.day)).size,
   classification,groups,detailed,
   trades:{available:Array.isArray(trades),total:validTrades.length,
    manual:validTrades.filter(t=>t._auditType==='manual').length,
    model:validTrades.filter(t=>t._auditType==='model').length,
    other:validTrades.filter(t=>t._auditType==='other').length},
   horizons:Object.fromEntries([5,20,60].map(h=>[h,summarizeHorizon(observed,h)])),
   limitation:'一筆被擋報價不是整日被擋，也不是可執行成交。10月前向事件僅涵蓋已實際觀測的報價；缺失時段無法回填。實際交易與被擋事件是不同樣本，不可直接拿均值判定哪個策略更好。'
  };
 }
 return{RANGE,category,dayOfTrade,summarizeHorizon,audit};
});
