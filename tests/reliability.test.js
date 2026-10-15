'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const clone=x=>JSON.parse(JSON.stringify(x));
const trade=(id='mt_sample_001')=>({id,code:'0050',shares:10,entryPrice:100,entryAt:'2026-10-13T02:00:00.000Z',entryDate:'2026-10-13',tradeType:'manual',snapshot:{zones:[]}});
const dividend=()=>({ok:true,byCode:Object.fromEntries(['0050','0056','00878','00919'].map(c=>[c,{received:0,sourceOk:true}])),snapshotDay:'2026-10-13'});

function client(storage=new Map()){
 const nodes=new Map(),events=new Map(),timers=[];
 class Node{
  constructor(id='',classes='',dataset={}){this.id=id;this.value='';this.dataset=dataset;this.style={};this.children=[];this.disabled=false;this._html='';const cls=new Set(classes.split(/\s+/).filter(Boolean));this.classList={add:(...c)=>c.forEach(x=>cls.add(x)),remove:(...c)=>c.forEach(x=>cls.delete(x)),contains:c=>cls.has(c),toggle:(c,on)=>{on=on??!cls.has(c);on?cls.add(c):cls.delete(c);return on}}}
  set innerHTML(v){this._html=String(v);for(const m of this._html.matchAll(/id="([^"]+)"/g))nodes.set(m[1],new Node(m[1]))}
  get innerHTML(){return this._html}
  appendChild(n){this.children.push(n)}
  insertAdjacentHTML(_,s){this.innerHTML+=s}
  scrollIntoView(){}
  remove(){nodes.delete(this.id)}
 }
 const nav=[],pages=[];
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 for(const m of html.matchAll(/<([\w-]+)\b([^>]+)>/g)){
  const id=m[2].match(/\bid="([^"]+)"/)?.[1]||'',classes=m[2].match(/\bclass="([^"]+)"/)?.[1]||'',page=m[2].match(/data-page="([^"]+)"/)?.[1];
  const n=new Node(id,classes,{page});if(id)nodes.set(id,n);if(classes.split(' ').includes('page'))pages.push(n);if(classes.split(' ').includes('navb'))nav.push(n);
 }
 const alerts=[],confirms=[];
 const ctx=vm.createContext({console,URL,URLSearchParams,AbortController,Intl,Date,structuredClone,
  setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout:()=>{},setInterval:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearInterval:()=>{},
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
  document:{visibilityState:'visible',getElementById:id=>nodes.get(id)||null,querySelectorAll:s=>s==='.page'?pages:s==='.navb'?nav:[],createElement:()=>new Node(),addEventListener:(name,fn)=>events.set(name,fn)},
  window:{addEventListener:()=>{},scrollTo:()=>{},confirm:()=>true},navigator:{},alert:s=>alerts.push(s),confirm:s=>{confirms.push(s);return true},prompt:()=>null,
  fetch:async()=>{throw Error('Unexpected network request')}
 });
 let code=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 code=code.replace('setInterval(setMode,30000);boot();','setInterval(setMode,30000);');
 vm.runInContext(code,ctx,{filename:'public/app.js'});
 const run=code=>vm.runInContext(code,ctx),json=code=>clone(run(code));
 run('apiTrafficPermit=async()=>{}');
 const route=fn=>ctx.fetch=async(url,opts={})=>{const original=await fn(url,opts),d=original&&typeof original==='object'?{build:'16.8.101-SYNC-RELIABILITY',...original}:original;return{ok:true,status:200,headers:{get:()=>null},text:async()=>typeof d==='string'?d:JSON.stringify(d)}};
 return{ctx,run,json,nodes,events,timers,storage,alerts,confirms,route};
}

