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

test('Yahoo outage and backup quotes without provenance cannot become executable model entries',()=>{
 const start=source.indexOf('function officialExecutionSnapshotReady(');
 const end=source.indexOf('function officialExecutionExplanation(',start);
 assert.ok(start>=0&&end>start);
 const now=Date.parse('2026-11-16T03:30:30Z');
 const fmt=x=>new Date(x).toISOString();
 const valid={last:99.35,date:'2026-11-16',realtime:true,
  fetchTime:fmt(now-10000),serverFetchedAt:fmt(now-12000)};
 const context={lastBuy:{fetchedAt:fmt(now-10000),modelFreshByCode:{'0050':true}},
  lastLive:{quotes:{'0050':valid}},incidentModelDay:()=>false,
  dayKey:()=> '2026-11-16',Date};
 const fn=vm.runInNewContext(source.slice(start,end)+'\nofficialExecutionSnapshotReady',context,{timeout:1000});
 const ready=()=>fn('0050',now);
 assert.equal(ready(),true,'same-day Yahoo quote with source timestamp is valid');
 context.lastLive.quotes['0050']={...valid,serverFetchedAt:null};
 assert.equal(ready(),false,'backup source without verified provider timing fails closed');
 context.lastLive.quotes['0050']={...valid,lastGoodFallback:true};
 assert.equal(ready(),false,'last-good fallback is a display value, not a model execution quote');
 context.lastLive.quotes['0050']={...valid,serverFetchedAt:fmt(now-95000)};
 assert.equal(ready(),false,'old upstream timestamp cannot be refreshed by HTTP receipt');
 context.lastLive.quotes['0050']={...valid};
 context.lastBuy.modelFreshByCode['0050']=false;
 assert.equal(ready(),false,'stale model cannot pair with a fresh quote');
 context.lastBuy.modelFreshByCode['0050']=true;
 assert.equal(ready(),true,'fresh source plus fresh model restores eligibility');
});

test('model UI explains backup quote, missing supplier timestamp, stale model and ex-dividend reference separately',()=>{
 const begin=source.indexOf('function officialExecutionFreshnessExplanation(');
 const end=source.indexOf('function officialExecutionExplanation(',begin);
 assert.ok(begin>=0&&end>begin);
 const at=Date.parse('2026-11-16T03:30:30Z'),tm=v=>new Date(at-v).toISOString();
 const good={date:'2026-11-16',last:99,realtime:true,serverFetchedAt:tm(10000),fetchTime:tm(8000)};
 const ctx={lastBuy:{fetchedAt:tm(10000),modelFreshByCode:{'0050':true}},
  lastLive:{quotes:{'0050':{...good}}},incidentModelDay:()=>false,dayKey:()=> '2026-11-16',Date};
 const explain=vm.runInNewContext(source.slice(begin,end)+'\nofficialExecutionFreshnessExplanation',ctx);
 const say=()=>explain('0050',at);
 ctx.lastLive.quotes['0050']={...good,serverFetchedAt:null};
 assert.match(say(),/來源時間戳/);
 ctx.lastLive.quotes['0050']={...good,lastGoodFallback:true};
 assert.match(say(),/最後有效報價/);
 ctx.lastLive.quotes['0050']={...good,corporateActionReferenceMissing:true};
 assert.match(say(),/除權息參考價/);
 ctx.lastLive.quotes['0050']={...good,fetchTime:tm(100000)};
 assert.match(say(),/瀏覽器接收報價/);
 ctx.lastLive.quotes['0050']={...good};
 ctx.lastBuy.fetchedAt=tm(100000);
 assert.match(say(),/模型更新時間/);
 ctx.lastBuy.fetchedAt=tm(10000);
 assert.match(say(),/尚未符合正式買入要求/);
 assert.match(source,/if\(!officialExecutionSnapshotReady\(x\.r\.code\)\)return '禁止模型買入：'\+officialExecutionFreshnessExplanation/);
});

