'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const policy=require('../gate-policy');
const lab=require('../crash-gate-lab');
const root=path.join(__dirname,'..');
test('old 2 votes included derived environment; new official gate does not double-count',()=>{
 const args={marketPct:-2.6,tsmcPct:-1.1,breadthRatio:.40,breadthUsable:true,environmentScore:-81,fresh:true};
 const r=policy.evaluate(args),a=lab.analyzeGate(args);
 assert.equal(r.legacy.count,2);
 assert.equal(r.legacy.blocked,true);
 assert.equal(r.independent.count,1);
 assert.equal(r.hardBlocked,false);
 assert.equal(r.overlapRisk,true);
 assert.equal(a.effective.blocked,r.hardBlocked);
 assert.equal(a.doubleCountRisk,true);
});
test('two independent risks still hard-block, regardless of composite environment',()=>{
 for(const args of [
  {marketPct:-2.4,tsmcPct:-3.2,breadthUsable:false,environmentScore:10},
  {marketPct:-2.6,tsmcPct:-1,breadthUsable:true,breadthRatio:.15,environmentScore:10},
  {marketPct:-1.2,tsmcPct:-3.5,breadthUsable:true,breadthRatio:.20,environmentScore:30}
 ]){
  const p=policy.evaluate(args);
  assert.equal(p.hardBlocked,true);
  assert.equal(p.independent.count,2);
  assert.match(p.reason,/至少兩項獨立急殺/);
  assert.equal(lab.analyzeGate(args).effective.blocked,true);
 }
});
test('missing inputs cannot create phantom independent risk votes',()=>{
 for(const args of [
  {marketPct:null,tsmcPct:null,breadthUsable:false,environmentScore:-99},
  {marketPct:-2.6,tsmcPct:null,breadthUsable:true,breadthRatio:NaN,environmentScore:-80},
  {marketPct:NaN,tsmcPct:undefined,breadthUsable:true,breadthRatio:.19,environmentScore:-75},
 ]){
  const r=policy.evaluate(args);
  assert.equal(r.independent.count<=1,true);
  assert.equal(r.hardBlocked,false);
 }
});
test('stale observations and missing ex-right/dividend reference remain hard-stopped',()=>{
 for(const args of [{fresh:false},{corpActionBlocked:true}]){
  const r=policy.evaluate(args);
  assert.equal(r.hardBlocked,true);
  assert.equal(lab.analyzeGate(args).effective.blocked,true);
 }
});
const src=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const start=src.indexOf('function officialExecutionSnapshotReady('),end=src.indexOf('function officialExecutionExplanation(',start);
if(start<0||end<0)throw Error('official execution checker missing');
const checkSource=src.slice(start,end)+'\nofficialExecutionSnapshotReady';
function check(modelChanges={},quoteChanges={}){
 const now=Date.parse('2026-10-30T03:00:30Z'),asOf=new Date(now-30000).toISOString();
 const lastBuy={fetchedAt:asOf,modelFreshByCode:{'0050':true},...modelChanges};
 const lastLive={quotes:{'0050':{last:108.2,date:'2026-10-30',fetchTime:asOf,realtime:true,lastGoodFallback:false,...quoteChanges}}};
 const fn=vm.runInNewContext(checkSource,{lastBuy,lastLive,dayKey:()=> '2026-10-30',Date});
 return fn('0050',now);
}
test('true fresh quote and model snapshot permits evaluation',()=>{assert.equal(check(),true)});
test('no new model confirmations from prior-date or stale model/quote',()=>{
 for(const [m,q] of [
  [{fetchedAt:'2026-10-30T02:50:00Z'},{}],
  [{modelFreshByCode:{'0050':false}},{}],
  [{},{date:'2026-10-29'}],
  [{},{fetchTime:'2026-10-30T02:50:00Z'}],
  [{},{realtime:false}],
  [{},{lastGoodFallback:true}],
  [{},{corporateActionReferenceMissing:true}],
  [{},{last:0}],
 ]){
  assert.equal(check(m,q),false,JSON.stringify({m,q}));
 }
});
test('all three official model execution paths require a fresh snapshot',()=>{
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert.match(server,/const gatePolicy=OFFICIAL_GATE\.evaluate/);
 assert.match(server,/hardVeto=gatePolicy\.hardBlocked/);
 assert.match(server,/riskGate:gatePolicy/);
 assert.match(src,/const gatePass=executionFresh&&!r\.hardVeto/);
 assert.equal((src.match(/if\(confirmable&&officialExecutionSnapshotReady\(code\)&&cashSessionIsOpenForNewConfirmation\(\)\)/g)||[]).length,2);
 assert.match(src,/if\(!officialExecutionSnapshotReady\(code\)\)return alert/);
 assert.match(src,/if\(!x\|\|!officialExecutionSnapshotReady\(code\)/);
 assert.match(src,/!officialExecutionSnapshotReady\(selectedETF\)/);
});
