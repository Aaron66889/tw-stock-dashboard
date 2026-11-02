'use strict';
/**
 * Post-cash-close production smoke: verifies actual Render API returns a real
 * same-day cash open for each ETF, and the formal L1 upper bound <= its risk-adjusted ATR policy limit.
 * The script is read-only, does not touch user trades/holdings, and never
 * records fake observations or completes model signals.
 */
const BASE=(process.env.SMOKE_BASE_URL||'https://tw-stock-dashboard-5.onrender.com').replace(/\/$/,'');
const ETFS=['0050','0056','00878','00919'];
const SessionEntry=require('../public/session-entry-policy');
function taipeiDay(d=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(d).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
async function get(path,{max=3}={}){
 let problem=null;
 for(let n=1;n<=max;n++){
  try{
   const r=await fetch(BASE+path,{headers:{'Accept':'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(80000)});
   if(!r.ok)throw Error('HTTP '+r.status+' '+path);
   return await r.json();
  }catch(e){problem=e;if(n<max)await new Promise(ok=>setTimeout(ok,5000*n))}
 }
 throw problem;
}
async function run(){
 const today=taipeiDay(), now=new Date(),hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',hour:'2-digit',hour12:false}).format(now));
 const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',weekday:'short'}).format(now);
 console.log('Target: '+BASE+' / Taipei day '+today+' / '+weekday+' '+hour+':xx');
 const h=await get('/api/health');
 console.log('Health: '+JSON.stringify({ok:h.ok,build:h.build,version:h.version}));
 if(h.ok===false)throw Error('Backend health returned ok:false');
 const [live,buy]=await Promise.all([get('/api/etf-live'),get('/api/buy-model')]);
 const eligible=['Mon','Tue','Wed','Thu','Fri'].includes(weekday)&&hour>=9;
 const issues=[];
 for(const code of ETFS){
  const q=buy.quotes?.[code]||live.quotes?.[code]||{};
  const model=buy.models?.[code],st=buy.quoteStatus?.[code]||{};
  const open=Number(st.open??q.open),L1=Number(model?.raw?.first?.high);
  const gate=model?.decisionGate?.status||null;
  const session=model?.firstLayerCalibration?.sessionOpenPolicy||{};
  const version=String(model?.firstLayerCalibration?.version||'');
  const isFlex=version.startsWith('first-touch-flex-v4')||version.startsWith('first-touch-depth-v5');
  const isDepth=version.startsWith('first-touch-depth-v5');
  const policy=SessionEntry.calculate({open,referenceClose:model?.prevClose,atr:model?.history?.atr14,
   environmentScore:model?.environmentScore,chaseRisk:model?.chaseRisk,
   chaseWarningThreshold:model?.chaseWarningThreshold,
   chaseHardThreshold:model?.chaseHardThreshold,hardVeto:model?.hardVeto});
  const cap=isFlex?Number(session.maxFirstZoneHigh):open;
  let result='OFF_HOURS_CHECK';
  if(eligible){
   if(model?.error){
    result='SAFE_BLOCK_MODEL_ERROR';
    // A missing verified opening price is a safe fallback but a failure of
    // operational readiness: surface it for repair rather than hiding it.
    issues.push(code+' cannot publish valid L1: '+model.error);
   }else if(!(open>0)||st.openVerified!==true){
    result='FAIL_OPEN_UNVERIFIED';
    issues.push(code+' model issued without independently date-verified open');
   }else if(isFlex&&(!(policy.active)||Math.abs(policy.maxFirstZoneHigh-cap)>.002)){
    result='FAIL_L1_POLICY_MISMATCH';
    issues.push(code+' reported cap='+cap+' differs from independent risk policy '+policy.maxFirstZoneHigh);
    }else if(isDepth&&(!(session.minimumDepth>0)||!(session.referenceClose>0)||
    !(cap<=Number(session.referenceClose)-Number(session.minimumDepth)+.002))){
    result='FAIL_MINIMUM_RETRACE_MISSING';
    issues.push(code+' missing actual ATR-depth gate; cap='+cap+' close='+session.referenceClose);
   }else if(!(L1>0)||!(cap>0)||L1>cap+.001){
    result='FAIL_L1_ABOVE_RISK_CAP';
    issues.push(code+' L1 high='+L1+' exceeds independently checked cap='+cap+' opening='+open);
   }else result=isDepth?'PASS_MINIMUM_DEPTH':isFlex?'PASS_ATR_LIMITED_CAP':'PASS_LEGACY_OPEN_CAP';
  }
  console.log(JSON.stringify({code,marketDate:q.date||null,price:Number(q.last)||null,open:Number.isFinite(open)?open:null,openSource:st.openSource||q.openSource||null,openVerified:st.openVerified===true,l1High:Number.isFinite(L1)?L1:null,l1PolicyCap:Number.isFinite(cap)?cap:null,sessionHeadroom:isFlex?session.headroom:null,effectivePriorClose:isDepth?session.referenceClose:null,minDepth:isDepth?session.minimumDepth:null,currentToL1:Number(q.last)-L1,mode:isFlex?session.mode:'LEGACY',gate,modelFresh:buy.modelFreshByCode?.[code],modelError:model?.error||null,result}));
 }
 if(eligible&&issues.length)throw Error(issues.length+' ETF live checks failed: '+issues.join(' | '));
 console.log('Production cash-open smoke '+(eligible?'PASS':'SKIP: preopen/non-session time'));
}
run().catch(e=>{console.error('Production cash-open smoke FAILED:',e?.message||String(e));process.exitCode=1});
