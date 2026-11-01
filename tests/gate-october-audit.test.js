'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../public/gate-audit-core.js');
const root=path.join(__dirname,'..');
const event=(code,day,layer,originalCount,independentCount,net5=null)=>({
 id:[code,day,layer].join(':'),code,day,layer,
 observedAt:day+'T01:55:03.000Z',price:100,
 independentGateAudit:{originalCount,independentCount},
 outcome:{horizons:{5:net5===null?null:{netReturnPct:net5,maePct:-3,mfePct:4},20:null,60:null}}
});
const events=[
 event('0050','2026-10-19',1,2,1,3),
 event('0056','2026-10-19',2,2,1,-1),
 event('0056','2026-10-30',2,3,2,null),
 event('00878','2026-10-30',1,3,2,null),
];
const trade=(id,code,type,entryAt,ret5=null)=>({
 id,code,tradeType:type,entryAt,entryDate:entryAt.slice(0,10),
 entryPrice:100,shares:10,
 perf:{horizon:{5:ret5===null?null:{totalReturnPct:ret5},20:null,60:null}}
});
const trades=[
 trade('a','0050','model','2026-10-19T01:28:45.000Z',5),
 trade('b','0056','model','2026-10-19T01:55:54.000Z',1),
 trade('c','0056','manual','2026-10-19T02:10:00.000Z',-2),
 trade('d','0050','manual','2026-10-30T01:32:06.000Z',null),
 trade('e','0050','manual','2026-09-30T09:00:00.000Z',9),
];
test('October: distinguish environment overlap from two independent risk groups',()=>{
 const a=core.audit(events,trades);
 assert.equal(a.observations,4);
 assert.equal(a.uniqueDays,2);
 assert.equal(a.classification.DERIVED_OVERLAP,2);
 assert.equal(a.classification.INDEPENDENT_BLOCK,2);
 assert.equal(a.classification.UNKNOWN,0);
 assert.equal(core.category({independentGateAudit:{originalCount:2,independentCount:1}}),'DERIVED_OVERLAP');
 assert.equal(core.category({independentGateAudit:{originalCount:2}}),'UNKNOWN');
});
test('October: match earlier and later model fills without claiming entire day was blocked',()=>{
 const a=core.audit(events,trades);
 const x=a.detailed.find(z=>z.event.code==='0050'),y=a.detailed.find(z=>z.event.code==='0056'&&z.event.day==='2026-10-19');
 assert.equal(x.sameDayTrades.modelBefore,1);
 assert.equal(x.sameDayTrades.modelAfter,0);
 assert.equal(y.sameDayTrades.modelAfter,1);
 assert.equal(y.sameDayTrades.manualAfter,1);
 assert.equal(a.trades.model,2);
 assert.equal(a.trades.manual,2);
});
test('October: 5 day outcomes count only matured forward events and live trade results',()=>{
 const a=core.audit(events,trades);
 assert.equal(a.groups.DERIVED_OVERLAP.horizons[5].matured,2);
 assert.equal(a.groups.INDEPENDENT_BLOCK.horizons[5].matured,0);
 assert.equal(a.groups.INDEPENDENT_BLOCK.horizons[5].winRatePct,null);
 assert.equal(a.horizons[5].matured,2);
 assert.equal(a.horizons[5].pending,2);
 assert.equal(a.horizons[5].meanNetPct,1);
 assert.equal(a.horizons[20].matured,0);
 assert.equal(a.tradePerformance.manual[5].matured,1);
 assert.equal(a.tradePerformance.manual[5].meanTotalReturnPct,-2);
 assert.equal(a.tradePerformance.model[5].matured,2);
 assert.equal(a.tradePerformance.model[5].meanTotalReturnPct,3);
});
test('dedupe duplicate cloud entries and ignore unrelated trades and deleted rows',()=>{
 const a=core.audit([...events,events[0]],[...trades,trades[0],{...trades[2],id:'deleted',_deleted:true}]);
 assert.equal(a.observations,4);assert.equal(a.trades.total,4);
});
test('timezone fallback uses Taiwan day instead of browser UTC day, if entryDate absent',()=>{
 const d=core.dayOfTrade({entryAt:'2026-10-18T16:45:00.000Z'});
 assert.equal(d,'2026-10-19');
});
test('audit changes only public read-only UI; existing execution and hard veto remain unchanged',()=>{
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'public/gate-blocked-ui.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 assert.match(server,/const knife=\(/);
 assert.match(server,/hardVeto=gatePolicy\.hardBlocked/);
 assert.match(html,/gate-audit-core\.js\?v=20261101/);
 assert.ok(html.indexOf('/gate-audit-core.js')<html.indexOf('/gate-blocked-ui.js'));
 assert.ok(html.indexOf('/gate-blocked-ui.js')<html.indexOf('/app.js?v='));
 assert.match(app,/GateBlockedUI\?\.setTradeProvider/);
 assert.match(ui,/octAuditHtml\(data\)/);
 assert.doesNotMatch(ui,/fetch\([^)]*POST|localStorage\.setItem/);
});
