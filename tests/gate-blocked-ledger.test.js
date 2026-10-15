'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const gate=require('../gate-blocked-ledger');
const repo=path.join(__dirname,'..');
const today='2026-10-15',now=Date.parse('2026-10-15T03:00:00.000Z');
function fixture(){
 const quote={date:today,time:'11:00:00',last:108.65,low:108.61,high:111,volume:133000,
  serverFetchedAt:new Date(now-8000).toISOString(),realtime:true,referenceReliable:true};
 const model={modelVariant:'official',price:108.65,hardVeto:true,
  hardVetoReason:'市場/權值/廣度至少兩項急殺',referenceReliable:true,
  score:42,environmentScore:-83,health:{score:20,usable:true},chaseRisk:18,
  raw:{first:{low:109.83,high:110.13},second:{low:109.24,high:109.54},third:{low:108.48,high:108.78}}};
 const data={fetchedAt:new Date(now-10000).toISOString(),modelFreshByCode:{'0050':true},
  researchGateAudit:{'0050':{existing:{flagCount:3},independent:{flagCount:2},flags:[{id:'market',hit:true},{id:'breadth',hit:true},{id:'environment',hit:true}]}}};
 return {quote,model,data,run:(opts={})=>gate.observationCandidates('0050',model,quote,data,{day:today,nowMs:now,...opts})};
}
function bars(count=120){
 const out=[];let px=100;
 for(let i=0;i<count;i++){
  const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);
  px+=.2;
  out.push({date,open:px-.1,low:px-.4,high:px+.45,close:px,adjclose:px});
 }
 return out;
}
test('one actual observed third layer quote, immutable per code/day/layer event ID',()=>{
 const x=fixture(),obs=x.run();
 assert.equal(obs.length,1);
 assert.equal(obs[0].id,'__GATE_BLOCKED_EVT_0050_20261015_L3');
 assert.equal(obs[0].price,108.65);
 assert.equal(obs[0].zone.low,108.48);
 assert.equal(obs[0].officialScore,42);
 assert.equal(obs[0].independentGateAudit.independentCount,2);
 assert.equal(obs[0].evidence,'LIVE_QUOTE_INSIDE_ZONE_NOT_CONFIRMED');
 assert.equal(obs[0].classification,'FORWARD_SHADOW_ONLY');
});
test('do not fabricate a third layer fill from session low after a rebound',()=>{
 const x=fixture();
 x.quote.last=108.90;x.model.price=108.90;x.quote.low=108.48;
 assert.equal(x.run().length,0);
});
test('on valid future L1/L2 prices, ledger uses matching layer only',()=>{
 const x=fixture();
 x.quote.last=109.91;x.model.price=109.91;
 assert.equal(x.run()[0].layer,1);
 x.quote.last=109.4;x.model.price=109.4;
 assert.equal(x.run()[0].layer,2);
});
test('strict quote and model freshness: cannot create observations from stale or untrusted data',()=>{
 for(const change of [
  x=>x.quote.realtime=false,x=>x.quote.date='2026-10-14',
  x=>x.quote.serverFetchedAt='2026-10-15T01:00:00Z',
  x=>x.quote.referenceReliable=false,x=>x.quote.lastGoodFallback=true,
  x=>x.quote.corporateActionReferenceMissing=true,
  x=>x.model.modelVariant='shadow',x=>x.model.hardVeto=false,
  x=>x.model.hardVetoReason='資料時間戳逾時',x=>x.data.modelFreshByCode['0050']=false,
  x=>x.data.fetchedAt='2026-10-15T01:00:00Z',
  x=>x.model.price=107.95
 ]){
  const x=fixture();change(x);assert.equal(x.run().length,0,String(change));
 }
});
test('do not accept weekends, unsupported ETF or missing model',()=>{
 const x=fixture();
 assert.deepEqual(gate.observationCandidates('2330',x.model,x.quote,x.data,{day:today,nowMs:now}),[]);
 assert.deepEqual(gate.observationCandidates('0050',null,x.quote,x.data,{day:today,nowMs:now}),[]);
 assert.deepEqual(gate.observationCandidates('0050',x.model,x.quote,x.data,{day:'2026-10-15wrong',nowMs:now}),[]);
});
test('5/20/60 day horizons mature independently and never use entry day OHLC for MAE',()=>{
 const h=bars(110);const day=h[30].date,record={
  ...fixture().run()[0],day,price:106,observedAt:day+'T03:00:00Z'};
 h[30].low=40;h[30].high=160;
 const e=gate.evaluate(record,h,h[93].date);
 assert.ok(e.outcome.horizons[5]);
 assert.ok(e.outcome.horizons[20]);
 assert.ok(e.outcome.horizons[60]);
 assert.ok(e.outcome.horizons[60].maePct>-40); // would not hold if same-day low 40 is counted
 const unmatured=gate.evaluate(record,h,h[34].date);
 assert.equal(unmatured.outcome.horizons[5],null);
 assert.equal(unmatured.outcome.horizons[20],null);
 assert.equal(unmatured.outcome.horizons[60],null);
});
test('summary is divided by ETF and L1/L2/L3, excludes pending and no-data from win rate',()=>{
 const x=fixture().run()[0],h=bars(110);
 const a={...x,code:'0050',layer:3,outcome:{horizons:{5:{netReturnPct:2,maePct:-1,mfePct:3},20:null,60:null}}};
 const b={...x,code:'0056',layer:1,outcome:{horizons:{5:{netReturnPct:-3,maePct:-5,mfePct:1},20:null,60:null}}};
 const c={...x,code:'00878',layer:2,outcome:{horizons:{5:null,20:null,60:null}}};
 const s=gate.summarize([a,b,c]);
 assert.equal(s.events,3);
 assert.equal(s.byCode['0050'].byLayer.L3.events,1);
 assert.equal(s.byCode['0056'].byLayer.L1.events,1);
 assert.equal(s.byCode['00878'].byHorizon[5].matured,0);
 assert.equal(s.byCode['0050'].byHorizon[5].winRatePct,100);
 assert.equal(s.byHorizon[5].matured,2);
 assert.equal(s.byHorizon[5].meanNetPct,-.5);
});
test('separate Supabase ledger, no writes on buy-model API or browser session, and no new external quote fetches',()=>{
 const s=fs.readFileSync(path.join(repo,'server.js'),'utf8');
 const ui=fs.readFileSync(path.join(repo,'public/gate-blocked-ui.js'),'utf8');
 const h=fs.readFileSync(path.join(repo,'public/index.html'),'utf8');
 const app=fs.readFileSync(path.join(repo,'public/app.js'),'utf8');
 assert.match(s,/const data=RUNTIME\.bm,now=Date\.now\(\)/);
 assert.match(s,/GATE_LEDGER\.observationCandidates/);
 assert.match(s,/gateLedgerLease\(\)/);
 assert.match(s,/if\(old\)continue; \/\/ Historical first live observation must remain immutable/);
 assert.match(s,/code:GATE_LEDGER\.RECORD_CODE/);
 assert.match(s,/api\/gate-blocked-forward/);
 assert.match(h,/id="gateBlockedLedger"/);
 assert.ok(h.indexOf('/gate-blocked-ui.js')<h.indexOf('/app.js?v='));
 assert.match(app,/GateBlockedUI\?\.load\(false\)/);
 assert.doesNotMatch(ui,/localStorage\.setItem|POST|write/);
 assert.match(s,/const knife=\(/); // Official scoring/gate remains unchanged.
});
