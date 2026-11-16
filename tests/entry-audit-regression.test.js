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

test('health-cohort research uses same ETF, legitimate mature horizons, and no live Gate changes',()=>{
 const ctx=loadFunction('function modelEntryHealthAudit(', 'function performanceDiagnosticPayload(',{
  ETF:['0050'],modelFamilyOf:t=>t.modelFamily,incidentModelTrade:()=>false,
  tradeMaturedHorizon:(t,h)=>t.horizon?.[h]||null,
  mean:a=>a.length?a.reduce((n,x)=>n+x,0)/a.length:null
 });
 const rows=[
  {code:'0050',modelFamily:'reasonable',snapshot:{health:{score:25}},horizon:{5:{totalReturnPct:-5}}},
  {code:'0050',modelFamily:'reasonable',snapshot:{health:{score:35}},horizon:{5:{totalReturnPct:1},20:{totalReturnPct:2}}},
  {code:'0050',modelFamily:'reasonable',snapshot:{health:{score:54}},horizon:{5:{totalReturnPct:3}}},
  {code:'0050',modelFamily:'reasonable',snapshot:{health:{score:75}},horizon:{}},
  {code:'0050',modelFamily:'manual',snapshot:{health:{score:10}},horizon:{5:{totalReturnPct:-99}}},
  {code:'0050',modelFamily:'reasonable',snapshot:{health:{score:null}},horizon:{5:{totalReturnPct:4}}}
 ];
 const a=ctx.modelEntryHealthAudit(rows);
 assert.equal(a.mode,'READ_ONLY');
 const b=a.byETF['0050'];
 assert.equal(b.LOW_0_40.trades,2);
 assert.equal(b.LOW_0_40.h5.meanPct,-2);
 assert.equal(b.LOW_0_40.h20.n,1);
 assert.equal(b.MID_41_60.h5.meanPct,3);
 assert.equal(b.HIGH_61_100.h5.n,0);
 assert.equal(b.UNKNOWN.trades,1);
});

test('historical replay evidence never claims verified trading permissions from compressed local data',()=>{
 const ctx=loadFunction('function entryReplayEvidenceAudit(', 'function performanceDiagnosticPayload(',{
  ETF:['0050'],modelFamilyOf:t=>t.modelFamily,incidentModelTrade:()=>false
 });
 const trades=[
  {id:'a',code:'0050',entryDate:'2026-10-13',entryAt:'2026-10-13T02:00:00Z',layer:1,modelFamily:'reasonable'},
  {id:'b',code:'0050',entryDate:'2026-09-11',entryAt:'2026-09-11T02:00:00Z',layer:2,modelFamily:'reasonable'},
  {id:'manual',code:'0050',entryDate:'2026-10-13',entryAt:'2026-10-13T02:00:00Z',modelFamily:'manual'}
 ];
 const history={'0050':[{from:'2026-10-13T01:55:00Z',to:'2026-10-13T02:05:00Z',count:30}]};
 const log=[
  {code:'0050',day:'2026-10-13',at:'2026-10-13T01:59:00Z',price:100},
  {code:'0050',day:'2026-10-13',at:'2026-10-13T02:01:00Z',price:99}
 ];
 const a=ctx.entryReplayEvidenceAudit(trades,history,log);
 assert.equal(a.status,'INSUFFICIENT_HISTORICAL_EVIDENCE');
 const etf=a.byETF['0050'];
 assert.equal(etf.reasonableTrades,2);
 assert.equal(etf.fullyReplayable,0);
 assert.equal(etf.withQuoteBracket,1);
 assert.equal(etf.trades[0].bracketedByObservedQuotes,true);
 assert.equal(etf.trades[0].canVerifyOriginalExecution,false);
 assert.ok(etf.trades[0].missing.includes('NO_HISTORICAL_OFFICIAL_GATE_REPLAY_INPUTS'));
 assert.ok(etf.trades[1].missing.includes('NO_RAW_INTRADAY_OBSERVATIONS'));
 assert.ok(etf.trades[1].missing.includes('NO_LOCAL_HISTORY_WINDOW'));
});
test('replay audit safely handles absent or broken logs',()=>{
 const ctx=loadFunction('function entryReplayEvidenceAudit(', 'function performanceDiagnosticPayload(',{
  ETF:['0050'],modelFamilyOf:t=>t.modelFamily,incidentModelTrade:()=>false
 });
 const a=ctx.entryReplayEvidenceAudit([{id:'a',code:'0050',entryDate:'2026-10-13',layer:1,modelFamily:'reasonable'}],null,null);
 assert.equal(a.byETF['0050'].fullyReplayable,0);
 assert.ok(a.byETF['0050'].trades[0].missing.includes('MISSING_ENTRY_TIMESTAMP'));
});

