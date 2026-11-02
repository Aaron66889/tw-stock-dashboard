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
 open:103.40,atr:2.04,environmentScore:-51,chaseRisk:26,
 chaseWarningThreshold:80,chaseHardThreshold:88,hardVeto:false,...p
});
test('0050 Nov 2: moderate risk allows bounded L1 headroom, not 106 and not rigid 103.40',()=>{
 const p=m();
 assert.equal(p.active,true);
 assert.equal(p.mode,'ATR_LIMITED');
 assert.ok(p.maxFirstZoneHigh>103.40);
 assert.ok(p.maxFirstZoneHigh<104.10);
 assert.ok(p.maxFirstZoneHigh<106.02);
 assert.ok(p.maxFirstZoneHigh-103.40<=2.04*.4);
});
test('atr and percent of open both cap headroom; not automatic chasing',()=>{
 for(const [open,atr] of [[34.79,.6],[55.5,1],[103.4,2.04],[300,8]]){
  const p=m({open,atr,environmentScore:20});
  assert.ok(p.headroom<=atr*.4+1e-8);
  assert.ok(p.headroom<=open*.008+1e-8);
 }
});
test('high chase score, bearish environment, hard Gate or missing inputs revert to strict opening cap',()=>{
 for(const p of [
  {chaseRisk:81},{chaseRisk:90},{environmentScore:-70},
  {hardVeto:true},{atr:null},{environmentScore:null}
 ]){
  const r=m(p);
  assert.equal(r.maxFirstZoneHigh,103.40,JSON.stringify(p));
  assert.equal(r.mode,'STRICT_OPEN');
 }
 assert.equal(m({open:null}).active,false);
});
test('backend official L1 uses bounded cap, all other three risk checks untouched',()=>{
 assert.match(server,/SESSION_ENTRY\.calculate/);
 assert.match(server,/entryPolicy\.maxFirstZoneHigh-zoneW/);
 assert.match(server,/l2=Math\.min\(l2,l1-/);
 assert.match(server,/l3=Math\.min\(l3,l2-/);
 assert.match(server,/hardVeto=gatePolicy\.hardBlocked/);
 assert.match(server,/quote\?\.openVerified!==true/);
 assert.match(server,/maxFirstZoneHigh:entryPolicy\.active\?entryPolicy\.maxFirstZoneHigh/);
 assert.match(server,/first-touch-flex-v4-/);
});
const first=app.indexOf('function center(z)'),last=app.indexOf('function executionUpAllowance(',first);
const helper=app.slice(first,last);
test('phone uses server ATR headroom rather than independently clamping back to raw open',()=>{
 const p=m(),day='2026-11-02',codes=['0050','0056','00878','00919'];
 const q=Object.fromEntries(codes.map(code=>[code,{date:day,open:null,prevClose:104.95}]));
 const models=Object.fromEntries(codes.map(code=>[code,{firstLayerCalibration:{
  sessionOpenPolicy:{active:true,sessionOpen:103.4,maxFirstZoneHigh:p.maxFirstZoneHigh,headroom:p.headroom}
 }}]));
 const ctx={lastBuy:{fetchedAt:'2026-11-02T07:42:00Z',models},
  lastLive:{quotes:q},Date,Intl,JSON,Math,Number,
  dayKey:()=>day,taipeiNow:()=>new Date(2026,10,2,15,42)};
 const live=vm.runInNewContext(helper+'\n({sessionFirstCeiling,enforceCashOpenCeiling})',ctx);
 for(const code of codes){
  const cap=live.sessionFirstCeiling(code);
  assert.ok(cap>103.40&&cap<104.10);
  const zones=[{low:106.02,high:106.36},{low:102.36,high:102.70},{low:101.46,high:101.79}];
  const fixed=live.enforceCashOpenCeiling(code,zones,2.04);
  assert.ok(Math.abs(fixed[0].high-cap)<1e-7,'L1 capped at backend risk-adjusted cap '+code);
  assert.ok(fixed[1].high<fixed[0].high);
  assert.ok(fixed[2].high<fixed[1].high);
 }
});
test('client uses strict session open if risk-adjusted model snapshot missing or old',()=>{
 const day='2026-11-02',ctx={lastBuy:{fetchedAt:'2026-10-30T07:42:00Z',
  models:{'0050':{firstLayerCalibration:{sessionOpenPolicy:{active:true,sessionOpen:103.4,maxFirstZoneHigh:104}}}}},
  lastLive:{quotes:{'0050':{date:day,open:103.4}}},Date,Intl,Math,Number,JSON,
  dayKey:()=>day,taipeiNow:()=>new Date(2026,10,2,15,42)};
 const f=vm.runInNewContext(helper+'\nsessionFirstCeiling',ctx);
 assert.equal(f('0050'),103.4);
});
