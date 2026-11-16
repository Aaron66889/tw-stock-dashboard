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
 const ctx=loadFunction('function executionUpAllowance(', 'function layerView(',{});
 const atr=1,z={low:100,high:101};
 // L2 permits confirmation down to low - max(0.03, 0.15 ATR).
 const l2ConfirmationLow=z.low-Math.max(.03,.15*atr);
 const layer={confirmed:true,gateBlocked:false,confirmedZone:z,executionLow:z.low,executionHigh:z.high+ctx.executionUpAllowance(atr,1)};
 assert.ok(l2ConfirmationLow<layer.executionLow);
 assert.equal(ctx.layerView(layer,99.9),'CONFIRMED_BELOW');
 assert.equal(ctx.layerView(layer,100.1),'CONFIRMED_IN');
});