function backend(){
 const rows=new Map();let requests=0;
 const serverRequire=require('node:module').createRequire(path.join(root,'server.js'));
 const ctx=vm.createContext({console,process:{env:{}},Buffer,URL,AbortController,fetch,structuredClone,__dirname:root,require:serverRequire,
  setInterval:()=>0,setTimeout:()=>0,clearTimeout:()=>{}});
 const code=fs.readFileSync(path.join(root,'server.js'),'utf8');
 vm.runInContext(code.slice(0,code.indexOf('const server=http.createServer')),ctx,{filename:'server.js'});
 ctx.mockRest=async(route,opts={})=>{
  requests++;await Promise.resolve();
  const u=new URL('http://mock/'+route),id=u.searchParams.get('id')?.replace(/^eq\./,''),expected=u.searchParams.get('updated_at')?.replace(/^eq\./,''),method=opts.method||'GET';
  if(method==='GET')return id?(rows.has(id)?[clone(rows.get(id))]:[]):[...rows.values()].filter(x=>x.id.startsWith('mt_')).map(clone);
  if(method==='PATCH'){
   const current=rows.get(id);if(!current||current.updated_at!==expected)return[];
   const saved={...current,...clone(opts.body)};rows.set(id,saved);return[clone(saved)];
  }
  if(method==='POST'){
   for(const row of opts.body){if(rows.has(row.id)&&!u.searchParams.has('on_conflict'))throw Error('Supabase HTTP 409');rows.set(row.id,clone(row))}
   return opts.headers?.Prefer?.includes('return=representation')?clone(opts.body):null;
  }
  throw Error('Unhandled mock operation '+method);
 };
 vm.runInContext('supabaseRest=mockRest',ctx);
 return{ctx,rows,run:c=>vm.runInContext(c,ctx),requests:()=>requests};
}

test('立即同步 acknowledges two holdings operations, clears queue and confirms all components',async()=>{
 const c=client();let applies=0;
 c.run(`H=[{t:'0050',s:1020,c:100}];MODEL_SYNC.ready=true;HOLDINGS_PENDING_TRADES=${JSON.stringify([trade('mt_sample_001'),trade('mt_sample_002')])};`);
 c.route(async url=>url==='/api/model-trades'?{ok:true,initialized:true,trades:[],deletedIds:[]}:url==='/api/holdings-sync/apply-trade'?(applies++,{ok:true,applied:true}):url==='/api/holdings-sync'?{ok:true,initialized:true,holdings:[{t:'0050',s:1020,c:100}],updatedAt:'v1'}:dividend());
 await c.run('syncAllCloud(true)');
 assert.equal(applies,2);assert.equal(c.run('HOLDINGS_PENDING_TRADES.length'),0);assert.equal(c.run('H[0].s'),1020);assert.match(c.run('modelSyncBar()'),/全部同步完成/);
});

test('failed holdings writes keep queue, local shares and exact error',async()=>{
 const c=client();c.run(`H=[{t:'0050',s:1010,c:100}];MODEL_SYNC.ready=true;HOLDINGS_PENDING_TRADES=[${JSON.stringify(trade())}];`);
 c.route(async()=>({ok:false,error:'mock write rejected'}));
 await c.run('syncHoldingsCloud(true)');
 assert.equal(c.run('HOLDINGS_PENDING_TRADES.length'),1);assert.equal(c.run('H[0].s'),1010);assert.match(c.run('HOLDINGS_SYNC.message'),/mock write rejected/);assert.doesNotMatch(c.run('modelSyncBar()'),/^.*<b>全部同步完成/);
});

test('HTTP 200 error and HTML responses cannot erase model trades or acknowledge dirty rows',async()=>{
 for(const response of [{ok:false,error:'mock database unavailable'},'<html>unexpected response</html>',{ok:true,trades:null,deletedIds:[]}]){
  const c=client();c.run(`MODEL_TRADES=[${JSON.stringify({...trade(),_syncDirty:true})}];MODEL_SYNC.knownUnlocked=true;`);c.route(async()=>response);
  await c.run('syncModelTrades(true)');assert.equal(c.run('MODEL_TRADES.length'),1);assert.equal(c.run('MODEL_TRADES[0]._syncDirty'),true);assert.notEqual(c.run('MODEL_SYNC.status'),'ready');
 }
});

test('an edit made during model upload stays dirty and is not replaced by its stale acknowledgement',async()=>{
 const c=client(),t={...trade(),_syncDirty:true,_syncUpdatedAt:'2026-10-13T02:00:00.000Z'};c.run(`MODEL_TRADES=[${JSON.stringify(t)}];MODEL_SYNC.ready=true;`);
 c.route(async url=>{
  if(url.endsWith('/import')){c.run(`MODEL_TRADES[0].entryPrice=101;markModelTradeDirty(MODEL_TRADES[0]);`);return{ok:true}}
  return{ok:true,initialized:true,trades:[t],deletedIds:[]};
 });
 await c.run('syncModelTrades(true)');assert.equal(c.run('MODEL_TRADES[0].entryPrice'),101);assert.equal(c.run('MODEL_TRADES[0]._syncDirty'),true);
});

