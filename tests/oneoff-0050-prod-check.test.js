'use strict';
// One-off run in an isolated pull-request CI runner. Does not touch user data or production state.
const {test}=require('node:test');
test('PRODUCTION READ ONLY 0050 cash audit endpoint status and QA', {timeout:160000}, async()=>{
 const base='https://tw-stock-dashboard-5.onrender.com';
 for(const path of ['/api/history-status','/api/0050-cash-audit']){
  try{
   const start=Date.now(),r=await fetch(base+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(105000)});
   const content=await r.text();let json={};try{json=JSON.parse(content)}catch{json={rawResponse:content.slice(0,250)}} 
   console.log('LIVE_0050_AUDIT_PATH',path,'HTTP',r.status,'MS',Date.now()-start);
   if(path==='/api/0050-cash-audit'){
    console.log('LIVE_0050_AUDIT_RESULT',JSON.stringify({
     ok:json.ok,state:json.state,priceBasis:json.priceBasis,source:json.source,
     historyOfficial:json.historyOfficial,dividendFeedReportedComplete:json.dividendFeedReportedComplete,
     dividendErrors:json.dividendErrors,
     dividendCount:json.qa?.dividendCount,normalizedDividendCount:json.qa?.normalizedDividendCount,
     dividendBasis:json.qa?.dividendBasis,
     coverageByYear:json.qa?.coverageByYear,
     anchorChecks:json.qa?.anchorChecks,
     issues:json.qa?.issues,warnings:json.qa?.warnings,
     splitBoundary:json.qa?.splitBoundary,
     actualResearchComparison:json.comparison
    }));
   }else {
    const x=(json.history||[]).find(h=>h.code==='0050');
    console.log('LIVE_0050_HISTORY_STATUS',JSON.stringify({status:x?.status,rows:x?.rows,first:x?.first,last:x?.last,fullHistoryPass:x?.fullHistoryPass,backtestReadyPass:x?.backtestReadyPass,normalizationVersion:x?.validation?.normalizationVersion,error:x?.error}));
   }
  }catch(e){console.log('LIVE_0050_AUDIT_FETCH_ERROR',path,String(e))}
 }
});