test('new official purchase captures layer-specific prices, confirmation and upstream timing for later audit',()=>{
 const start=source.indexOf('function saveModelTrade(){');
 const end=source.indexOf('let LAST_MODEL_TRADE_MARK_RENDER_AT=',start);
 assert.ok(start>=0&&end>start);
 const body=source.slice(start,end);
 for(const field of [
  'selectedLayerStatus','executionLow:','executionHigh:','observedPrice:',
  'quoteObservationKey:','modelFetchedAt:','quoteReceivedAt:',
  'quoteServerFetchedAt:','confirmedAt:','gateBlockedReason:'
 ])assert.ok(body.includes(field),'missing trade audit field '+field);
 assert.match(body,/if\(!manual&&!trendMode\)\{const x=statusFor\(code\)/);
 assert.match(body,/x\.statuses\[layer-1\]!=='CONFIRMED_IN'/);
 assert.match(body,/executionAudit:manual\?null:/);
});

test('bounded official observation trace records one quote once and never mutates positions',()=>{
 const start=source.indexOf("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';");
 const end=source.indexOf('function updateState(){',start);
 assert.ok(start>=0&&end>start);
 const storage=new Map(),calls={saved:0};
 const x={r:{history:{atr14:1},score:48,health:{score:30},hardVeto:false,noBuyToday:false},
  m:{layers:[{zone:{low:101,high:102},confirmed:false},{zone:{low:99,high:100},confirmed:true,confirmedZone:{low:99},executionLow:99,executionHigh:100.1,gateBlocked:false},{zone:{low:97,high:98},confirmed:false}]},
  px:98.9};
 const ctx={ETF:['0050'],lastLive:{quotes:{'0050':{last:98.9,time:'10:03',serverFetchedAt:'2026-11-16T02:03:00Z',fetchTime:'2026-11-16T02:03:00Z'}}},
  lastBuy:{fetchedAt:'2026-11-16T02:03:00Z'},statusFor:()=>x,dayKey:()=> '2026-11-16',
  liveObservationKey:()=> 'tick-a',officialExecutionSnapshotReady:()=>true,
  cashSessionIsOpenForNewConfirmation:()=>true,layerView:L=>L.confirmed?'CONFIRMED_BELOW':'WAIT',
  loadJSON:(key,fallback)=>storage.has(key)?storage.get(key):fallback,
  saveJSON:(key,val)=>{calls.saved++;storage.set(key,val)},Date};
 const functions=vm.runInNewContext(source.slice(start,end)+'\n({captureOfficialEntryTrace,entryTraceEvidenceSummary})',ctx);
 assert.equal(functions.captureOfficialEntryTrace('0050'),true);
 assert.equal(functions.captureOfficialEntryTrace('0050'),false);
 assert.equal(calls.saved,1);
 const rows=storage.get('v124_entry_evidence_research_v1');
 assert.equal(rows.length,1);
 assert.equal(rows[0].layers[1].executionLow,99);
 assert.equal(rows[0].layers[1].status,'CONFIRMED_BELOW');
 assert.equal(functions.entryTraceEvidenceSummary().byETF['0050'].confirmedBelow,1);
 assert.equal(x.m.layers[1].executionLow,99);
});
test('research trace fails closed on storage errors without disrupting official refresh',()=>{
 const start=source.indexOf("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';");
 const end=source.indexOf('function updateState(){',start);
 const ctx={ETF:['0050'],lastLive:{quotes:{'0050':{last:98.9}}},
  lastBuy:{},statusFor:()=>({r:{history:{atr14:1},score:50},m:{layers:[{zone:{low:99,high:100}}]},px:98.9}),
  dayKey:()=> '2026-11-16',liveObservationKey:()=> 'tick-a',
  cashSessionIsOpenForNewConfirmation:()=>true,officialExecutionSnapshotReady:()=>true,
  layerView:()=> 'WAIT',loadJSON:()=>[],saveJSON:()=>{throw new Error('quota')},Date};
 const fn=vm.runInNewContext(source.slice(start,end)+'\ncaptureOfficialEntryTrace',ctx);
 assert.equal(fn('0050'),false);
 assert.match(source,/if\(r&&!r\.error\)\{updateOne\(c,r\);captureOfficialEntryTrace\(c\)\}/);
 assert.match(source,/captureOfficialEntryTrace\(c\)/);
});

test('trace samples unchanged quotes every 3 minutes but captures Gate and layer transitions immediately',()=>{
 const start=source.indexOf("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';");
 const end=source.indexOf('function updateState(){',start);
 let tick=Date.parse('2026-11-16T02:02:00Z');
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[tick]))}static now(){return tick}}
 const storage=new Map();
 const model={r:{history:{atr14:1},score:50,hardVeto:false,noBuyToday:false},
  m:{layers:[{zone:{low:99,high:100},confirmed:false,gateBlocked:false}]},px:99.9};
 const ctx={ETF:['0050'],lastLive:{quotes:{'0050':{last:99.9,time:'10:02'}}},
  lastBuy:{fetchedAt:'2026-11-16T02:02:00Z'},statusFor:()=>model,dayKey:()=> '2026-11-16',
  liveObservationKey:()=>String(tick),cashSessionIsOpenForNewConfirmation:()=>true,
  officialExecutionSnapshotReady:()=>true,layerView:L=>L.gateBlocked?'CONFIRMED_BLOCKED':L.confirmed?'CONFIRMED_IN':'WAIT',
  loadJSON:(k,d)=>storage.get(k)||d,saveJSON:(k,v)=>storage.set(k,v),Date:FakeDate};
 const fns=vm.runInNewContext(source.slice(start,end)+'\ncaptureOfficialEntryTrace',ctx);
 assert.equal(fns('0050'),true);
 tick+=10000;
 assert.equal(fns('0050'),false);
 model.m.layers[0].gateBlocked=true;
 assert.equal(fns('0050'),true);
 tick+=10000;
 assert.equal(fns('0050'),false);
 tick+=180000;
 assert.equal(fns('0050'),true);
 const rows=storage.get('v124_entry_evidence_research_v1');
 assert.equal(rows.length,3);
 assert.deepEqual(Array.from(rows,x=>x.event),['STATE_CHANGE','STATE_CHANGE','HEARTBEAT']);
});
test('trace update runs only for a valid official model and preserves shadow evaluation',()=>{
 assert.match(source,/if\(r&&!r\.error\)\{updateOne\(c,r\);captureOfficialEntryTrace\(c\)\}/);
 assert.match(source,/if\(sr&&!sr\.error\)updateShadowOne\(c,sr\)/);
 assert.doesNotMatch(source,/await captureOfficialEntryTrace/);
});