test('a new trade or deletion during the final download survives reconciliation',async()=>{
 for(const action of ['add','delete']){
  const c=client(),t=trade();let reads=0;c.run(`MODEL_TRADES=[${JSON.stringify(t)}];`);
  c.route(async()=>{reads++;if(reads===2)c.run(action==='add'?`const added=${JSON.stringify(trade('mt_new_002'))};markModelTradeDirty(added);MODEL_TRADES.push(added);`:`MODEL_TRADES=[];MODEL_PENDING_DELETES.push('${t.id}');`);return{ok:true,initialized:true,trades:[t],deletedIds:[]}});
  await c.run('syncModelTrades(true)');assert.equal(c.run('MODEL_TRADES.length'),action==='add'?2:0);
 }
});

test('overlapping sync callers share completion, avoiding duplicate apply requests',async()=>{
 const c=client();let writes=0;c.run(`MODEL_SYNC.ready=true;HOLDINGS_PENDING_TRADES=[${JSON.stringify(trade())}];`);
 c.route(async url=>url.includes('apply-trade')?(writes++,{ok:true,applied:true}):{ok:true});
 await Promise.all([c.run('flushPendingHoldingsTrades()'),c.run('flushPendingHoldingsTrades()')]);assert.equal(writes,1);assert.equal(c.run('HOLDINGS_PENDING_TRADES.length'),0);
});

test('cloud bootstrap can acknowledge shares already included in the local aggregate',async()=>{
 const b=backend(),t=trade();b.ctx.inputTrade=t;
 const initial=await b.run(`cloudUpsertHoldings([{t:'0050',s:1010,c:100}],null,['${t.id}'])`);
 assert.deepEqual(clone(initial.includedTradeIds),[t.id]);
 const retry=await b.run('cloudApplyHoldingsTrade(inputTrade)');assert.equal(retry.alreadyApplied,true);assert.equal(b.rows.get('__HOLDINGS_STATE__').payload.holdings[0].s,1010);
 await assert.rejects(b.run(`cloudUpsertHoldings([{t:'0050',s:1,c:1}],null)`),/其他裝置/);
});

test('two concurrent devices add shares once each; retry after lost response is idempotent',async()=>{
 const b=backend();await b.run(`cloudUpsertHoldings([{t:'0050',s:1000,c:80}],null)`);
 b.ctx.tradeA=trade('mt_device_A');b.ctx.tradeB={...trade('mt_device_B'),shares:20,entryPrice:110};
 await Promise.all([b.run('cloudApplyHoldingsTrade(tradeA)'),b.run('cloudApplyHoldingsTrade(tradeB)')]);
 await b.run('cloudApplyHoldingsTrade(tradeA)');
 const row=b.rows.get('__HOLDINGS_STATE__');assert.equal(row.payload.holdings[0].s,1030);assert.ok(Math.abs(row.payload.holdings[0].c-(80000+1000+2200)/1030)<1e-8);assert.equal(row.payload.appliedTradeIds.length,2);
});

test('stale and missing cloud revision cannot replace a newer holdings portfolio',async()=>{
 const b=backend();const first=await b.run(`cloudUpsertHoldings([{t:'0050',s:1000,c:80}],null)`);b.ctx.t=trade();await b.run('cloudApplyHoldingsTrade(t)');b.ctx.oldRevision=first.updatedAt;
 await assert.rejects(b.run(`cloudUpsertHoldings([{t:'0050',s:1000,c:80}],oldRevision)`),/其他裝置/);
 assert.equal(b.rows.get('__HOLDINGS_STATE__').payload.holdings[0].s,1010);
});