test('home and detailed model views share the exact official blocker explanation and buy-button gate',()=>{
 const viewRefs=(source.match(/正式買入判定：<\/b>\$\{officialExecutionExplanation\(x\)\}/g)||[]).length;
 assert.equal(viewRefs,2,'home and detailed model panel must both expose blocker reason');
 const buttonGate="(!officialExecutionSnapshotReady(c)||x.r.hardVeto||x.r.noBuyToday||x.activeStatus!=='CONFIRMED_IN')";
 const gates=source.split(buttonGate).length-1;
 assert.equal(gates,2,'both model buy buttons must retain the same strict execution gate');
 assert.match(source,/if\(!manual&&!trendMode\)\{const x=statusFor\(code\)/);
 assert.match(source,/!officialExecutionSnapshotReady\(code\)\|\|x\.r\.hardVeto\|\|x\.r\.noBuyToday/);
});
test('home-facing execution explanation never grants buying on stale quote, hard Gate or unconfirmed layer',()=>{
 const start=source.indexOf('function officialExecutionFreshnessExplanation(');
 const end=source.indexOf('function noBuyWithoutTouch(',start);
 const now=Date.parse('2026-11-16T03:30:30Z');
 const iso=n=>new Date(now-n).toISOString();
 const quote={date:'2026-11-16',last:99,realtime:true,fetchTime:iso(5000),serverFetchedAt:iso(7000)};
 const context={lastBuy:{fetchedAt:iso(4000),modelFreshByCode:{'0050':true}},
  lastLive:{quotes:{'0050':quote}},dayKey:()=> '2026-11-16',
  incidentModelDay:()=>false,incidentModelNotice:()=>'',Date,
  LAYER_CONFIRM_RULES:[{minScore:50}],fmt:n=>String(n),deepestTouchedLayer:()=>-1,
  cashSessionIsOpenForNewConfirmation:()=>true};
 const gateStart=source.indexOf('function officialExecutionSnapshotReady(');
 class FrozenDate extends Date{static now(){return now}}
 context.Date=FrozenDate;
 const fn=vm.runInNewContext(source.slice(gateStart,start)+source.slice(start,end)+'\n({officialExecutionSnapshotReady,officialExecutionExplanation})',context);
 const x={activeLayer:0,activeStatus:'CONFIRMED_IN',px:99,r:{code:'0050',hardVeto:false,noBuyToday:false},
  m:{layers:[{executionLow:98,executionHigh:101}]}};
 assert.match(fn.officialExecutionExplanation(x),/允許記錄正式模型買入/);
 context.lastLive.quotes['0050']={...quote,lastGoodFallback:true};
 assert.match(fn.officialExecutionExplanation(x),/禁止模型買入：.*最後有效報價/);
 context.lastLive.quotes['0050']={...quote};
 x.r.hardVeto=true;x.r.hardVetoReason='test-hard-gate';
 assert.match(fn.officialExecutionExplanation(x),/硬Gate.*test-hard-gate/);
 x.r.hardVeto=false;x.activeStatus='WAIT';
 assert.doesNotMatch(fn.officialExecutionExplanation(x),/允許記錄正式模型買入/);
});

test('execution permission loss is audited even when layer remains CONFIRMED_IN',()=>{
 const ctx=loadFunction("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';",'function updateState(){',{ETF:['0050']});
 const earlier={code:'0050',day:'2026-11-16',at:'2026-11-16T02:00:00Z',fresh:true,
  layers:[{layer:1,status:'CONFIRMED_IN',executionAllowed:true}]};
 const stale={...earlier,at:'2026-11-16T02:00:30Z',fresh:false,
  layers:[{layer:1,status:'CONFIRMED_IN',executionAllowed:false}]};
 assert.equal(ctx.classifyEntryTraceExit(earlier,stale,0).reason,'STALE_QUOTE_OR_MODEL');
 const blocked={...stale,fresh:true,layers:[{layer:1,status:'CONFIRMED_IN',executionAllowed:false}]};
 assert.equal(ctx.classifyEntryTraceExit(earlier,blocked,0).reason,'EXECUTION_PERMISSION_LOST');
 const report=ctx.entryTraceTransitionAudit([earlier,stale]);
 assert.equal(report.byETF['0050'].confirmedToNonConfirmed,1);
 assert.equal(report.byETF['0050'].byReason.STALE_QUOTE_OR_MODEL,1);
});
test('official trace records layer-specific permission and immediate loss during stale quote',()=>{
 const a=source.indexOf("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';");
 const b=source.indexOf('function updateState(){',a);
 let now=Date.parse('2026-11-16T02:00:00Z'),fresh=true;
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const stored=new Map(),x={r:{score:55,history:{atr14:1},hardVeto:false,noBuyToday:false},
  m:{layers:[{confirmed:true,gateBlocked:false,confirmedAt:'t',zone:{low:99,high:100}}]},px:99.5};
 const ctx={ETF:['0050'],lastLive:{quotes:{'0050':{last:99.5}}},lastBuy:{},
  statusFor:()=>x,dayKey:()=> '2026-11-16',
  liveObservationKey:()=> 'same-quote',cashSessionIsOpenForNewConfirmation:()=>true,
  officialExecutionSnapshotReady:()=>fresh,layerView:()=> 'CONFIRMED_IN',
  LAYER_CONFIRM_RULES:[{minScore:50}],
  loadJSON:(k,d)=>stored.has(k)?stored.get(k):d,saveJSON:(k,v)=>stored.set(k,v),Date:FakeDate};
 const capture=vm.runInNewContext(source.slice(a,b)+'\ncaptureOfficialEntryTrace',ctx);
 assert.equal(capture('0050'),true);
 now+=5000;fresh=false;
 assert.equal(capture('0050'),true,'permission loss must record immediately without price change');
 const logs=stored.get('v124_entry_evidence_research_v1');
 assert.equal(logs.length,2);
 assert.equal(logs[0].layers[0].executionAllowed,true);
 assert.equal(logs[1].layers[0].executionAllowed,false);
});

test('watchdog records permission transitions despite a stalled buy-model refresh without changing model state',()=>{
 const start=source.indexOf('function observeOfficialEntryPermissionTimeout(){');
 const end=source.indexOf('function updateState(){',start);
 assert.ok(start>=0&&end>start);
 const models={'0050':{code:'0050'},'0056':{code:'0056'},'00878':{code:'00878'},'00919':{code:'00919'}};
 const before=JSON.stringify(models),observed=[];
 const context={ETF:Object.keys(models),lastBuy:{models},document:{visibilityState:'visible'},
  cashSessionIsOpenForNewConfirmation:()=>true,captureOfficialEntryTrace:c=>observed.push(c)};
 const f=vm.runInNewContext(source.slice(start,end)+'\nobserveOfficialEntryPermissionTimeout',context,{timeout:1000});
 f();
 assert.deepEqual(observed,Object.keys(models));
 assert.equal(JSON.stringify(models),before);
 context.document.visibilityState='hidden';
 f();assert.equal(observed.length,4);
 context.document.visibilityState='visible';context.cashSessionIsOpenForNewConfirmation=()=>false;
 f();assert.equal(observed.length,4);
 assert.match(source,/setInterval\(observeOfficialEntryPermissionTimeout,15000\)/);
 assert.doesNotMatch(source.slice(start,end),/updateOne\(|saveJSON\(|fetch\(|loadBuy\(/);
});

test('research trace reports same-session permission recovery distinct from loss',()=>{
 const ctx=loadFunction("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';",'function updateState(){',{ETF:['0050']});
 const row=(at,allowed,fresh)=>({code:'0050',day:'2026-11-16',at,fresh,hardVeto:false,noBuyToday:false,
  layers:[{layer:1,status:'CONFIRMED_IN',executionAllowed:allowed}]});
 const ready=row('2026-11-16T02:00:00Z',true,true);
 const stale=row('2026-11-16T02:00:30Z',false,false);
 const restored=row('2026-11-16T02:01:00Z',true,true);
 const report=ctx.entryTraceTransitionAudit([ready,stale,restored]);
 assert.equal(report.byETF['0050'].confirmedToNonConfirmed,1);
 assert.equal(report.byETF['0050'].restoredPermissions,1);
 assert.equal(report.byETF['0050'].byReason.STALE_QUOTE_OR_MODEL,1);
 assert.equal(report.byETF['0050'].byReason.EXECUTION_PERMISSION_RESTORED,1);
 const events=report.byETF['0050'].recentTransitions;
 assert.equal(events[0].eventType,'PERMISSION_LOST');
 assert.equal(events[1].eventType,'PERMISSION_RESTORED');
});
test('do not infer recovery when tab was suspended, date crossed or source evidence contradicts permission',()=>{
 const ctx=loadFunction("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';",'function updateState(){',{ETF:['0050']});
 const row=(at,allowed,day='2026-11-16')=>({code:'0050',day,at,
  fresh:true,hardVeto:false,noBuyToday:false,layers:[{status:'CONFIRMED_IN',executionAllowed:allowed}]});
 const blocked=row('2026-11-16T02:00:00Z',false);
 const tooLate=row('2026-11-16T02:20:00Z',true);
 assert.equal(ctx.classifyEntryTraceRecovery(blocked,tooLate,0).reason,'RECOVERY_OBSERVATION_GAP');
 const nextDay=row('2026-11-17T02:01:00Z',true,'2026-11-17');
 assert.equal(ctx.classifyEntryTraceRecovery(blocked,nextDay,0).reason,'RECOVERY_OBSERVATION_GAP');
 const contradictory={...row('2026-11-16T02:01:00Z',true),fresh:false};
 assert.equal(ctx.classifyEntryTraceRecovery(blocked,contradictory,0).reason,'RECOVERY_EVIDENCE_MISMATCH');
 assert.equal(ctx.classifyEntryTraceRecovery(blocked,row('2026-11-16T02:01:00Z',false),0),null);
});

test('unobserved after-sleep and next-day recoveries are not included in verified restoration totals',()=>{
 const ctx=loadFunction("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';",'function updateState(){',{ETF:['0050']});
 const row=(at,day,allowed)=>({code:'0050',at,day,fresh:true,hardVeto:false,noBuyToday:false,
  layers:[{layer:1,status:'CONFIRMED_IN',executionAllowed:allowed}]});
 const asleep=ctx.entryTraceTransitionAudit([
  row('2026-11-16T02:00:00Z','2026-11-16',false),
  row('2026-11-16T02:31:00Z','2026-11-16',true)
 ]).byETF['0050'];
 assert.equal(asleep.restoredPermissions,0);
 assert.equal(asleep.unverifiableRecoveries,1);
 assert.equal(asleep.recentTransitions[0].eventType,'RECOVERY_UNVERIFIED');
 assert.equal(asleep.byReason.RECOVERY_OBSERVATION_GAP,1);
 const acrossDay=ctx.entryTraceTransitionAudit([
  row('2026-11-16T05:25:00Z','2026-11-16',false),
  row('2026-11-17T01:00:00Z','2026-11-17',true)
 ]).byETF['0050'];
 assert.equal(acrossDay.restoredPermissions,0);
 assert.equal(acrossDay.unverifiableRecoveries,1);
});

test('missing live quote records loss without mistaking stale model price for an executable quote',()=>{
 const a=source.indexOf("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';");
 const b=source.indexOf('function updateState(){',a);
 let now=Date.parse('2026-11-16T02:00:00Z'),quotePresent=true;
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const stored=new Map(),x={r:{score:60,price:99.5,history:{atr14:1},hardVeto:false,noBuyToday:false},
  m:{layers:[{confirmed:true,gateBlocked:false,confirmedAt:'t'}]},px:99.5};
 const ctx={ETF:['0050'],lastLive:{quotes:{'0050':{last:99.5}}},
  lastBuy:{},statusFor:()=>x,dayKey:()=> '2026-11-16',
  liveObservationKey:()=> 'live-tick',cashSessionIsOpenForNewConfirmation:()=>true,
  officialExecutionSnapshotReady:()=>quotePresent,layerView:()=> 'CONFIRMED_IN',
  LAYER_CONFIRM_RULES:[{minScore:50}],
  loadJSON:(k,d)=>stored.has(k)?stored.get(k):d,saveJSON:(k,v)=>stored.set(k,v),Date:FakeDate};
 const capture=vm.runInNewContext(source.slice(a,b)+'\ncaptureOfficialEntryTrace',ctx);
 assert.equal(capture('0050'),true);
 now+=15000;quotePresent=false;delete ctx.lastLive.quotes['0050'];
 assert.equal(capture('0050'),true,'missing quote should not cause an early diagnostic return');
 const rows=stored.get('v124_entry_evidence_research_v1');
 assert.equal(rows.length,2);
 assert.equal(rows[0].px,99.5);
 assert.equal(rows[1].px,null,'fallback model price must not be recorded as a real quote');
 assert.equal(rows[1].layers[0].executionAllowed,false);
 assert.match(rows[1].observationKey,/MISSING_LIVE_QUOTE/);
 assert.equal(ctx.entryTraceTransitionAudit(rows).byETF['0050'].byReason.STALE_QUOTE_OR_MODEL,1);
});

test('browser reload does not create false entry transition; real permission change is immediate',()=>{
 const sourceStart=source.indexOf("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';");
 const sourceEnd=source.indexOf('function classifyEntryTraceExit(',sourceStart);
 const program=source.slice(sourceStart,sourceEnd)+'\ncaptureOfficialEntryTrace';
 let now=Date.parse('2026-11-16T02:00:00Z'),fresh=true;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const store=new Map(),x={r:{score:60,history:{atr14:1},hardVeto:false,noBuyToday:false},
  m:{layers:[{confirmed:true,gateBlocked:false,confirmedAt:'confirmed'}]},px:100};
 const ctx={ETF:['0050'],lastLive:{quotes:{'0050':{last:100,time:'10:00:00'}}},lastBuy:{},
  statusFor:()=>x,dayKey:()=> '2026-11-16',cashSessionIsOpenForNewConfirmation:()=>true,
  liveObservationKey:()=> 'stable',officialExecutionSnapshotReady:()=>fresh,
  layerView:()=> 'CONFIRMED_IN',LAYER_CONFIRM_RULES:[{minScore:50}],
  loadJSON:(k,d)=>store.has(k)?store.get(k):d,saveJSON:(k,v)=>store.set(k,v),Date:Clock};
 const getFreshTab=()=>vm.runInNewContext(program,{...ctx},{timeout:1000});
 const tab1=getFreshTab();
 assert.equal(tab1('0050'),true);
 assert.equal(store.get('v124_entry_evidence_research_v1').length,1);
 now+=30000;
 const tab2=getFreshTab();
 assert.equal(tab2('0050'),false,'reload with unchanged snapshot should not add a transition');
 assert.equal(store.get('v124_entry_evidence_research_v1').length,1);
 now+=5000;fresh=false;
 assert.equal(tab2('0050'),true,'stale model should create an immediate transition after reload');
 const rows=store.get('v124_entry_evidence_research_v1');
 assert.equal(rows.length,2);
 assert.equal(rows[1].layers[0].executionAllowed,false);
 assert.equal(rows[1].event,'STATE_CHANGE');
 now+=31000;
 const tab3=getFreshTab();
 assert.equal(tab3('0050'),false,'subsequent reload remains deduplicated');
 assert.equal(store.get('v124_entry_evidence_research_v1').length,2);
 now+=180000;
 assert.equal(tab3('0050'),true,'after heartbeat interval, observation may be written');
 assert.equal(store.get('v124_entry_evidence_research_v1').at(-1).event,'HEARTBEAT');
});

test('unchanged 15-second watchdog ticks do not repeatedly parse full local trace history',()=>{
 const start=source.indexOf("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';");
 const end=source.indexOf('function classifyEntryTraceExit(',start);
 let now=Date.parse('2026-11-16T02:00:00Z'),loads=0,saves=0;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const stored=new Map(),x={r:{score:60,history:{atr14:1},hardVeto:false,noBuyToday:false},
  m:{layers:[{confirmed:true,gateBlocked:false,confirmedAt:'initial'}]},px:100};
 const ctx={ETF:['0050'],lastLive:{quotes:{'0050':{last:100}}},lastBuy:{},
  statusFor:()=>x,dayKey:()=> '2026-11-16',cashSessionIsOpenForNewConfirmation:()=>true,
  liveObservationKey:()=> 'stable-tick',officialExecutionSnapshotReady:()=>true,
  layerView:()=> 'CONFIRMED_IN',LAYER_CONFIRM_RULES:[{minScore:50}],
  loadJSON:(k,d)=>{loads++;return stored.has(k)?stored.get(k):d},
  saveJSON:(k,v)=>{saves++;stored.set(k,v)},Date:Clock};
 const fn=vm.runInNewContext(source.slice(start,end)+'\ncaptureOfficialEntryTrace',ctx,{timeout:1000});
 assert.equal(fn('0050'),true);
 assert.equal(loads,1);
 assert.equal(saves,1);
 for(let tick=0;tick<10;tick++){now+=15000;assert.equal(fn('0050'),false)}
 assert.equal(loads,1,'unchanged 15-second polls must never parse stored history');
 assert.equal(saves,1);
 now+=45000;
 assert.equal(fn('0050'),true,'3-minute heartbeat should be persisted');
 assert.equal(loads,2);
 assert.equal(saves,2);
 x.r.hardVeto=true;now+=5000;
 assert.equal(fn('0050'),true,'real Gate transition must still persist instantly');
 assert.equal(loads,3);
 assert.equal(saves,3);
});

test('real official trace emits observed loss then relight once each, without calling trade or changing gates',()=>{
 const a=source.indexOf("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';");
 const b=source.indexOf('function updateState(){',a);
 let clock=Date.parse('2026-11-16T02:00:00Z'),fresh=true;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
 const storage=new Map(),events=[];
 const x={r:{code:'0050',score:55,history:{atr14:1},hardVeto:false,noBuyToday:false},
  m:{layers:[{zone:{low:99,high:100},confirmedZone:{low:99,high:100},executionLow:99,executionHigh:100,confirmed:true,gateBlocked:false}]},
  px:99.5,statuses:['CONFIRMED_IN']};
 const ctx={ETF:['0050'],Date:Clock,LAYER_CONFIRM_RULES:[{minScore:50}],
  lastBuy:{fetchedAt:'2026-11-16T02:00:00Z'},lastLive:{quotes:{'0050':{last:99.5}}},
  statusFor:()=>x,dayKey:()=> '2026-11-16',liveObservationKey:()=> 'same-quote',
  officialExecutionSnapshotReady:()=>fresh,cashSessionIsOpenForNewConfirmation:()=>true,
  layerView:()=> 'CONFIRMED_IN',
  loadJSON:(k,d)=>storage.get(k)??d,saveJSON:(k,v)=>storage.set(k,v),
  window:{SignalAlerts:{observeExecutionTransition:v=>events.push({...v})}}
 };
 const capture=vm.runInNewContext(source.slice(a,b)+'\ncaptureOfficialEntryTrace',ctx);
 assert.equal(capture('0050'),true,'first observation initializes a baseline');
 assert.equal(events.length,0,'first observation is not a fabricated exit');
 clock+=15000;fresh=false;
 assert.equal(capture('0050'),true);
 assert.equal(events.length,1);assert.equal(events[0].eventType,'PERMISSION_LOST');
 assert.equal(events[0].reason,'STALE_QUOTE_OR_MODEL');
 capture('0050');assert.equal(events.length,1,'unchanged stale quote does not replay alert');
 clock+=15000;fresh=true;
 assert.equal(capture('0050'),true);
 assert.equal(events.length,2);assert.equal(events[1].eventType,'PERMISSION_RESTORED');
 assert.equal(storage.get('v124_entry_evidence_research_v1').length,3);
});
test('score drops below minimum are a distinct observed exit attribution',()=>{
 const ctx=loadFunction("const ENTRY_TRACE_KEY='v124_entry_evidence_research_v1';",'function updateState(){',{
  LAYER_CONFIRM_RULES:[{minScore:50}],ETF:['0050']});
 const pre={code:'0050',day:'2026-11-16',at:'2026-11-16T02:00:00Z',score:55,fresh:true,hardVeto:false,noBuyToday:false,
  layers:[{status:'CONFIRMED_IN',executionAllowed:true}]};
 const post={...pre,at:'2026-11-16T02:00:20Z',score:42,layers:[{status:'CONFIRMED_IN',executionAllowed:false}]};
 const result=ctx.classifyEntryTraceExit(pre,post,0);
 assert.equal(result.reason,'SCORE_BELOW_MINIMUM');
 assert.match(result.detail,/42.*50/);
});