test('confirmed-to-paused transitions preserve separate price, freshness and Gate explanations',()=>{
 const ctx=loadFunction("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';", 'function updateState(){',{ETF:['0050']});
 const at='2026-11-16T02:00:00Z',next='2026-11-16T02:00:30Z';
 const base={code:'0050',day:'2026-11-16',at,px:99.5,hardVeto:false,noBuyToday:false,fresh:true,
  layers:[{status:'CONFIRMED_IN',confirmed:true,gateBlocked:false,executionLow:99,executionHigh:101}]};
 const v=(patch={},layer={})=>({...base,at:next,px:98.8,...patch,layers:[{...base.layers[0],status:'CONFIRMED_BELOW',...layer}]});
 assert.equal(ctx.classifyEntryTraceExit(base,v(),0).reason,'PRICE_BELOW_FROZEN_BAND');
 assert.equal(ctx.classifyEntryTraceExit(base,v({px:101.2}, {status:'CONFIRMED_ABOVE'}),0).reason,'PRICE_ABOVE_FROZEN_BAND');
 assert.equal(ctx.classifyEntryTraceExit(base,v({px:99.5}),0).reason,'PRICE_STATUS_MISMATCH');
 assert.equal(ctx.classifyEntryTraceExit(base,v({px:null}),0).reason,'MISSING_PRICE_BOUND_EVIDENCE');
 assert.equal(ctx.classifyEntryTraceExit(base,v({fresh:false}),0).reason,'STALE_QUOTE_OR_MODEL');
 assert.equal(ctx.classifyEntryTraceExit(base,v({hardVeto:true}),0).reason,'HARD_GATE');
 assert.equal(ctx.classifyEntryTraceExit(base,v({noBuyToday:true}),0).reason,'DAILY_BUY_PAUSE');
 assert.equal(ctx.classifyEntryTraceExit(base,v({}, {status:'CONFIRMED_BLOCKED'}),0).reason,'GATE_OR_SCORE_BLOCKED');
 assert.equal(ctx.classifyEntryTraceExit(base,v({at:'2026-11-16T02:20:00Z'}),0).reason,'OBSERVATION_GAP');
 assert.equal(ctx.classifyEntryTraceExit(base,v({}, {status:'CONFIRMED_IN'}),0),null);
});
test('entry trace transition report isolates ETFs and counts only observed confirmed exits',()=>{
 const ctx=loadFunction("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';", 'function updateState(){',{ETF:['0050','0056']});
 const row=(code,at,status)=>({code,day:'2026-11-16',at,px:status==='CONFIRMED_BELOW'?98.8:99.5,fresh:true,hardVeto:false,noBuyToday:false,
  layers:[{status,executionLow:99,executionHigh:101},{status:'WAIT'},{status:'WAIT'}]});
 const data=[row('0050','2026-11-16T02:00:00Z','CONFIRMED_IN'),
   row('0050','2026-11-16T02:00:30Z','CONFIRMED_BELOW'),
   row('0050','2026-11-16T02:01:00Z','CONFIRMED_BELOW'),
   row('0056','2026-11-16T02:00:00Z','WAIT')];
 const a=ctx.entryTraceTransitionAudit(data);
 assert.equal(a.byETF['0050'].confirmedToNonConfirmed,1);
 assert.equal(a.byETF['0050'].byReason.PRICE_BELOW_FROZEN_BAND,1);
 assert.equal(a.byETF['0056'].confirmedToNonConfirmed,0);
 assert.equal(a.method,'observed-consecutive-snapshots-only');
});