test('dividend writes merge concurrent events and preserve the newer holdings snapshot',async()=>{
 const b=backend();
 b.ctx.old={snapshots:[{day:'2026-10-13',holdings:{'0050':1000},recordedAt:'2026-10-13T01:00:00Z'}],locked:{a:{lockedAt:'2026-10-13T01:00:00Z'}}};
 b.ctx.current={snapshots:[{day:'2026-10-13',holdings:{'0050':1010},recordedAt:'2026-10-13T02:00:00Z'}],locked:{b:{lockedAt:'2026-10-13T02:00:00Z'}}};
 await Promise.all([b.run('saveCloudDividendState(current)'),b.run('saveCloudDividendState(old)')]);
 const state=b.rows.get('__DIVIDEND_AUTO__').payload;assert.equal(state.snapshots[0].holdings['0050'],1010);assert.deepEqual(Object.keys(state.locked).sort(),['a','b']);
});

test('concurrent deletion and batch upload cannot resurrect a trade; closing retains dividend P&L',async()=>{
 const b=backend();b.ctx.t=trade();await b.run('cloudUpsertTrade(t)');
 await Promise.all([b.run('cloudDeleteTrade(t.id)'),b.run('cloudUpsertTradesBatch([t])')]);
 assert.equal(b.rows.get(b.ctx.t.id).payload._deleted,true);
 b.ctx.closed={...trade('mt_closed_001'),exitAt:'2026-10-13T03:00:00Z',exitPrice:120,realizedPnL:220,realizedPricePnL:200,realizedDividendPnL:20,_syncUpdatedAt:'2026-10-13T03:00:00Z'};
 await b.run('cloudUpsertTrade(closed)');b.ctx.open={...trade('mt_closed_001'),_syncUpdatedAt:'2026-10-13T04:00:00Z'};await b.run('cloudUpsertTrade(open)');
 const closed=b.rows.get('mt_closed_001').payload;assert.equal(closed.exitAt,b.ctx.closed.exitAt);assert.equal(closed.realizedDividendPnL,20);
});

test('invalid fractional holdings and trades are rejected; official host validation is exact',async()=>{
 const b=backend();assert.throws(()=>b.run(`cleanHoldingsInput([{t:'0050',s:10.5,c:100}])`),/整數股數/);
 b.ctx.t={...trade(),shares:0.5};await assert.rejects(b.run('cloudApplyHoldingsTrade(t)'),/invalid holdings trade/);
 assert.equal(b.run(`isOfficialHostFor('00878','https://www.cathaysite.com.tw/a')`),true);assert.equal(b.run(`isOfficialHostFor('00878','https://cathaysite.com.tw.fake.com/a')`),false);
 assert.equal(b.run(`modelSyncAuthorized({headers:{cookie:'model_sync=%bad%'}})`),false);
});

test('client initialization recovers the no-cloud / pending-trade deadlock without duplicate shares',async()=>{
 const c=client();let cloud=null;
 c.run(`MODEL_SYNC.ready=true;H=[{t:'0050',s:1010,c:100}];HOLDINGS_PENDING_TRADES=[${JSON.stringify(trade())}];`);
 c.route(async(url,opts)=>{
  if(url.includes('apply-trade'))return{ok:false,error:'雲端持股尚未初始化'};
  if(url==='/api/holdings-sync'&&opts.method==='POST'){const body=JSON.parse(opts.body);cloud={ok:true,initialized:true,holdings:body.holdings,updatedAt:'v1'};return{...cloud,includedTradeIds:body.includedTradeIds}}
  if(url==='/api/holdings-sync')return cloud||{ok:true,initialized:false,holdings:[],updatedAt:null};
  if(url==='/api/model-trades')return{ok:true,initialized:true,trades:[],deletedIds:[]};return dividend();
 });
 await c.run('uploadThisHoldingsToCloud()');assert.equal(c.run('HOLDINGS_PENDING_TRADES.length'),0);assert.equal(cloud.holdings[0].s,1010);assert.equal(c.confirms.length,1);
});

test('missing prices and metrics render as unknown; backend errors do not poison last-good caches',async()=>{
 const c=client();assert.equal(c.run('fmt(null)'),'—');assert.equal(c.run('pct(undefined)'),'—');assert.equal(c.run('money0(null)'),'—');assert.equal(c.run('pct(0)'),'+0.00%');
 c.route(async()=>({ok:false,error:'mock source failed'}));await assert.rejects(c.run(`get('/api/context')`),/mock source failed/);
});

