'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function loadFunction(start,end,context){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Expected function markers in app.js');
 const sandbox={...context};
 vm.runInNewContext(source.slice(a,b),sandbox,{timeout:1000});
 return sandbox;
}
test('diagnostics retain manual trades separately and compare fixed 5/20-session horizons',()=>{
 const ctx=loadFunction('function modelTradeFairComparison(', 'function performanceDiagnosticPayload(',{
  ETF:['0050'],modelFamilyOf:t=>t.modelFamily,incidentModelTrade:()=>false,
  tradeMaturedHorizon:(t,k)=>t.horizon[k]||null,
  mean:xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null
 });
 const rows=[
 {code:'0050',modelFamily:'manual',horizon:{5:{totalReturnPct:2},20:{totalReturnPct:3}}},
 {code:'0050',modelFamily:'manual',horizon:{5:{totalReturnPct:4}}},
 {code:'0050',modelFamily:'reasonable',horizon:{5:{totalReturnPct:-1},20:{totalReturnPct:1}}}
 ];
 const out=ctx.modelTradeFairComparison(rows).byETF['0050'];
 assert.equal(out.manual.trades,2);
 assert.equal(out.manual.h5.avgTotalReturnPct,3);
 assert.equal(out.manual.h20.samples,1);
 assert.equal(out.reasonable.h5.avgTotalReturnPct,-1);
 assert.equal(out.trend.h5.samples,0);
});
test('new-model audit evidence is layer-specific, preserving old warning as unverified',()=>{
 const ctx=loadFunction('function modelTradeDataAudit(', 'function modelTradeFairComparison(',{
  modelFamilyOf:t=>t.modelFamily,
  dayKey:()=> '2026-11-16'
 });
 const base={code:'0050',entryDate:'2026-11-16',tradeType:'model',modelFamily:'reasonable',layer:2};
 const clean={...base,id:'new-good',snapshot:{modelStatusText:'🟠 主狀態為觀察',executionAudit:{selectedLayer:2,selectedLayerStatus:'CONFIRMED_IN',gatePassed:true,quoteAndModelFresh:true}}};
 const fail={...base,id:'new-bad',snapshot:{modelStatusText:'🔴 主狀態已確認',executionAudit:{selectedLayer:2,selectedLayerStatus:'CONFIRMED_BELOW',gatePassed:true,quoteAndModelFresh:true}}};
 const legacy={...base,id:'legacy',snapshot:{modelStatusText:'🟠 觸價觀察／形成中'}};
 const a=ctx.modelTradeDataAudit([clean,fail,legacy]);
 assert.equal(a.reviewRequiredCount,2);
 assert.equal(a.verifiedConfirmedCount,null);
 assert.equal(a.potentialSnapshotInconsistencies.find(x=>x.id==='new-bad').flag,'EXECUTION_EVIDENCE_MISMATCH');
 assert.equal(a.potentialSnapshotInconsistencies.find(x=>x.id==='legacy').flag,'REVIEW_CONFIRMATION_OR_GATE');
 assert.ok(!a.potentialSnapshotInconsistencies.some(x=>x.id==='new-good'));
});
test('deep-layer confirmation envelope can extend below immutable execution lower bound',()=>{
 const ctx=loadFunction('function executionUpAllowance(', 'function flashLivePrices(',{});
 const atr=1,z={low:100,high:101};
 // L2 permits confirmation down to low - max(0.03, 0.15 ATR).
 const l2ConfirmationLow=z.low-Math.max(.03,.15*atr);
 const layer={confirmed:true,gateBlocked:false,confirmedZone:z,executionLow:z.low,executionHigh:z.high+ctx.executionUpAllowance(atr,1)};
 assert.ok(l2ConfirmationLow<layer.executionLow);
 assert.equal(ctx.layerView(layer,99.9),'CONFIRMED_BELOW');
 assert.equal(ctx.layerView(layer,100.1),'CONFIRMED_IN');
});

