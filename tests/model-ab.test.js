'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ab=require('../public/model-ab.js');
const reasonable=(data={})=>({
 code:'0050',entryDate:'2026-10-13',entryAt:'2026-10-13T03:00:00Z',
 tradeType:'model',modelFamily:'reasonable',layer:1,
 snapshot:{score:52,modelStatusText:'第1層已確認／可分批',confirmationRule:{minScore:50}},...data
});
test('Gate pause overrides apparent confirmation',()=>{
 assert.equal(ab.classify(reasonable({snapshot:{score:42,modelStatusText:'第1層價格已確認／Gate暫停',confirmationRule:{minScore:50}}})),'blocked');
});
test('Saved score threshold, not current threshold, controls historical classification',()=>{
 assert.equal(ab.classify(reasonable({snapshot:{score:45,modelStatusText:'第1層已確認／可分批',confirmationRule:{minScore:50}}})),'blocked');
 assert.equal(ab.classify(reasonable({snapshot:{score:45,modelStatusText:'第1層已確認／可分批'}})),'signaled');
});
test('Manual, observing, confirmed and trend trades remain separate',()=>{
 assert.equal(ab.classify(reasonable({tradeType:'manual'})),'manual');
 assert.equal(ab.classify(reasonable({snapshot:{score:53,modelStatusText:'觸價觀察／形成中'}})),'review');
 assert.equal(ab.classify(reasonable()),'signaled');
 assert.equal(ab.classify({...reasonable(),modelFamily:'trend',snapshot:{score:97,modelStatusText:'順勢買點成立／可小額'}}),'signaled');
});
test('Missing OOS policy data is not fabricated',()=>{
 assert.deepEqual(ab.comparePolicies([reasonable()]),[]);
});
test('OOS snapshot latest valid policy per ETF retained',()=>{
 const policy={ready:true,selectedId:'deeper-2',confidence:'LOW',wfCount:1,oosMetrics:{signals:11,avg20:4.76},baselineOosMetrics:{signals:11,avg20:4.76}};
 const a=reasonable({code:'00919',snapshot:{shadow:{policy}}});
 assert.equal(ab.comparePolicies([a,a]).length,1);
 assert.equal(ab.comparePolicies([a])[0].signals,11);
});
test('Maturity counts signaled records only and requires present horizon',()=>{
 const trade=reasonable({perf:{horizon:{5:{totalReturnPct:1.2},20:null}}});
 const blocked=reasonable({snapshot:{score:42,modelStatusText:'Gate暫停'},perf:{horizon:{5:{totalReturnPct:-10}}}});
 const result=ab.summary([trade,blocked]);
 assert.equal(result.maturity[5].count,1);
 assert.equal(result.maturity[20].count,0);
 assert.equal(result.groups.blocked.length,1);
});
test('Same-day trend entries are grouped only as candidate events',()=>{
 const a={...reasonable(),code:'0050',modelFamily:'trend',snapshot:{score:97,modelStatusText:'可小額'}};
 const b={...a,entryAt:'2026-10-13T04:00:00Z'};
 const r=ab.summary([a,b]);
 assert.equal(r.trendTrades,2);
 assert.equal(r.trendEvents,1);
});