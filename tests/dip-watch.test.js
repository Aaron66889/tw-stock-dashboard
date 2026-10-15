'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function harness(){
 let time=Date.parse('2026-10-15T02:00:00Z');
 class Clock extends Date{
  constructor(...x){super(...(x.length?x:[time]))}
  static now(){return time}
 }
 const rootWindow={},ctx=vm.createContext({window:rootWindow,Date:Clock,Number,Intl,Math,JSON,console});
 vm.runInContext(fs.readFileSync(path.join(root,'public/dip-watch.js'),'utf8'),ctx,{filename:'dip-watch.js'});
 const quote={last:109.40,low:109.00,high:110.20,volume:100000,date:'2026-10-15',
  prevClose:113,serverFetchedAt:new Date(time).toISOString(),realtime:true,referenceReliable:true};
 const model={hardVeto:true,hardVetoReason:'市場/權值/廣度至少兩項急殺',referenceReliable:true,
  score:42,history:{atr14:1.65}};
 const layers={layers:[{zone:{low:109.83,high:110.14}},
  {zone:{low:109.25,high:109.56}},{zone:{low:108.51,high:108.82}}]};
 const data={fetchedAt:new Date(time).toISOString(),modelFreshByCode:{'0050':true}};
 ctx.q=quote;ctx.r=model;ctx.m=layers;ctx.data=data;
 const evals=()=>rootWindow.DipWatch.evaluate('0050',quote,model,data,layers);
 const obs=()=>rootWindow.DipWatch.observe('0050',quote,model,data,layers);
 const advance=ms=>{time+=ms;quote.serverFetchedAt=new Date(time).toISOString();data.fetchedAt=quote.serverFetchedAt};
 return{ctx,api:rootWindow.DipWatch,quote,model,layers,data,evals,obs,advance};
}
test('systemic drop is an observation only, never an immediate formal buy',()=>{
 const h=harness(),x=h.obs();
 assert.equal(x.status,'WAIT');assert.equal(x.zone.layer,2);
 assert.equal(x.observations,1);
 assert.match(h.api.panel('0050',h.model,h.layers,h.quote,h.data),/尚未確認止跌/);
 assert.match(h.api.panel('0050',h.model,h.layers,h.quote,h.data),/正式A版硬Gate仍FAIL/);
});
test('independent ticks, 90 seconds without a new low and rebound are all required before limited probe',()=>{
 const h=harness();h.obs();
 for(let i=0;i<3;i++){h.advance(32000);h.quote.volume+=100;h.obs()}
 const x=h.evals();
 assert.equal(x.status,'PROBE');assert.equal(x.zone.layer,2);
 assert.equal(x.observations,4);assert.ok(x.bounce>=x.bounceRequired);
 const html=h.api.panel('0050',h.model,h.layers,h.quote,h.data);
 assert.match(html,/可評估自主小額試單/);
 assert.match(html,/非正式模型訊號/);assert.match(html,/10～20%/);
});
test('fresh new intraday low cancels previous stabilization immediately',()=>{
 const h=harness();h.obs();
 for(let i=0;i<3;i++){h.advance(32000);h.quote.volume+=100;h.obs()}
 assert.equal(h.evals().status,'PROBE');
 h.advance(5000);h.quote.low=108.96;h.quote.last=109.41;h.quote.volume+=100;
 const state=h.obs();assert.equal(state.status,'WAIT');assert.equal(state.observations,1);
 assert.ok(state.seconds<90);
});
test('repeated refresh of identical market data cannot fake new observations',()=>{
 const h=harness();h.obs();for(let i=0;i<10;i++){h.advance(12000);h.obs()}
 const x=h.evals();assert.equal(x.status,'WAIT');assert.equal(x.observations,1);
});
test('no executable band and price crashing through lowest layer remain out of play',()=>{
 const h=harness();h.quote.last=108.34;h.quote.low=108.34;
 assert.equal(h.obs().status,'OUTSIDE');
});
test('stale quote, stale model, fallback, corporate action and missing reference never produce permission',()=>{
 const mutations=[
  h=>h.quote.realtime=false,h=>h.quote.lastGoodFallback=true,
  h=>h.quote.date='2026-10-14',h=>h.quote.serverFetchedAt='2026-10-15T01:00:00Z',
  h=>h.data.modelFreshByCode['0050']=false,h=>h.model.referenceReliable=false,
  h=>h.quote.corporateActionReferenceMissing=true,
  h=>h.data.fetchedAt='2026-10-15T01:00:00Z'
 ];
 for(const change of mutations){
  const h=harness();change(h);
  assert.equal(h.obs().status,'DATA_WAIT',change.toString());
 }
});
test('ordinary market with no systemic Gate and genuine corporate-action veto do not start crisis probe',()=>{
 const h=harness();h.model.hardVeto=false;assert.equal(h.obs().status,'OFF');
 h.model.hardVeto=true;h.model.hardVetoReason='資料時間戳逾時';assert.equal(h.obs().status,'OFF');
 h.model.hardVetoReason='市場/權值/廣度至少兩項急殺';h.quote.last=112.1;h.quote.low=111.9;
 assert.equal(h.obs().status,'OFF');
});
test('hard Gate disables formal buy recording and shows honest paused label while preserving independent manual path',()=>{
 const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 assert.match(app,/正式模型暫停/);
 assert.match(app,/x\.r\.hardVeto\|\|x\.r\.noBuyToday\|\|x\.activeStatus!=='CONFIRMED_IN'/);
 assert.match(app,/不能記作模型訊號/);
 assert.match(app,/記錄自主買入/);
 assert.match(app,/第\$\{i\}層價格已確認／正式買入暫停/);
});

test('all four ETF views include observational watch; formal Gate logic is not overwritten',()=>{
 const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'),
  html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 assert.ok(html.indexOf('dip-watch.js')>=0&&html.indexOf('dip-watch.js')<html.indexOf('/app.js?v='));
 for(const text of ['window.DipWatch?.observe(c,lastLive.quotes[c]', 'window.DipWatch?.panel(c,x.r,x.m,',
  'window.DipWatch?.panel(selectedETF,x.r,x.m,','不能記作模型訊號'])
  assert.ok(app.includes(text),'missing '+text);
 assert.ok(!fs.readFileSync(path.join(root,'public/dip-watch.js'),'utf8').includes("hardVeto=false"));
});