test('all navigation targets, initial renderers and lazy page errors work without missing DOM IDs',async()=>{
 const c=client();c.route(async url=>url.includes('history-status')?{ok:true,history:[]}:url.includes('model-trades')?{ok:true,initialized:true,trades:[],deletedIds:[]}:url.includes('holdings-sync')?{ok:true,initialized:false,holdings:[]}:url.includes('dividend')?dividend():{ok:false,error:'mock external source unavailable'});
 c.run('setMode();renderHoldings();renderDetailTabs();renderBacktestTabs();renderEvents();renderModelTrades();renderConstituentTabs();');
 for(const [id,n] of c.nodes)if(n.classList.contains('page'))c.run(`setPage('${id}')`);
 // Exercise a complete constituent response and trend cards, including fallback fields.
 c.ctx.constFixture={code:'0050',complete:true,actual:50,expected:50,items:[],summary:{}};
 c.run('renderConstituents(constFixture)');
 c.run(`lastTrendBuy={models:Object.fromEntries(ETF.map(code=>[code,{ok:true,price:100,changePct:1,score:90,status:'WATCH',statusText:'觀察',action:'等待',levels:{},trend:{},backtest:{}}]))};renderTrendBuy();refreshTrendLiveQuotes();`);
 await c.run('syncAllCloud(true)');
 assert.equal(c.run('typeof syncAllCloud'),'function');assert.ok(c.nodes.get('trendBuyCards').innerHTML.includes('trendLivePrice-0050'));
});

test('backgrounded pages suppress polling and shared cooldown keeps failed writes queued',async()=>{
 const c=client();let count=0;c.route(async()=>{count++;return{ok:true}});c.ctx.document.visibilityState='hidden';
 await c.run('Promise.all([loadEtfLive(),loadMarket(),loadSlow(),loadNight(),loadBuy(),loadHistoryStatus(),syncAllCloud(false)])');assert.equal(count,0);
 c.run('API_TRAFFIC.cooldownUntil=Date.now()+20000;');assert.throws(()=>c.run('apiTrafficCheckResponse({status:429,headers:{get:()=>null}},"")'),/限流/);
});