test('L2/L3 audit is read-only and reports confirmed-below gap only with valid Gate',()=>{
 const ctx=loadFunction('function deepExecutionShadowCandidates(', 'function performanceDiagnosticPayload(',{
  ETF:['0050'],LAYER_CONFIRM_RULES:[null,{minScore:46,confirmDownAbs:.03,confirmDownAtr:.15},{minScore:42,confirmDownAbs:.03,confirmDownAtr:.18}],
  statusFor:()=>({r:{history:{atr14:1},score:60,hardVeto:false,noBuyToday:false},px:99.9,
   statuses:['WAIT','CONFIRMED_BELOW','WAIT'],
   m:{layers:[{}, {confirmed:true,confirmedZone:{low:100},executionLow:100,gateBlocked:false},{confirmed:false,confirmedZone:null,executionLow:null}]}}),
  officialExecutionSnapshotReady:()=>true,cashSessionIsOpenForNewConfirmation:()=>true,Date
 });
 const out=ctx.deepLayerBoundaryAudit();
 assert.equal(out.mode,'READ_ONLY');
 const [l2,l3]=out.byETF['0050'];
 assert.equal(l2.belowExecutionBand,true);
 assert.equal(l2.shadowWouldPermit,true);
 assert.equal(l2.shadowConfirmationLow,99.85);
 assert.equal(l3.shadowWouldPermit,false);
 assert.equal(l3.shadowConfirmationLow,null);
});
test('L2/L3 audit cannot imply permission without fresh Gate or a real price',()=>{
 const context={ETF:['0050'],LAYER_CONFIRM_RULES:[null,{minScore:46,confirmDownAbs:.03,confirmDownAtr:.15},{minScore:42,confirmDownAbs:.03,confirmDownAtr:.18}],Date};
 const x={r:{history:{atr14:1},score:50,hardVeto:false,noBuyToday:false},px:99.9,
   statuses:['WAIT','CONFIRMED_BELOW','WAIT'],
   m:{layers:[{}, {confirmed:true,confirmedZone:{low:100},executionLow:100,gateBlocked:false},{confirmed:false,confirmedZone:null,executionLow:null}]}};
 const ctx=loadFunction('function deepExecutionShadowCandidates(', 'function performanceDiagnosticPayload(',{
   ...context,statusFor:()=>x,officialExecutionSnapshotReady:()=>false,cashSessionIsOpenForNewConfirmation:()=>true
 });
 assert.equal(ctx.deepLayerBoundaryAudit().byETF['0050'][0].shadowWouldPermit,false);
 x.px=null;
 assert.equal(ctx.deepLayerBoundaryAudit().byETF['0050'][0].shadowWouldPermit,false);
});

test('A/B shadow bands are monotone and never bypass stale quote, closed market, or Gate',()=>{
 const ctx=loadFunction('function deepExecutionShadowCandidates(', 'function deepLayerBoundaryAudit(',{});
 const base={confirmedLow:100,executionLow:100,atr:1,
  rule:{confirmDownAbs:.03,confirmDownAtr:.15},px:99.9,confirmed:true,
  gateOk:true,quoteFresh:true,marketOpen:true};
 const result=ctx.deepExecutionShadowCandidates(base);
 assert.equal(result.reason,'VALID_RESEARCH_SNAPSHOT');
 assert.deepEqual(Array.from(result.candidates,c=>c.fraction),[0,.25,.5,1]);
 assert.deepEqual(Array.from(result.candidates,c=>c.shadowEligible),[false,false,false,true]);
 const legacy={...base,confirmedLow:100,executionLow:100.08,px:100.02};
 const baseline=ctx.deepExecutionShadowCandidates(legacy);
 assert.equal(baseline.candidates[0].lowerBound,legacy.executionLow);
 assert.equal(baseline.candidates[0].shadowEligible,false);
 assert.ok(baseline.candidates.every((c,i,a)=>i===0||c.lowerBound<=a[i-1].lowerBound));
 // Being below official execution is not enough: a candidate must still have Gate and fresh live sources.
 for(const patch of [{gateOk:false},{quoteFresh:false},{marketOpen:false},{confirmed:false}]){
  const x=ctx.deepExecutionShadowCandidates({...base,...patch});
  assert.ok(x.candidates.every(y=>!y.shadowEligible));
 }
 for(const patch of [{px:0},{px:null},{atr:0},{confirmedLow:null}]){
  const x=ctx.deepExecutionShadowCandidates({...base,...patch});
  assert.equal(x.reason,'INSUFFICIENT_DATA');
 }
});
