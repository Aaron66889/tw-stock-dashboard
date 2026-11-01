'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const gate=require('../gate-dedup-forward-ledger');
const official=require('../gate-policy');
const root=path.join(__dirname,'..');
const day='2026-10-30',now=Date.parse('2026-10-30T03:00:00Z');
function fixture(){
 const quote={date:day,time:'11:00:00',last:108.65,low:108.50,high:111,
  volume:8000,serverFetchedAt:new Date(now-8000).toISOString(),realtime:true,
  referenceReliable:true};
 const riskGate=official.evaluate({marketPct:-2.7,tsmcPct:-1.3,
  breadthRatio:.40,breadthUsable:true,environmentScore:-88,fresh:true});
 const model={modelVariant:'official',hardVeto:false,price:108.65,
  referenceReliable:true,score:57,riskGate,
  raw:{first:{low:110,high:110.25},second:{low:109.20,high:109.50},third:{low:108.48,high:108.78}}};
 const data={modelFreshByCode:{'0050':true},fetchedAt:new Date(now-15000).toISOString()};
 return{quote,model,data,run:()=>gate.observationCandidates('0050',model,quote,data,{day,nowMs:now})};
}
test('observes old-Gate-blocked/current-Gate-allowed third layer as counterfactual only',()=>{
 const x=fixture(),rows=x.run();
 assert.equal(rows.length,1);
 assert.equal(rows[0].id,'__GATE_DEDUP_EVT_0050_20261030_L3');
 assert.equal(rows[0].legacyCount,2);
 assert.equal(rows[0].independentCount,1);
 assert.equal(rows[0].officialHardGate,false);
 assert.equal(rows[0].evidence,'LIVE_QUOTE_INSIDE_ZONE_NOT_CONFIRMED');
 assert.equal(rows[0].classification,'FORWARD_SHADOW_ONLY');
});
test('do not retroactively fill from intraday low when current live quote missed zone',()=>{
 const x=fixture();x.quote.last=109.90;x.model.price=109.90;x.quote.low=108.5;
 assert.equal(x.run().length,0);
});
test('cannot create dedup observation from stale quote, stale model, corporate action or hard Gate',()=>{
 const muts=[
  x=>x.quote.date='2026-10-29',x=>x.quote.realtime=false,
  x=>x.quote.serverFetchedAt='2026-10-30T01:00:00Z',
  x=>x.data.fetchedAt='2026-10-30T01:00:00Z',
  x=>x.data.modelFreshByCode['0050']=false,
  x=>x.model.hardVeto=true,x=>x.model.referenceReliable=false,
  x=>x.quote.referenceReliable=false,x=>x.quote.lastGoodFallback=true,
  x=>x.model.corporateActionReferenceMissing=true,
  x=>x.model.riskGate=official.evaluate({marketPct:-3,tsmcPct:-4,breadthUsable:true,breadthRatio:.15,environmentScore:-90}),
  x=>x.model.price=107.5,x=>x.model.modelVariant='shadow',
 ];
 for(const f of muts){const x=fixture();f(x);assert.equal(x.run().length,0,String(f))}
});
test('counterfactual events use separate immutable ids/storage and existing history maturity metrics',()=>{
 const s=fs.readFileSync(path.join(root,'server.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const ui=fs.readFileSync(path.join(root,'public/gate-blocked-ui.js'),'utf8');
 assert.match(s,/GATE_DEDUP\.observationCandidates\(\.\.\.args\)/);
 assert.match(s,/code:storageCode/);
 assert.match(s,/gateDedupRows\(\)/);
 assert.match(s,/dedupForward:\{/);
 assert.match(s,/GATE_LEDGER\.evaluate\(e,hist\[e\.code\],today\)/);
 assert.match(ui,/dedupForwardHtml\(data\)/);
 assert.match(html,/gate-blocked-ui\.js\?v=20261101-independent-forward-v2/);
 assert.notEqual(gate.RECORD_CODE,'__GATE_BLOCKED__');
});