test('corrupted browser research entries are ignored without stopping diagnostic export',()=>{
 const ctx=loadFunction("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';", 'function updateState(){',{
  ETF:['0050','0056'],loadJSON:()=>[
   null,{code:'0050',day:'2026-11-16',at:'not-a-time',layers:[]},
   {code:'0050',day:'2026-11-16',at:'2026-11-16T02:00:00Z',layers:{}},
   {code:'0050',day:'2026-11-16',at:'2026-11-16T02:01:00Z',fresh:false,
    layers:[null,{layer:2,status:'CONFIRMED_BELOW'}]}]
 });
 const report=ctx.entryTraceEvidenceSummary();
 assert.equal(report.status,'PARTIAL_LIVE_EVIDENCE_ONLY');
 assert.equal(report.invalidRecords,3);
 assert.equal(report.byETF['0050'].observations,1);
 assert.equal(report.byETF['0050'].confirmedBelow,1);
 assert.equal(report.transitions.byETF['0050'].confirmedToNonConfirmed,0);
 assert.equal(report.byETF['0056'].observations,0);
});
test('unexpected local browser storage exception degrades to diagnostic unavailable only',()=>{
 const ctx=loadFunction("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';", 'function updateState(){',{
  ETF:['0050'],loadJSON:()=>{throw Error('storage blocked')}
 });
 const report=ctx.entryTraceEvidenceSummary();
 assert.equal(report.mode,'READ_ONLY');
 assert.equal(report.status,'DIAGNOSTIC_UNAVAILABLE');
});

