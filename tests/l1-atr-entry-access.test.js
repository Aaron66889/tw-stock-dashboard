'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Policy=require('../public/session-entry-policy');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const m=(p={})=>Policy.calculate({
 open:103.40,referenceClose:104.95,atr:2.04,environmentScore:-51,chaseRisk:26,
 chaseWarningThreshold:80,chaseHardThreshold:88,hardVeto:false,...p
});
test('Nov 2 0050 L1 demands a real retracement from verified effective prior close, not 0.11 from current',()=>{
 const p=m();
 assert.equal(p.active,true);
 assert.equal(p.mode,'MINIMUM_PULLBACK');
 assert.ok(p.openCeiling>103.4&&p.openCeiling<104.1,'Opening reference may have headroom');
 assert.ok(p.maxFirstZoneHigh<103.75&&p.maxFirstZoneHigh>103.4,'Depth filter prevents shallow 103.99');
 assert.ok(p.maxFirstZoneHigh<104.10-.35,'No 0.11-touch buy-point');
 assert.ok(Math.abs(p.referenceClose-p.minimumDepth-p.maxFirstZoneHigh)<1e-8);
 assert.ok(p.minimumAtr>=.6&&p.minimumAtr<=.8);
 assert.equal(p.version,'l1-session-depth-v2');
});
test('deeper weak-market discounts are monotonic, without continuously following current quote',()=>{
 const fair=m({environmentScore:-20}),weak=m({environmentScore:-51}),weaker=m({environmentScore:-61});
 assert.ok(fair.maxFirstZoneHigh>weak.maxFirstZoneHigh);
 assert.ok(weak.maxFirstZoneHigh>weaker.maxFirstZoneHigh);
 assert.equal(weaker.minimumAtr,.705);
 for(const price of [103.4,104.1,105.2,100]){
  assert.equal(m({last:price}).maxFirstZoneHigh,weak.maxFirstZoneHigh);
 }
});
test('headroom and minimum discount are each bounded, all four ETF scales work',()=>{
 for(const [open,prev,atr] of [[34.79,35.2,.6],[55.5,56,1],[103.4,104.95,2.04],[300,305,8]]){
  const p=m({open,referenceClose:prev,atr,environmentScore:20});
  assert.ok(p.headroom<=atr*.4+1e-8);
  assert.ok(p.headroom<=open*.008+1e-8);
  assert.ok(p.maxFirstZoneHigh<=p.openCeiling+1e-8);
  assert.ok(p.maxFirstZoneHigh<=prev-p.minimumDepth+1e-8);
  assert.ok(p.minimumDepth>=atr*.4-1e-8);
 }
});
test('hard risk, missing open or absent previous close fail closed instead of inventing entries',()=>{
 for(const p of [{chaseRisk:81},{chaseRisk:90},{environmentScore:-70},{hardVeto:true}]){
  const r=m(p);
  assert.equal(r.headroom,0,JSON.stringify(p));
  assert.ok(r.maxFirstZoneHigh<=103.40);
 }
 assert.equal(m({open:null}).active,false);
 assert.equal(m({referenceClose:null}).mode,'STRICT_OPEN_NO_REFERENCE');
 assert.equal(m({referenceClose:null}).maxFirstZoneHigh,103.40);
 assert.equal(m({atr:null}).maxFirstZoneHigh,103.40);
 assert.equal(m({environmentScore:null}).maxFirstZoneHigh,103.40);
});
test('official model uses independent effective-close discount, preserves L2/3 and market risk veto',()=>{
 assert.match(server,/SESSION_ENTRY\.calculate/);
 assert.match(server,/referenceClose:prev,atr/);
 assert.match(server,/entryPolicy\.maxFirstZoneHigh-zoneW/);
 assert.match(server,/l2=Math\.min\(l2,l1-/);
 assert.match(server,/l3=Math\.min\(l3,l2-/);
 assert.match(server,/hardVeto=gatePolicy\.hardBlocked/);
 assert.match(server,/quote\?\.openVerified!==true/);
 assert.match(server,/maxFirstZoneHigh:entryPolicy\.active\?entryPolicy\.maxFirstZoneHigh/);
 assert.match(server,/first-touch-depth-v5-/);
});
const first=app.indexOf('function center(z)'),last=app.indexOf('function executionUpAllowance(',first);
const helper=app.slice(first,last);
test('iPhone obeys effective model L1 depth cap BELOW the session open for all four ETFs',()=>{
 const p=m(),day='2026-11-02',codes=['0050','0056','00878','00919'];
 const q=Object.fromEntries(codes.map(code=>[code,{date:day,open:103.4,prevClose:104.95}]));
 const models=Object.fromEntries(codes.map(code=>[code,{firstLayerCalibration:{
  sessionOpenPolicy:{active:true,sessionOpen:103.4,maxFirstZoneHigh:p.maxFirstZoneHigh,minimumDepth:p.minimumDepth}
 }}]));
 const ctx={lastBuy:{fetchedAt:'2026-11-02T07:42:00Z',models},
  lastLive:{quotes:q},Date,Intl,JSON,Math,Number,
  dayKey:()=>day,taipeiNow:()=>new Date(2026,10,2,15,42)};
 const live=vm.runInNewContext(helper+'\n({sessionFirstCeiling,enforceCashOpenCeiling})',ctx);
 for(const code of codes){
  const cap=live.sessionFirstCeiling(code);
  assert.ok(cap<103.75&&cap>=103.4);
  const zones=[{low:106.02,high:106.36},{low:102.36,high:102.70},{low:101.46,high:101.79}];
  const fixed=live.enforceCashOpenCeiling(code,zones,2.04);
  assert.ok(Math.abs(fixed[0].high-cap)<1e-7);
  assert.ok(fixed[1].high<fixed[0].high);
  assert.ok(fixed[2].high<fixed[1].high);
 }
});
test('old or missing server snapshot cannot fabricate a deeper limit',()=>{
 const day='2026-11-02',ctx={lastBuy:{fetchedAt:'2026-10-30T07:42:00Z',
  models:{'0050':{firstLayerCalibration:{sessionOpenPolicy:{active:true,sessionOpen:103.4,maxFirstZoneHigh:103.61}}}}},
  lastLive:{quotes:{'0050':{date:day,open:103.4}}},Date,Intl,Math,Number,JSON,
  dayKey:()=>day,taipeiNow:()=>new Date(2026,10,2,15,42)};
 const f=vm.runInNewContext(helper+'\nsessionFirstCeiling',ctx);
 assert.equal(f('0050'),103.4);
});
