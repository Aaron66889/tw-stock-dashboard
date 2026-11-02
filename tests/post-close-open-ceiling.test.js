'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const between=(s,begin,end)=>{
 const a=s.indexOf(begin),b=s.indexOf(end,a+begin.length);
 assert.ok(a>=0&&b>a,'could not locate '+begin);return s.slice(a,b);
};
const today='2026-11-02';
const verifySource=between(server,'function officialQuoteDay(raw){','function verifiedEtfOpen(');
const completeSource=between(server,'function etfQuoteComplete(','async function liveStable(');
const verifiedDay=vm.runInNewContext(verifySource+'\nofficialQuoteDay',{Date});
const complete=vm.runInNewContext(completeSource+'\netfQuoteComplete',{twAfterCashOpenNow:()=>true});
test('Taiwan 2026-11-02 session open accepts only same-day official dates',()=>{
 for(const s of ['20261102','1151102','115/11/02','2026-11-02']){
  assert.equal(verifiedDay(s),today,s);
 }
 assert.notEqual(verifiedDay('20261101'),today);
 assert.notEqual(verifiedDay('115/11/01'),today);
 assert.equal(verifiedDay(''),null);
});
test('after 13:30 a quote with missing or unverified open cannot be complete',()=>{
 const q={last:104.10,prevClose:104.95,open:105};
 assert.equal(complete(q,true),false);
 assert.equal(complete({...q,openVerified:false},true),false);
 assert.equal(complete({...q,open:0,openVerified:true},true),false);
 assert.equal(complete({...q,openVerified:true},true),true);
});
test('official buy model must enforce exchange-open requirement through afternoon',()=>{
 assert.match(server,/openRequired=twAfterCashOpenNow\(\)/);
 assert.match(server,/quote\?\.openVerified!==true/);
 assert.match(server,/officialQuoteDay\(q\.date\)===today/);
 assert.match(server,/officialQuoteDay\(row\.date\)===today/);
 assert.match(server,/ymdTaipei\(new Date\(y\.time\)\)!==today/);
 assert.match(server,/openCapApplied/);
});
const mathCode=between(app,'function center(z){','function executionUpAllowance(');
function simulate(live={},modelOpen=105){
 const ctx={
  lastLive:{quotes:{'0050':{last:104.10,prevClose:104.95,date:today,open:null,...live}}},
  lastBuy:{fetchedAt:'2026-11-02T07:38:00Z',models:{'0050':{
   firstLayerCalibration:{sessionOpenPolicy:{active:true,sessionOpen:modelOpen}}
  }}},
  taipeiNow:()=>new Date(2026,10,2,15,42,0),
  dayKey:()=>today,Date,Intl,Number,Math,JSON
 };
 const run=vm.runInNewContext(mathCode+'\n({cashSessionOpen,enforceCashOpenCeiling})',ctx);
 const raw=[{low:106.02,high:106.36},{low:103.97,high:104.30},{low:103.08,high:103.41}];
 return{open:run.cashSessionOpen('0050'),zones:run.enforceCashOpenCeiling('0050',raw,2.04)};
}
test('real screenshot regression: 0050 at 15:42 cannot show first layer 106 above open 105',()=>{
 const a=simulate();
 assert.equal(a.open,105);
 assert.ok(a.zones[0].high<=105,'L1 must be capped at actual opening price');
 assert.ok(a.zones[0].low<a.zones[0].high);
 assert.ok(a.zones[1].high<a.zones[0].high);
 assert.ok(a.zones[2].high<a.zones[1].high);
});
test('even if rapid quote reports conflicting 106, the known 105 open wins',()=>{
 const a=simulate({open:106});
 assert.equal(a.open,105);
 assert.ok(a.zones[0].high<=105);
});
test('unknown current-day open must not be fabricated from a previous session',()=>{
 const a=simulate({date:'2026-10-30',open:106},null);
 assert.equal(a.open,null);
});
