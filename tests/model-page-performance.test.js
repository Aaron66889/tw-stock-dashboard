'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
function between(text,start,end){
 const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
 assert.ok(a>=0 && b>a,'cannot extract '+start);
 return text.slice(a,b);
}
test('dividend API combines four code-specific future distribution events instead of undefined out-of-scope events',async()=>{
 const fn=between(server,'async function dividendAutoReport(){','// R3.81: optimistic concurrency');
 const sampleEvents={
  '0050':[{exDate:'2026-11-10',payDate:'2026-12-01',amount:1.1}],
  '0056':[{exDate:'2026-10-22',payDate:'2026-11-11',amount:1.72}],
  '00878':[{exDate:'2026-12-22',payDate:'2027-01-15',amount:.4}],
  '00919':[{exDate:'2026-12-20',payDate:'2027-01-10',amount:.5}]
 };
 const state={snapshots:[{day:'2026-10-15',holdings:{'0050':10,'0056':20,'00878':30,'00919':40},recordedAt:'2026-10-15T08:00:00Z'}],locked:{}};
 const ctx={
  ETF:Object.keys(sampleEvents),DIVIDEND_BASE:{},DIVIDEND_AUTO_START:'2026-09-22',
  DIVIDEND_BASE_ASOF:'2026-09-22',DIVIDEND_BOOTSTRAP_LOCKS:{},BUILD:'test',
  ymdTaipei:()=> '2026-10-16',cloudDividendState:async()=>({state,updatedAt:null}),
  cloudHoldingsState:async()=>({initialized:true,holdings:state.snapshots[0].holdings,updatedAt:null}),
  dividendHoldingMap:x=>x,
  twseDividendEvents:async code=>({ok:true,events:sampleEvents[code],source:'test'}),
  deadline:async p=>await p,
  twseDistributionAnnouncementMap:async()=>({ok:true,byCode:{},errors:[],source:'test'}),
  latestDividendSnapshot:s=>s.at(-1),
  latestDividendSnapshotBefore:s=>s.at(-1),
  saveCloudDividendState:async state=>state,
  dividendNextForecast:(code,events)=>({code,usedCount:events.length,firstExDate:events[0]?.exDate}),
  Date,Object,Number,Math,Promise,
 };
 vm.runInNewContext(fn,ctx,{filename:'dividendAutoReport.js'});
 const result=await ctx.dividendAutoReport();
 assert.equal(result.ok,true);
 assert.deepEqual(Object.keys(result.byCode).sort(),Object.keys(sampleEvents).sort());
 for(const code of Object.keys(sampleEvents)){
  assert.equal(result.byCode[code].nextForecast.code,code);
  assert.equal(result.byCode[code].nextForecast.usedCount,1);
  assert.equal(result.byCode[code].nextForecast.firstExDate,sampleEvents[code][0].exDate);
 }
});
test('identical simultaneous official model requests run computation just once per cache key',async()=>{
 const code=between(server,'async function cached(key,ttl,fn){','function stripTags(');
 const ctx={cache:new Map(),CACHE_INFLIGHT:new Map(),Date,Promise,Map};
 vm.runInNewContext(code,ctx);
 let calls=0;const factory=async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));return{ok:true,code:'0050'}};
 const rows=await Promise.all(Array.from({length:9},()=>ctx.cachedSingleFlight('buy-model',5000,factory)));
 assert.equal(calls,1);
 assert.equal(rows.length,9);
 assert.ok(rows.every(x=>x.ok===true && x.code==='0050'));
 await ctx.cachedSingleFlight('buy-model',5000,factory);
 assert.equal(calls,1);
});
test('rejected cached model promise is removed so next request can try again',async()=>{
 const code=between(server,'async function cached(key,ttl,fn){','function stripTags(');
 const ctx={cache:new Map(),CACHE_INFLIGHT:new Map(),Date,Promise,Map};
 vm.runInNewContext(code,ctx);
 let calls=0;
 const factory=async()=>{calls++;if(calls===1)throw Error('transient');return{ok:true}};
 await assert.rejects(()=>ctx.cachedSingleFlight('buy',4000,factory),/transient/);
 const answer=await ctx.cachedSingleFlight('buy',4000,factory);
 assert.equal(answer.ok,true);assert.equal(calls,2);assert.equal(ctx.CACHE_INFLIGHT.size,0);
});
test('model validation visit avoids concurrent four-ETF historical research until deliberate button click',()=>{
 assert.match(app,/if\(id==='model'\)\{renderSpecs\(true\);loadValidation\(false\)/);
 assert.doesNotMatch(app,/CrashGateLabUI\?\.load\(false\)/);
 assert.match(html,/onclick="window\.CrashGateLabUI\?\.load\(true\)"/);
 assert.match(app,/GateBlockedUI\?\.load\(false\)/);
 assert.match(app,/setTimeout\(\(\)=>\{if\(document\.getElementById\('model'\)/);
 assert.equal(server.split("cachedSingleFlight('buymodel',8000,buyModel)").length-1,4);
 assert.equal(server.split("cached('buymodel',8000,buyModel)").length-1,0);
 assert.match(server,/dividendNextForecast\(code,allEvents\[code\]\|\|\[\],ann,/);
});
