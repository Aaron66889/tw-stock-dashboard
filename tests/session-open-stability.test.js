'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const client=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
function cut(src,start,end){const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,'source delimiters found: '+start);return src.slice(a,b)}
const openFns=cut(server,'function verifiedEtfOpen(code,day){','\n// Independent dated quote providers');
const restore=cut(server,'async function restoreVerifiedOpensCloud(){','\nfunction officialQuoteDay(');
const clientFns=cut(client,'function buySnapshotFullyValid(d){','\nasync function loadBuy(){');
const day='2026-11-03',names=['0050','0056','00878','00919'];
test('verified session open is stable, day-scoped and saved without altering the trading gate',async()=>{
 const state={},timers=[],writes=[];
 const deps={ETF:names,ETF_SESSION_OPENS:state,ETF_OPEN_CACHE_FILE:'open.json',ETF_OPEN_META_ID:'__ETF_VERIFIED_OPENS__',
  ETF_OPEN_SAVE_TIMER:null,SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test-secret',
  ymdTaipei:()=>day,diskWrite:(name,obj)=>writes.push({name,obj:JSON.parse(JSON.stringify(obj))}),
  clearTimeout:()=>{},setTimeout:fn=>{timers.push(fn);return timers.length;},
  persistOperationalMetaCloud:async(id,code,payload)=>{writes.push({cloud:true,id,code,payload});}};
 const funcs=new Function('d','let {ETF,ETF_SESSION_OPENS,ETF_OPEN_CACHE_FILE,ETF_OPEN_META_ID,ETF_OPEN_SAVE_TIMER,SUPABASE_URL,SUPABASE_SECRET_KEY,ymdTaipei,diskWrite,clearTimeout,setTimeout,persistOperationalMetaCloud}=d;'+openFns+';return {verifiedEtfOpen,storeVerifiedEtfOpen};')(deps);
 funcs.storeVerifiedEtfOpen('0050','2026-11-02',104,'previous session');
 assert.equal(funcs.verifiedEtfOpen('0050',day),null);
 funcs.storeVerifiedEtfOpen('0050',day,103.1,'Yahoo verified chart');
 assert.equal(funcs.verifiedEtfOpen('0050',day).price,103.1);
 assert.ok(writes.some(x=>x.name==='open.json'));
 assert.equal(timers.length,1);
 timers[0]();await Promise.resolve();
 assert.equal(writes.filter(x=>x.cloud).length,1);
 const payload=writes.find(x=>x.cloud).payload;
 assert.equal(payload.day,day);assert.equal(payload.opens['0050'].price,103.1);
 funcs.storeVerifiedEtfOpen('0050',day,103.1,'Yahoo verified chart');
 assert.equal(timers.length,1,'identical verified price must not rewrite');
});
test('cloud restore accepts only same-day validated opens, leaving existing local validations untouched',async()=>{
 const state={'0050':{day,price:103,source:'TWSE MIS'}},writes=[];
 const deps={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test',ETF_OPEN_META_ID:'__ETF_VERIFIED_OPENS__',
  ETF_OPEN_CACHE_FILE:'open.json',ETF_SESSION_OPENS:state,ETF:names,
  operationalMetaCloudPayload:async()=>({day,opens:{
   '0050':{day,price:109,source:'cloud old'},
   '0056':{day,price:56.9,source:'Yahoo chart'},
   '00878':{day:'2026-11-02',price:35.3,source:'old date'}
  }}),ymdTaipei:()=>day,diskWrite:(key,value)=>writes.push({key,value})};
 const run=new Function('d','const {SUPABASE_URL,SUPABASE_SECRET_KEY,ETF_OPEN_META_ID,ETF_OPEN_CACHE_FILE,ETF_SESSION_OPENS,ETF,operationalMetaCloudPayload,ymdTaipei,diskWrite}=d;'+restore+';return restoreVerifiedOpensCloud;')(deps);
 await run();
 assert.equal(state['0050'].price,103);
 assert.equal(state['0056'].price,56.9);
 assert.equal(state['00878'],undefined);
 assert.equal(writes.length,1);
});
test('failed models never become last-good snapshots; display replay is strictly non-tradable',()=>{
 const iso=new Date().toISOString(),localDay=new Date(iso).toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
 const good={ok:true,fetchedAt:iso,models:Object.fromEntries(names.map(c=>[c,{code:c,raw:{first:{low:1,high:2}},score:60,hardVeto:false}])),
  modelFreshByCode:Object.fromEntries(names.map(c=>[c,true])),shadowModels:{}};
 const deps={ETF:names,dayKey:()=>localDay,loadLastGood:()=>({at:iso,data:good})};
 const funcs=new Function('d','const {ETF,dayKey,loadLastGood}=d;'+clientFns+';return {buySnapshotFullyValid,lastValidBuySnapshot,readOnlyBuyReplay};')(deps);
 assert.equal(funcs.buySnapshotFullyValid(good),true);
 const invalid={...good,models:{...good.models,'0056':{code:'0056',error:'TWSE timed out'}}};
 assert.equal(funcs.buySnapshotFullyValid(invalid),false);
 assert.ok(funcs.lastValidBuySnapshot()?.data);
 const replay=funcs.readOnlyBuyReplay(good,names,'API timeout');
 for(const c of names){
  assert.equal(replay.modelFreshByCode[c],false);
  assert.equal(replay.models[c].hardVeto,true);
  assert.equal(replay.models[c]._displayOnlyStale,true);
  assert.equal(good.models[c].hardVeto,false);
 }
 assert.match(client,/if\(!failed.length&&buySnapshotFullyValid\(d\)\)saveLastGood\('buy',d\)/);
 assert.match(client,/if\(r&&!r.error&&!r._displayOnlyStale\)updateOne/);
});
