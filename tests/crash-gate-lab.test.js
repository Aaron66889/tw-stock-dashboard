'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const lab=require('../crash-gate-lab');
const root=path.join(__dirname,'..');
function days(n=170){
 const out=[];let close=100;
 for(let i=0;i<n;i++){
  const shock=i===85||i===125,prev=close;
  close=prev*(shock?.964:1.0004);
  const open=shock?close+.30:close-.05;
  const high=Math.max(close,open)+.45;
  const low=shock?(i===85?close-.75:close-.04):Math.min(close,open)-.40;
  out.push({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),
   open,high,low,close,adjclose:close});
 }
 return out;
}
test('#13 audit detects derived environment score double-counting when it is second vote',()=>{
 const r=lab.analyzeGate({marketPct:-2.6,tsmcPct:-1,breadthRatio:.31,breadthUsable:true,environmentScore:-81,fresh:true});
 assert.equal(r.existing.blocked,true);
 assert.equal(r.existing.flagCount,2);
 assert.equal(r.independent.blocked,false);
 assert.equal(r.independent.flagCount,1);
 assert.equal(r.doubleCountRisk,true);
 assert.equal(r.flags[3].group,'derived');
});
test('two independent macro shocks still block even after removal of derived count',()=>{
 const r=lab.analyzeGate({marketPct:-2.6,tsmcPct:-3.5,breadthRatio:.34,breadthUsable:true,environmentScore:-83,fresh:true});
 assert.equal(r.existing.blocked,true);assert.equal(r.independent.blocked,true);
 assert.equal(r.independent.flagCount,2);
 assert.equal(r.doubleCountRisk,false);
});
test('stale market feed or absent corporate reference stay blocked by independent research Gate',()=>{
 for(const extra of [{fresh:false},{corpActionBlocked:true}]){
  const r=lab.analyzeGate({marketPct:-1,tsmcPct:-1,environmentScore:12,...extra});
  assert.equal(r.existing.blocked,true);assert.equal(r.independent.blocked,true);
 }
});
test('market proxy test enters next session at its open, comparing all events and rebound-qualified subgroup',()=>{
 const rows=days(),d=lab.backtest(rows,rows,{code:'0050',asOfDate:'2026-10-15'});
 assert.equal(d.ok,true);assert.equal(d.status,'READY');
 assert.equal(d.summary.events,2);assert.equal(d.summary.eligible,1);
 const first=d.events[0],second=d.events[1];
 assert.equal(first.date,rows[85].date);assert.equal(first.entryDate,rows[86].date);
 assert.equal(first.entryPrice,rows[86].open);
 assert.equal(first.selected,true);
 assert.equal(second.selected,false);
 assert.equal(first.outcomes[5].exitDate,rows[90].date);
 assert.equal(first.outcomes[20].exitDate,rows[105].date);
 assert.equal(first.outcomes[60].exitDate,rows[145].date);
 assert.equal(d.summary.results[5].unfiltered.matured,2);
 assert.equal(d.summary.results[5].reboundQualified.matured,1);
 assert.equal(d.summary.results[60].unfiltered.matured,1);
 assert.equal(d.summary.results[60].reboundQualified.matured,1);
 assert.ok(Math.abs(first.outcomes[5].netPct-(first.outcomes[5].grossPct-.385))<1e-8);
});
test('signal does not use next-day open/close to decide whether the prior close qualified',()=>{
 const original=days(),a=lab.backtest(original,original,{code:'0050'}).events[0];
 const altered=days();altered[86].open*=1.02;altered[86].high*=1.05;
 const b=lab.backtest(altered,altered,{code:'0050'}).events[0];
 assert.equal(a.selected,b.selected);assert.equal(a.date,b.date);assert.notEqual(a.entryPrice,b.entryPrice);
});
test('never use today incomplete daily candle, and 60d immature outcomes are excluded from wins',()=>{
 const rows=days(150),yesterday=rows[149].date,today=rows[150]?.date||new Date(Date.parse(rows[149].date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const d=lab.backtest(rows,rows,{code:'0050',asOfDate:today});
 assert.equal(d.data.lastEtfDay,yesterday);
 assert.equal(d.summary.events,2);
 assert.equal(d.summary.results[60].unfiltered.matured,1);
 assert.equal(d.summary.results[60].reboundQualified.matured,1);
 assert.equal(d.summary.results[60].unfiltered.winRatePct===null,false);
});
test('invalid OHLC, nonaligned source days and insufficient history do not invent returns',()=>{
 const rows=days();
 const broken=rows.map(x=>({...x}));
 broken[85].low=null;broken[85].high=null;
 const d=lab.backtest(broken,rows,{code:'0056'});
 assert.equal(d.summary.events,1);
 const sparse=lab.backtest(rows.slice(-25),rows,{code:'00919'});
 assert.equal(sparse.ok,false);assert.equal(sparse.status,'INSUFFICIENT_HISTORY');
 const noAligned=lab.backtest(rows,rows.map(x=>({...x,date:'2001-'+x.date.slice(5)})),{code:'0050'});
 assert.equal(noAligned.summary.events,0);
});
test('true raw/adjusted values are normalized per row, not corporate-action phantom crashes',()=>{
 const rows=days();const normal=lab.backtest(rows,rows,{code:'0050'});
 const split=rows.map((x,i)=>i<110?{...x,close:x.close/2,open:x.open/2,high:x.high/2,low:x.low/2,adjclose:x.adjclose}:{...x});
 const adj=lab.backtest(split,split,{code:'0050'});
 assert.equal(adj.summary.events,normal.summary.events);
 assert.deepEqual(adj.events.map(x=>x.date),normal.events.map(x=>x.date));
});
test('frontend and backend keep study segregated from official model and have no hidden writes',()=>{
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const ui=fs.readFileSync(path.join(root,'public/crash-gate-lab-ui.js'),'utf8');
 assert.match(server,/researchGateAudit=Object\.fromEntries/);
 assert.match(server,/api\/crash-gate-lab/);
 assert.match(server,/CRASH_GATE_LAB\.backtest/);
 assert.match(html,/id="crashGateResearchResult"/);
 assert.ok(html.indexOf('/crash-gate-lab-ui.js')<html.indexOf('/app.js?v='));
 assert.match(app,/window\.CrashGateLabUI\?\.auditSnippet/);
 assert.match(app,/window\.CrashGateLabUI\?\.load\(false\)/);
 assert.ok(!ui.includes('localStorage.setItem('));
});