test('complete formal models render all four ETFs, history and 45 validation slots',()=>{
 const b=backend(),c=client();
 b.run(`diskWrite=()=>{};dailyChaseCalibration=()=>({effectiveHardThreshold:88,warningThreshold:80});`);
 b.ctx.history={rows:Array.from({length:300},(_,i)=>({date:new Date(Date.UTC(2025,8,1+i)).toISOString().slice(0,10),close:80+i*.06,open:79.9+i*.06,high:80.5+i*.06,low:79.5+i*.06,ohlc:true})),validation:{backtestReadyPass:true,fullHistoryPass:true},source:'mock validated history'};
 b.ctx.quotes=Object.fromEntries(['0050','0056','00878','00919'].map(code=>[code,{last:98,prevClose:99,open:99,low:97,high:99,time:new Date().toISOString()}]));
 const models=clone(b.run(`Object.fromEntries(ETF.map(code=>[code,modelOne(code,quotes[code],history,{score:30,parts:[]},null,true)]))`));
 c.ctx.models=models;c.ctx.quotes=b.ctx.quotes;
 c.run(`lastLive={quotes};lastBuy={models,quotes,dataFresh:true,tradingDates:[]};updateState();renderAllModel();setPage('model');renderSpecs(true);`);
 assert.equal((c.nodes.get('buyCards').innerHTML.match(/記錄模型買入/g)||[]).length,4);
 assert.equal((c.nodes.get('specGrid').innerHTML.match(/class="spec /g)||[]).length,45);
 assert.match(c.nodes.get('validationSummary').innerHTML,/交易核心/);
});

test('B risk banner warns when A allows an entry but B rejects it, without mutating official A',()=>{
 const c=client(),m={status:'TREND_BUY',score:97,shadowB:{status:'WAIT_CHASE',reason:'突破距離過大'}};
 c.ctx.sample=m;
 const before=JSON.stringify(m),h=c.run('trendShadowAdvisory(sample)');
 assert.match(h,/風險分歧/);
 assert.match(h,/突破距離過大/);
 assert.match(h,/暫緩/);
 assert.equal(JSON.stringify(m),before);
 assert.equal(c.run('sample.status'),'TREND_BUY');
});

test('B candidate aligned, missing B and A not ready are clearly differentiated',()=>{
 const c=client();
 c.ctx.pass={status:'TREND_BUY',shadowB:{status:'B_CANDIDATE',reason:'符合條件'}};
 c.ctx.unknown={status:'TREND_BUY'};
 c.ctx.incomplete={status:'TREND_BUY',shadowB:{status:'DATA_INCOMPLETE',reason:'缺當日開盤'}};
 c.ctx.noA={status:'WAIT_BREAKOUT',shadowB:{status:'B_CANDIDATE',reason:'不可信'}};
 assert.match(c.run('trendShadowAdvisory(pass)'),/Shadow候選也符合/);
 assert.match(c.run('trendShadowAdvisory(unknown)'),/狀態未取得/);
 assert.match(c.run('trendShadowAdvisory(incomplete)'),/不得把資料缺漏當成否決或通過/);
 assert.equal(c.run('trendShadowAdvisory(noA)'),'');
});

test('B advice cannot insert unsafe HTML and remains next to A buying status',()=>{
 const c=client();
 c.ctx.bad={status:'TREND_BUY',shadowB:{status:'WAIT_CANDLE',reason:'<img src=x onerror=alert(1)>'}};
 assert.doesNotMatch(c.run('trendShadowAdvisory(bad)'),/<img/);
 assert.match(c.run('trendShadowAdvisory(bad)'),/&lt;img/);
 c.run("lastTrendBuy={models:{'0050':{ok:true,price:100,score:97,status:'TREND_BUY',statusText:'可小額加碼',action:'A版可小額',levels:{breakout20:99,maxChase:101},trend:{},shadowB:{status:'WAIT_CHASE',reason:'突破過遠'},backtest:{}}}};renderTrendBuy();");
 const h=c.nodes.get('trendBuyCards').innerHTML;
 assert.match(h,/A版訊號成立｜B版風險分歧/);
 assert.match(h,/記錄強勢加碼買入/); // Formal A trade permissions remain exactly as before.
});

test('trend live prices update independently while score, entry band and model timestamp stay fixed',()=>{
 const c=client();c.run(`$('trendBuyPage').classList.add('on');lastTrendBuy={fetchedAt:'old-model-time',models:{'0050':{ok:true,price:100,score:93,status:'TREND_BUY',levels:{entryLow:99,entryHigh:101},trend:{},backtest:{}}}};lastLive={quotes:{'0050':{last:100,prevClose:99}}};renderTrendBuy();lastLive.quotes['0050'].last=102;refreshTrendLiveQuotes();`);
 assert.match(c.nodes.get('trendLivePrice-0050').textContent,/102\.00/);
 assert.equal(c.run(`lastTrendBuy.models['0050'].score`),93);assert.equal(c.run(`lastTrendBuy.models['0050'].levels.entryHigh`),101);assert.equal(c.run('lastTrendBuy.fetchedAt'),'old-model-time');
});

test('four ETF dividend forecast uses latest shares and never changes locked ex-date amount',()=>{
 const b=backend();
 const x=b.run("dividendNextForecast('0056',[],null,820,'2026-10-14')");
 assert.equal(x.exDate,'2026-10-22');assert.equal(x.status,'estimated');
 assert.equal(x.cashEstimate,1410);assert.equal(x.sharesEstimate,820);
 const y=b.run("dividendNextForecast('0056',[],null,920,'2026-10-14')");
 assert.equal(y.cashEstimate,1582);
 assert.equal(b.run("dividendNextForecast('0056',[],null,920,'2026-10-22')"),null);
 const z=b.run("dividendNextForecast('00919',[],null,650,'2026-10-14')");
 assert.equal(z,null);
});

test('official dividend announcement is preferred over estimate for any of the four ETFs',()=>{
 const b=backend();
 const sameDay={exDate:'2026-10-22',payDate:'2026-11-11',amount:1.78,status:'actual',estimated:false,source:'TWSE正式公告'};
 b.ctx.ev=sameDay;
 const a=b.run("dividendNextForecast('0056',[],ev,820,'2026-10-20')");
 assert.equal(a.amount,1.78);assert.equal(a.estimated,false);assert.equal(a.cashEstimate,1460);
 b.ctx.other=[{exDate:'2026-12-05',payDate:'2026-12-30',amount:.42}];
 for(const code of ['0050','00878','00919']){
  b.ctx.code=code;const x=b.run("dividendNextForecast(code,other,null,100,'2026-10-14')");
  assert.equal(x.cashEstimate,42);assert.equal(x.estimated,false);
 }
});

test('future estimated, entitled-unpaid and already-paid dividends render separately in all ETF cards',()=>{
 const c=client();
 c.run(`H=[{t:'0050',s:3380,c:79.65},{t:'0056',s:820,c:35.78},{t:'00878',s:4080,c:18.39},{t:'00919',s:650,c:20.78}];
 DIVIDEND_AUTO={ready:true,snapshotDay:'2026-10-13',byCode:{
 '0050':{received:2954,pending:0,nextForecast:{exDate:'2026-11-15',amount:.4,sharesEstimate:3380,cashEstimate:1352,status:'estimated',estimated:true}},
 '0056':{received:3836,pending:0,nextForecast:{exDate:'2026-10-22',amount:1.72,sharesEstimate:820,cashEstimate:1410,status:'estimated',estimated:true}},
 '00878':{received:15645,pending:0,nextForecast:null},
 '00919':{received:1788,pending:605,nextPending:{shares:550,amount:1.1,payDate:'2026-10-15'},nextForecast:null}}};renderHoldings();`);
 const h=c.nodes.get('holdings').innerHTML;
 for(const code of ['0050','0056','00878','00919'])assert.match(h,new RegExp(code));
 assert.match(h,/已除息待入帳/);assert.match(h,/下一次配息預估/);
 assert.match(h,/1,410元/);assert.match(h,/605元/);
 assert.match(h,/550股 × 1\.10元/);assert.match(h,/等待公告/);
 assert.match(h,/預估公告（尚未確認）/);
 assert.equal(c.run('dividendStats(\'00919\',H[3]).received'),1788);
 assert.equal(c.run('dividendStats(\'00919\',H[3]).pending'),605);
 assert.equal(c.run('dividendStats(\'0056\',H[1]).nextForecast.cashEstimate'),1410);
 assert.equal(c.run('DIVIDEND_AUTO.byCode[\'00919\'].received'),1788);
});

test('dividend forecast fields escape external content and never mutate actual holdings',()=>{
 const c=client();
 c.ctx.ds={received:200,pending:0,nextForecast:{status:'estimated',estimated:true,amount:1.5,sharesEstimate:5,cashEstimate:8,exDate:'<img src=x onerror=alert(1)>',payDate:'2026-11-01'}};
 const html=c.run("dividendTimelineMarkup('0050',ds)");
 assert.doesNotMatch(html,/<img /);assert.match(html,/&lt;img/);
 assert.equal(c.run("dividendTimelineMarkup('not-etf',ds)"),'');
});

test('0050 30 shares bought at 112.50 show a loss at verified live 109.55 even when server perf still says gain',()=>{
 const c=client(),t={...trade('mt_live_loss'),entryPrice:112.5,shares:30,entryDate:'2026-10-13',
  perf:{currentPrice:112.95,currentReturnPct:.40,currentTotalReturnPct:.40,accruedDividendPerShare:0,
   currentPriceSource:'daily history fallback',updatedAt:'2026-10-13T03:30:00Z',horizon:{}}};
 c.ctx.one=t;
 c.run("lastLive={quotes:{'0050':{last:109.55,date:dayKey(),fetchTime:new Date().toISOString(),realtime:true}}}");
 const result=c.json('modelNetMetrics(one)');
 assert.equal(result.currentPrice,109.55);assert.equal(result.priceSource,'ETF即時行情');
 assert.equal(result.gross,-88.5);assert.equal(result.cost,13);assert.equal(result.net,-101.5);
 assert.ok(result.ret<-3.0);assert.ok(result.currentTotalReturnPct<-2.6);
 const details=c.run('modelTradeDetailHtml(one)');
 assert.match(details,/109\.55元/);assert.match(details,/含息毛損益 -88/);
});

test('four ETF positions are always marked from latest common quote instead of stale API totals',()=>{
 const c=client();c.run("lastLive={quotes:Object.fromEntries(ETF.map(code=>[code,{last:90,date:dayKey(),fetchTime:new Date().toISOString(),realtime:true}]))}");
 for(const code of ['0050','0056','00878','00919']){
  const item={...trade('mt_mark_'+code),code,entryPrice:100,shares:10,entryDate:'2026-10-13',
   perf:{currentPrice:101,currentTotalReturnPct:1,accruedDividendPerShare:0,updatedAt:'2026-10-13T04:00:00Z'}};
  c.ctx.example=item;
  const m=c.json('modelNetMetrics(example)');
  assert.equal(m.currentPrice,90,code);assert.ok(m.net<0,code);
 }
});

test('during an open session stale old cloud performance cannot masquerade as a current gain',()=>{
 const c=client();c.ctx.t={...trade('mt_stale_001'),entryPrice:112.5,shares:30,entryDate:'2026-10-13',
  perf:{currentPrice:113,currentTotalReturnPct:.44,updatedAt:'2026-10-13T03:25:00Z'}};
 c.run("lastLive={quotes:{'0050':{last:109.55,date:'2026-10-13',fetchTime:'2026-10-13T01:00:00Z',realtime:false,lastGoodFallback:true}}}");
 // Simulate trading hours regardless of when CI happens to execute.
 c.run("twMarketOpenClient=()=>true");
 const m=c.json('modelNetMetrics(t)');
 assert.equal(m.currentPrice,null);assert.equal(m.net,null);
 assert.equal(m.priceSource,'等待最新行情');
});

test('diagnostics and model card reuse marked valuation, original trade/perf records remain unchanged',()=>{
 const c=client();
 const t={...trade('mt_snapshot_0050'),entryDate:'2026-10-13',entryPrice:112.5,shares:30,
  snapshot:{score:72,zones:[]},perf:{currentPrice:112.95,currentTotalReturnPct:.4,updatedAt:'2026-10-13T03:00:00Z',horizon:{}}};
 c.ctx.caseTrade=t;
 c.run("lastLive={quotes:{'0050':{last:109.55,date:dayKey(),fetchTime:new Date().toISOString(),realtime:true}}};MODEL_TRADES=[caseTrade]");
 const before=JSON.stringify(t),m=c.json('modelNetMetrics(caseTrade)');
 assert.equal(m.gross,-88.5);assert.equal(JSON.stringify(t),before);
 const d=c.json('performanceDiagnosticPayload().trades[0]');
 assert.equal(d.currentPrice,109.55);assert.equal(d.netPnL,-101.5);assert.equal(d.currentPriceSource,'ETF即時行情');
 assert.equal(JSON.stringify(t),before);
 c.run('renderModelTrades()');
 assert.match(c.nodes.get('modelTradeList').innerHTML,/109\.55元/);
 assert.match(c.nodes.get('liveTradeSummary').innerHTML,/\-102/);
});

test('0050 hardGate FAIL explanation is explicit about touched price not being an executable buy',()=>{
 const c=client();
 c.ctx.sample={r:{hardVeto:true,hardVetoReason:'市場/權值/廣度至少兩項急殺',score:42},m:{layers:[{zone:{low:109.84,high:110.15}},{zone:{low:109.31,high:109.61}},{zone:{low:108.62,high:108.93}}]},px:109.55,activeStatus:'WAIT',statuses:['WAIT','WAIT','WAIT'],activeLayer:1};
 const explanation=c.run("explain('0050',sample)");
 assert.match(explanation,/硬Gate FAIL/);assert.match(explanation,/非可執行買點/);
 assert.match(explanation,/第2層/);
});

test('mixed frontend/backend builds block writes before applying any holdings operation',async()=>{
 const c=client();let writes=0;c.run(`MODEL_SYNC.ready=true;HOLDINGS_PENDING_TRADES=[${JSON.stringify(trade())}];`);
 c.route(async(url,opts)=>{if(opts.method==='POST')writes++;return{ok:true,build:'older-deployed-server'}});
 await c.run('flushPendingHoldingsTrades()');assert.equal(writes,0);assert.equal(c.run('HOLDINGS_PENDING_TRADES.length'),1);assert.match(c.run('HOLDINGS_SYNC.message'),/前後端版本不同/);
});
