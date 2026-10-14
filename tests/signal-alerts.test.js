'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const fixed='2026-10-14T02:15:00.000Z'; // Taipei Wed 10:15, cash session.
const realDate=Date;
class Clock extends realDate{
 constructor(...args){super(...(args.length?args:[fixed]))}
 static now(){return realDate.parse(fixed)}
}
function client({permission='granted',enabled=false,sound=false}={}){
 const db=new Map(),dom=new Map(),notifications=[],toasts=[],calls={trend:0,pages:[]};
 const seen=[];
 class Element{
  constructor(){this.textContent='';this.children=[];this.className='';this.firstChild=null}
  appendChild(n){this.children.push(n);this.firstChild=this.children[0]}
  removeChild(n){this.children=this.children.filter(x=>x!==n);this.firstChild=this.children[0]}
  remove(){this._removed=true}
 }
 for(const id of ['signalAlertStatus','signalAlertEnable','signalAlertSound','signalAlertRecent','signalAlertToasts'])
  dom.set(id,new Element());
 const NotificationMock=function(title,opts){this.title=title;this.opts=opts;notifications.push(this)};
 NotificationMock.permission=permission;
 NotificationMock.requestPermission=async()=>{NotificationMock.permission='granted';return'granted'};
 if(enabled)db.set('twstock_signal_alerts_v1',JSON.stringify({enabled:true,sound}));
 const ctx=vm.createContext({
  console,Intl,Date:Clock,Number,JSON,
  localStorage:{getItem:k=>db.get(k)||null,setItem:(k,v)=>db.set(k,String(v))},
  document:{readyState:'complete',getElementById:id=>dom.get(id)||null,createElement:()=>new Element()},
  setTimeout:()=>0,
  window:{Notification:NotificationMock,addEventListener:()=>{},focus:()=>{},setPage:page=>calls.pages.push(page),loadTrendBuy:()=>{calls.trend++}}
 });
 vm.runInContext(fs.readFileSync(path.join(root,'public/signal-alerts.js'),'utf8'),ctx);
 return{ctx,db,dom,notifications,toasts,seen,calls,run:code=>vm.runInContext(code,ctx)};
}
function trend(overrides={}){
 return{ok:true,fetchedAt:fixed,quoteSnapshots:{'00919':{last:32.49,date:'2026-10-14',serverFetchedAt:fixed,realtime:true}},
  models:{'00919':{ok:true,status:'TREND_BUY',price:32.49,score:95,levels:{entryLow:32.40,entryHigh:32.54,maxChase:32.64},shadowB:{status:'B_CANDIDATE'}}},...overrides};
}
function layers(){
 return{buy:{ok:true,dataFresh:true,fetchedAt:fixed,models:{'00919':{score:88,hardVeto:false,noBuyToday:false}}},
  state:{models:{'00919':{layers:[{confirmed:true,confirmedAt:fixed,executionLow:31,executionHigh:32,confirmedZone:{low:31,high:31.9}},
   {confirmed:false},{confirmed:false}]}}},
  live:{quotes:{'00919':{last:31.5,date:'2026-10-14',fetchTime:fixed,realtime:true}}}};
}
test('notification UI is opt-in and only enabled after explicit action',async()=>{
 const c=client();
 assert.equal(c.run('SignalAlerts.monitoring()'),false);
 c.ctx.data=trend();c.run('SignalAlerts.observeTrend(data, null)');
 assert.equal(c.notifications.length,0);
 await c.run('SignalAlerts.enable()');assert.equal(c.run('SignalAlerts.monitoring()'),true);assert.equal(c.calls.trend,1);
 c.run('SignalAlerts.observeTrend(data,null)');assert.equal(c.notifications.length,1);
 await c.run('SignalAlerts.enable()');assert.equal(c.run('SignalAlerts.monitoring()'),false);
});
test('00919 official A TREND_BUY shows desktop notification, B status and one notification per day',async()=>{
 const c=client({enabled:true}),d=trend();c.ctx.data=d;
 const before=JSON.stringify(d);
 c.run('SignalAlerts.observeTrend(data,null)');c.run('SignalAlerts.observeTrend(data,null)');
 assert.equal(c.notifications.length,1);
 assert.match(c.notifications[0].title,/00919.*強勢加碼A版成立/);
 assert.match(c.notifications[0].opts.body,/B版 B_CANDIDATE/);
 assert.match(c.notifications[0].opts.body,/32.64/);
 assert.equal(JSON.stringify(d),before);
 assert.equal(c.run("JSON.parse(localStorage.getItem('twstock_signal_alert_history_v1')).length"),1);
 assert.match(c.dom.get('signalAlertRecent').textContent,/00919/);
});
test('trend notification vetoes weak, old, stale, off-band, fallback and non-live quotes',()=>{
 const fns=[
  d=>d.models['00919'].status='WAIT_BREAKOUT',
  d=>d.models['00919'].levels.entryHigh=32.42,
  d=>d.quoteSnapshots['00919'].realtime=false,
  d=>d.quoteSnapshots['00919'].lastGoodFallback=true,
  d=>d.quoteSnapshots['00919'].date='2026-10-13',
  d=>d.quoteSnapshots['00919'].serverFetchedAt='2026-10-14T01:00:00Z',
  d=>d.fetchedAt='2026-10-14T00:00:00Z'
 ];
 for(const change of fns){const c=client({enabled:true}),d=trend();change(d);c.ctx.data=d;c.run('SignalAlerts.observeTrend(data,null)');assert.equal(c.notifications.length,0,change.toString())}
});
test('layers alert only for confirmed executable prices with fresh official model, not stale vetoed or blocked',()=>{
 const c=client({enabled:true}),d=layers();c.ctx.data=d;
 c.run('SignalAlerts.observeLayers(data.state,data.buy,data.live)');
 assert.equal(c.notifications.length,1);
 assert.match(c.notifications[0].title,/L1 第一層正式確認/);
 const fail=[
  d=>d.state.models['00919'].layers[0].gateBlocked=true,
  d=>d.buy.dataFresh=false,
  d=>d.live.quotes['00919'].last=34,
  d=>d.live.quotes['00919'].date='2026-10-13',
  d=>d.state.models['00919'].layers[0].confirmedAt='2026-10-13T02:00:00Z',
  d=>d.buy.models['00919'].hardVeto=true,
  d=>d.live.quotes['00919'].lastGoodFallback=true
 ];
 for(const change of fail){
  const n=client({enabled:true}),x=layers();change(x);n.ctx.data=x;n.run('SignalAlerts.observeLayers(data.state,data.buy,data.live)');assert.equal(n.notifications.length,0,change.toString());
 }
});
test('different L1 L2 L3 and trend A alerts do not overwrite each other',()=>{
 const c=client({enabled:true}),d=layers();
 for(let i=0;i<3;i++)d.state.models['00919'].layers[i]={confirmed:true,confirmedAt:fixed,executionLow:31,executionHigh:32,confirmedZone:{low:31,high:31.9}};
 c.ctx.data=d;c.run('SignalAlerts.observeLayers(data.state,data.buy,data.live)');
 assert.equal(c.notifications.length,3);
 c.ctx.trend=trend();c.run('SignalAlerts.observeTrend(trend,null)');
 assert.equal(c.notifications.length,4);
});
test('notification engine script loads before app, and model polling hooks remain scoped to enabled session',()=>{
 const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 assert.ok(html.indexOf('signal-alerts.js')<html.indexOf('/app.js?v='));
 for(const marker of ['SignalAlerts?.observeLayers(STATE,lastBuy,lastLive)','SignalAlerts?.observeTrend(d,lastLive)','SignalAlerts?.monitoring()','signalAlertTest'])
  assert.ok((app+html).includes(marker),marker);
 assert.ok(app.includes("if(!force&&!onPage&&!watched)return"));
 assert.ok(app.includes("if(document.visibilityState==='hidden'&&!(window.SignalAlerts?.monitoring()&&twMarketOpenClient()))return"));
});