test('historical evidence export tolerates null and malformed Shadow rows and HIST entries',()=>{
 const ctx=loadFunction('function entryReplayEvidenceAudit(', 'function performanceDiagnosticPayload(',{
  ETF:['0050','0056','00878','00919'],modelFamilyOf:t=>t.modelFamily,incidentModelTrade:()=>false
 });
 const trades=[{id:'a',code:'0050',entryDate:'2026-11-16',entryAt:'2026-11-16T02:01:00Z',modelFamily:'reasonable',layer:1}];
 const old={ '0050':[null,{from:'2026-11-16T02:00:00Z',to:'2026-11-16T02:02:00Z'}] };
 const shadow=[null,{},'invalid',{code:'0050',day:'2026-11-16',at:'2026-11-16T02:00:00Z',price:null},
  {code:'0050',day:'2026-11-16',at:'2026-11-16T02:00:00Z',price:100}];
 const a=ctx.entryReplayEvidenceAudit(trades,old,shadow);
 assert.equal(a.byETF['0050'].reasonableTrades,1);
 assert.equal(a.byETF['0050'].trades[0].historyWindows,1);
 assert.equal(a.byETF['0050'].trades[0].retainedShadowObservations,1);
 assert.equal(a.byETF['0050'].fullyReplayable,0);
 for(const code of ['0056','00878','00919'])assert.equal(a.byETF[code].reasonableTrades,0);
});

test('full diagnostics payload serializes with blocked browser storage and preserves model trades',()=>{
 const traceStart=source.indexOf("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';");
 const traceEnd=source.indexOf('function updateState(){',traceStart);
 const payloadStart=source.indexOf('function performanceDiagnosticPayload(){');
 const payloadEnd=source.indexOf('function downloadTradeDiagnostics(){',payloadStart);
 assert.ok(traceStart>=0&&traceEnd>traceStart&&payloadStart>traceEnd&&payloadEnd>payloadStart);
 const trades=[{id:'manual-1',code:'0050',tradeType:'manual',entryDate:'2026-11-16',entryPrice:100,shares:5},
  {id:'model-1',code:'0050',tradeType:'model',modelFamily:'reasonable',layer:2,
   entryDate:'2026-11-16',entryPrice:99.5,shares:10,snapshot:{modelStatusText:'CONFIRMED_IN'}}];
 const original=JSON.stringify(trades);
 const context={
  ETF:['0050','0056','00878','00919'],MODEL_TRADES:trades,HIST:{},SHADOW_LOG:[],
  LAYER_CONFIRM_RULES:[{minScore:50},{minScore:46},{minScore:42}],
  ETF_MODEL_INCIDENT_DATE:'2026-10-15',CLIENT_BUILD:'test',dayKey:()=> '2026-11-16',
  incidentModelTrade:()=>false,incidentModelNotice:()=> '',
  modelFamilyOf:t=>t.modelFamily||(t.tradeType==='manual'?'manual':'reasonable'),
  modelTradePathMetricsReady:()=>false,tradePathMetric:()=>null,
  modelNetMetrics:()=>({net:0,ret:0,gross:0,cost:0,currentPrice:100}),
  modelBenchmarkDelta:()=>null,modelTradeDividendPerShare:()=>0,
  tradeMaturedHorizon:()=>null,tradeMetricNumber:x=>Number(x),
  tradeDiagnosticLabel:()=>'',modelTradeDataAudit:()=>({mode:'READ_ONLY'}),
  deepLayerBoundaryAudit:()=>({mode:'READ_ONLY'}),
  modelTradeFairComparison:()=>({mode:'READ_ONLY'}),
  modelEntryHealthAudit:()=>({mode:'READ_ONLY'}),
  entryReplayEvidenceAudit:()=>({mode:'READ_ONLY'}),
  mean:a=>a.length?a.reduce((n,v)=>n+v,0)/a.length:null,
  loadJSON:()=>{throw Error('SecurityError: storage disabled')},Date
 };
 const code=source.slice(traceStart,traceEnd)+'\n'+source.slice(payloadStart,payloadEnd)+'\nperformanceDiagnosticPayload';
 const exportFn=vm.runInNewContext(code,context,{timeout:1000});
 const exported=JSON.parse(JSON.stringify(exportFn()));
 assert.equal(exported.summary.total,2);
 assert.equal(exported.summary.manual,1);
 assert.equal(exported.summary.model,1);
 assert.equal(exported.summary.liveTraceEvidence.status,'DIAGNOSTIC_UNAVAILABLE');
 assert.equal(exported.trades.length,2);
 assert.equal(exported.trades[1].layer,2);
 assert.equal(JSON.stringify(trades),original,'export must not rewrite trade ledger');
});

test('four-ETF refresh survives one research trace failure and retains shadow refresh and trade state',()=>{
 const begin=source.indexOf('function updateState(){');
 const end=source.indexOf('function statusFor(c){',begin);
 assert.ok(begin>=0&&end>begin);
 const trades=[{id:'one',code:'0050',shares:10}],original=JSON.stringify(trades);
 const ran={official:[],shadow:[],trace:[],saved:[]};
 const models=Object.fromEntries(['0050','0056','00878','00919'].map(code=>[code,{code}]));
 const ctx={
  ETF:Object.keys(models),lastBuy:{models,shadowModels:models},MODEL_TRADES:trades,
  resetDaily:()=>{},resetShadowDaily:()=>{},handlePreopen:()=>{},
  updateOne:(code)=>ran.official.push(code),
  updateShadowOne:(code)=>ran.shadow.push(code),
  captureOfficialEntryTrace:code=>{ran.trace.push(code);if(code==='0056')return false;return true},
  saveJSON:(key)=>ran.saved.push(key),
  STATE:{},SHADOW_STATE:{},SHADOW_LOG:[]
 };
 vm.runInNewContext(source.slice(begin,end)+'\nupdateState()',ctx,{timeout:1000});
 for(const field of ['official','shadow','trace'])assert.deepEqual(ran[field],Object.keys(models));
 assert.deepEqual(ran.saved,['v124_state','v124_shadow_state','v124_shadow_replay']);
 assert.equal(JSON.stringify(trades),original);
});
test('model update is not skipped when local research trace returns false',()=>{
 const start=source.indexOf('function updateState(){');
 const end=source.indexOf('function statusFor(c){',start);
 const done=[];
 const ctx={ETF:['0050'],lastBuy:{models:{'0050':{code:'0050'}},shadowModels:{}},
  resetDaily:()=>{},resetShadowDaily:()=>{},handlePreopen:()=>{},
  updateOne:()=>done.push('model'),captureOfficialEntryTrace:()=>{done.push('trace');return false},
  updateShadowOne:()=>{},saveJSON:()=>{},STATE:{},SHADOW_STATE:{},SHADOW_LOG:[]};
 vm.runInNewContext(source.slice(start,end)+'\nupdateState()',ctx,{timeout:1000});
 assert.deepEqual(done,['model','trace']);
});
