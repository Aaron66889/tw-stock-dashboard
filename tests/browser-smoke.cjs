'use strict';
// Isolated Chromium smoke test: static app assets, synthetic API failures,
// no production Render, Supabase, accounts or trade writes.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','public');
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/')){
  res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
  return res.end(JSON.stringify({ok:false,error:'ISOLATED_CI_OFFLINE_API'}));
 }
 let filepath=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
 if(!filepath.startsWith(root+path.sep)&&filepath!==path.join(root,'index.html')){res.writeHead(403);return res.end()}
 fs.readFile(filepath,(err,body)=>{
  if(err){res.writeHead(404);return res.end('missing')}
  res.writeHead(200,{'content-type':types[path.extname(filepath)]||'application/octet-stream'});
  res.end(body);
 });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1365,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.stack||error.message));
  const result=await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'load',timeout:30000});
  assert.equal(result.status(),200);
  await page.waitForTimeout(1500);
  const ui=await page.evaluate(()=>({
   title:document.title,ready:document.readyState,
   haveMonitor:typeof observeOfficialEntryPermissionTimeout==='function',
   haveFreshness:typeof officialExecutionFreshnessExplanation==='function',
   haveOfficialGate:typeof officialExecutionSnapshotReady==='function',
   haveBootstrap:typeof boot==='function',
   modelBuyButtons:document.querySelectorAll('[onclick*="openModelTrade"]').length,
   homeModelSection:!!document.getElementById('homeBuyRanking'),
   scripts:Array.from(document.scripts).filter(s=>s.src).map(s=>s.src.split('/').pop().split('?')[0])
  }));
  assert.equal(ui.ready,'complete');
  assert.equal(ui.haveMonitor,true);
  assert.equal(ui.haveFreshness,true);
  assert.equal(ui.haveOfficialGate,true);
  assert.equal(ui.haveBootstrap,true);
  assert.equal(ui.homeModelSection,true);
  assert.ok(ui.scripts.includes('app.js'));
  assert.ok(ui.title.includes('台股戰情'));
  // Real DOM render with a purely synthetic 4-ETF model and quotes.
  const cases=await page.evaluate(()=>{
   const now=new Date().toISOString(),day=dayKey(),prices={'0050':100,'0056':50,'00878':30,'00919':29};
   const models={},snapshots={},quotes={};
   for(const c of ETF){
    const px=prices[c],z={low:px-1,high:px+1};
    models[c]={code:c,price:px,score:70,history:{historyDays:300,atr14:1},
     hardVeto:false,noBuyToday:false,environmentScore:25,chaseRisk:20,
     health:{usable:false},historyOfficial:false};
    snapshots[c]={layers:[
     {zone:z,confirmedZone:z,confirmed:true,executionLow:px-1,executionHigh:px+1,confirmedAt:now,gateBlocked:false},
     {zone:{low:px-3,high:px-2},confirmed:false},
     {zone:{low:px-5,high:px-4},confirmed:false}
    ]};
    quotes[c]={last:px,prevClose:px+1,date:day,serverFetchedAt:now,fetchTime:now,realtime:true};
   }
   lastBuy={fetchedAt:now,modelFreshByCode:Object.fromEntries(ETF.map(c=>[c,true])),models};
   lastLive={ok:true,quotes};
   STATE.models=snapshots;
   const snap=()=>{
    renderHomeRanking();renderBuyCards();
    const home=[...document.querySelectorAll('#homeBuyRanking .buycard')];
    const details=[...document.querySelectorAll('#buyCards .buycard')];
    return {
     home:home.map(n=>({code:n.querySelector('.ticker')?.textContent?.trim().split(/\s+/)[0],text:n.innerText,disabled:n.querySelector('button[onclick*="openModelTrade"]')?.disabled})),
     details:details.map(n=>({code:n.querySelector('.ticker')?.textContent?.trim().split(/\s+/)[0],text:n.innerText,disabled:n.querySelector('button[onclick*="openModelTrade"]')?.disabled}))
    };
   };
   const eligible=snap();
   quotes['0050'].lastGoodFallback=true;
   const backup=snap();
   quotes['0050'].lastGoodFallback=false;
   models['0050'].hardVeto=true;models['0050'].hardVetoReason='synthetic Gate';
   const veto=snap();
   models['0050'].hardVeto=false;
   quotes['0050'].last=97;
   const below=snap();
   return {eligible,backup,veto,below};
  });
  for(const scenario of ['eligible','backup','veto','below']){
   assert.equal(cases[scenario].home.length,4,scenario+' home cards');
   assert.equal(cases[scenario].details.length,4,scenario+' detailed buy cards');
  }
  const find=(scenario,view,code)=>{const card=cases[scenario][view].find(x=>x.code===code);assert.ok(card,scenario+' '+view+' '+code);return card};
  for(const view of ['home','details']){
   assert.equal(find('eligible',view,'0050').disabled,false,'eligible quote must enable 0050 model buy '+view);
   assert.equal(find('backup',view,'0050').disabled,true,'last-good fallback must disable 0050 model buy '+view);
   assert.match(find('backup',view,'0050').text,/最後有效報價/);
   assert.equal(find('veto',view,'0050').disabled,true,'hard Gate must disable model buy '+view);
   assert.match(find('veto',view,'0050').text,/synthetic Gate/);
   assert.equal(find('below',view,'0050').disabled,true,'below frozen execution band must disable model buy '+view);
   assert.match(find('below',view,'0050').text,/低於首次確認執行下限/);
   for(const other of ['0056','00878','00919']){
    assert.equal(find('eligible',view,other).disabled,false,'independent '+other+' signal remains eligible '+view);
    assert.equal(find('below',view,other).disabled,false,'0050 dropping must not affect '+other+' '+view);
   }
  }
  // A previously confirmed layer can remain CONFIRMED_IN after the score
  // subsequently falls below its minimum. UI and save Gate must both block.
  const lowScore=await page.evaluate(()=>{
   lastLive.quotes['0050'].last=100;
   lastBuy.models['0050'].hardVeto=false;
   lastBuy.models['0050'].score=49; // L1 requires 50
   renderHomeRanking();renderBuyCards();
   const cards=['#homeBuyRanking .buycard','#buyCards .buycard'].map(sel=>
    [...document.querySelectorAll(sel)].find(n=>n.querySelector('.ticker')?.textContent?.startsWith('0050')));
   const read=cards.map(card=>({disabled:card?.querySelector('button[onclick*="openModelTrade"]')?.disabled,
    text:card?.innerText||''}));
   const allowed=officialLayerExecutionEligible(statusFor('0050'),0);
   let alertText='';
   const oldAlert=window.alert;
   window.alert=msg=>{alertText=String(msg)};
   try{openModelTrade('0050',1)}finally{window.alert=oldAlert}
   const modalOpen=document.getElementById('modelTradeModal')?.classList.contains('on');
   lastBuy.models['0050'].score=70;
   return{read,allowed,alertText,modalOpen};
  });
  assert.equal(lowScore.allowed,false,'L1 minimum-score rule is shared by official decision');
  for(const item of lowScore.read){
   assert.equal(item.disabled,true,'confirmed below-minimum-score button must stay disabled');
   assert.match(item.text,/未達最低 50 分/,'display must explain score block');
  }
  assert.match(lowScore.alertText,/尚未通過正式模型買入許可/);
  assert.equal(lowScore.modalOpen,false,'direct manual invocation cannot bypass score Gate');
  // Exercise the real loadEtfLive() browser ingestion path, not just injected
  // state. A synthetic provider fallback must be displayed but never executable.
  const ingestion=await page.evaluate(async()=>{
   const currentDay=dayKey(),at=new Date().toISOString();
   get=async url=>{
    if(!String(url).startsWith('/api/etf-live'))throw Error('ISOLATED_API_NOT_ALLOWED');
    return {ok:true,quotes:Object.fromEntries(ETF.map(c=>[c,{
     last:c==='0050'?96.5:lastLive.quotes[c].last,
     prevClose:101,date:currentDay,serverFetchedAt:at,
     source:'Anue synthetic fallback',realtime:false,lastGoodFallback:true
    }]))};
   };
   await loadEtfLive();
   const code='0050';
   const home=[...document.querySelectorAll('#homeBuyRanking .buycard')].find(n=>n.querySelector('.ticker')?.textContent?.trim().startsWith(code));
   const detail=[...document.querySelectorAll('#buyCards .buycard')].find(n=>n.querySelector('.ticker')?.textContent?.trim().startsWith(code));
   return{
    livePrice:lastLive.quotes[code].last,
    fallback:lastLive.quotes[code].lastGoodFallback,
    source:lastLive.quotes[code].source,
    browserReceived:!!lastLive.quotes[code].fetchTime,
    homeText:home?.innerText||'',detailText:detail?.innerText||'',
    homeDisabled:home?.querySelector('button[onclick*="openModelTrade"]')?.disabled,
    detailDisabled:detail?.querySelector('button[onclick*="openModelTrade"]')?.disabled
   };
  });
  assert.equal(ingestion.livePrice,96.5,'API quote must reach actual browser quote store');
  assert.equal(ingestion.fallback,true);
  assert.equal(ingestion.browserReceived,true);
  assert.equal(ingestion.homeDisabled,true);
  assert.equal(ingestion.detailDisabled,true);
  assert.match(ingestion.homeText,/最後有效報價/);
  assert.match(ingestion.detailText,/最後有效報價/);
  // Simulate recovery using the actual ETF-live ingestion path while keeping
  // the synthetic model state frozen (server-model updateOne is tested elsewhere).
  // A fresh price alone must NEVER rescue stale model provenance.
  const recovery=await page.evaluate(async()=>{
   const now=new Date().toISOString(),day=dayKey(),code='0050';
   // Isolated fixture deliberately lacks the full raw/historical updateOne payload.
   // Suppress model recalculation, but retain real quote ingestion + render gates.
   updateOne=()=>{};
   const getCards=()=>{
    const pick=selector=>{
     const card=[...document.querySelectorAll(selector)]
      .find(n=>n.querySelector('.ticker')?.textContent?.trim().startsWith(code));
     return {disabled:card?.querySelector('button[onclick*="openModelTrade"]')?.disabled,
      text:card?.innerText||''};
    };
    return {home:pick('#homeBuyRanking .buycard'),details:pick('#buyCards .buycard')};
   };
   const scenarios={};
   lastBuy.modelFreshByCode[code]=false;
   get=async url=>{
    if(!String(url).startsWith('/api/etf-live'))throw Error('ISOLATED_API_NOT_ALLOWED');
    return {ok:true,quotes:Object.fromEntries(ETF.map(c=>[c,{
     last:c===code?100:lastLive.quotes[c].last,
     date:day,prevClose:101,serverFetchedAt:now,
     source:'Yahoo synthetic recovered',realtime:true,lastGoodFallback:false
    }]))};
   };
   await loadEtfLive();
   scenarios.priceRecoveredModelStale={...getCards(),
    quoteRealtime:lastLive.quotes[code].realtime,
    modelFresh:lastBuy.modelFreshByCode[code],
    gate:officialExecutionSnapshotReady(code)};
   lastBuy.modelFreshByCode[code]=true;
   lastBuy.fetchedAt=new Date().toISOString();
   renderHomeRanking();renderBuyCards();
   scenarios.bothRecovered={...getCards(),gate:officialExecutionSnapshotReady(code)};
   return scenarios;
  });
  assert.equal(recovery.priceRecoveredModelStale.quoteRealtime,true);
  assert.equal(recovery.priceRecoveredModelStale.modelFresh,false);
  assert.equal(recovery.priceRecoveredModelStale.gate,false);
  assert.equal(recovery.bothRecovered.gate,true);
  for(const view of ['home','details']){
   assert.equal(recovery.priceRecoveredModelStale[view].disabled,true,
    'quote recovery alone must never override stale model '+view);
   assert.match(recovery.priceRecoveredModelStale[view].text,/模型資料尚未更新/);
   assert.equal(recovery.bothRecovered[view].disabled,false,
    'both model and quote freshness must recover model buy '+view);
   assert.match(recovery.bothRecovered[view].text,/允許記錄正式模型買入/);
  }
  // Isolated holdings-cloud failure-path browser integration. Only synthetic
  // test holdings are used; no provider network, accounts or production writes.
  const cloudSafety=await page.evaluate(async()=>{
   MODEL_SYNC.ready=true;
   MODEL_SYNC.status='ready';
   HOLDINGS_PUSH_BUSY=false;
   HOLDINGS_SYNC.busy=false;
   HOLDINGS_MANUAL_DIRTY=false;
   HOLDINGS_PENDING_TRADES=[];
   const initial=[{t:'0050',n:'synthetic',s:123,c:80,dividendReceived:0}];
   H=JSON.parse(JSON.stringify(initial));
   localStorage.setItem('twStockHoldingsV12',JSON.stringify(H));
   const before=localStorage.getItem('twStockHoldingsV12');
   flushPendingHoldingsTrades=async()=>{};
   let calls=0;
   modelSyncFetch=async url=>{
    if(url!=='/api/holdings-sync')throw Error('UNEXPECTED_CLOUD_ENDPOINT');
    calls++;
    throw Object.assign(new Error('SYNTHETIC_CLOUD_OFFLINE'),{status:503});
   };
   await syncHoldingsCloud(false);
   const offline={same:JSON.stringify(H)===JSON.stringify(initial),
    storageSame:localStorage.getItem('twStockHoldingsV12')===before,ready:HOLDINGS_SYNC.ready,message:HOLDINGS_SYNC.message};
   HOLDINGS_SYNC.busy=false;
   modelSyncFetch=async()=>({ok:true,initialized:true,holdings:null,updatedAt:'test'});
   await syncHoldingsCloud(false);
   const malformed={same:JSON.stringify(H)===JSON.stringify(initial),
    storageSame:localStorage.getItem('twStockHoldingsV12')===before,ready:HOLDINGS_SYNC.ready,message:HOLDINGS_SYNC.message};
   HOLDINGS_SYNC.busy=false;
   HOLDINGS_PENDING_TRADES=[{id:'synthetic-pending',code:'0050',shares:10,entryPrice:99}];
   let readWhilePending=false;
   modelSyncFetch=async()=>{readWhilePending=true;return {ok:true,initialized:true,holdings:[]}};
   await syncHoldingsCloud(false);
   const pending={same:JSON.stringify(H)===JSON.stringify(initial),
    storageSame:localStorage.getItem('twStockHoldingsV12')===before,
    cloudCalled:readWhilePending,ready:HOLDINGS_SYNC.ready};
   HOLDINGS_PENDING_TRADES=[];
   HOLDINGS_SYNC.busy=false;
   modelSyncFetch=async()=>{
    HOLDINGS_LOCAL_REV++;
    return {ok:true,initialized:true,holdings:[{t:'0050',s:1,c:1}],updatedAt:'test'};
   };
   await syncHoldingsCloud(false);
   const concurrentEdit={same:JSON.stringify(H)===JSON.stringify(initial),
    storageSame:localStorage.getItem('twStockHoldingsV12')===before,ready:HOLDINGS_SYNC.ready};
   MODEL_SYNC.ready=false;
   return {offline,malformed,pending,concurrentEdit,calls};
  });
  assert.equal(cloudSafety.calls,1);
  for(const scenario of ['offline','malformed','pending','concurrentEdit']){
   assert.equal(cloudSafety[scenario].same,true,'must preserve local holdings on '+scenario);
   assert.equal(cloudSafety[scenario].storageSame,true,'must preserve local storage on '+scenario);
   assert.equal(cloudSafety[scenario].ready,false,'must not claim sync success on '+scenario);
  }
  assert.equal(cloudSafety.pending.cloudCalled,false,'pending transactions block cloud holdings downloads');
  assert.match(cloudSafety.offline.message,/SYNTHETIC_CLOUD_OFFLINE/);
  assert.match(cloudSafety.malformed.message,/格式不完整/);
  // Test the actual pending-purchase commit queue against synthetic server
  // acknowledgements; never touch live Supabase or cloud transaction endpoints.
  const purchaseSafety=await page.evaluate(async()=>{
   const op={id:'synthetic-order-1',code:'0050',shares:10,entryPrice:99,entryAt:'2026-11-16T02:00:00Z'};
   H=[{t:'0050',n:'synthetic',s:133,c:80}]; // already locally incremented
   const localBefore=JSON.stringify(H);
   HOLDINGS_PENDING_TRADES=[{...op}];
   MODEL_TRADES=[{...op,_syncDirty:true,tradeType:'manual'}];
   MODEL_SYNC.ready=true;
   MODEL_SYNC.knownUnlocked=true;
   HOLDINGS_OP_BUSY=false;
   HOLDINGS_PUSH_BUSY=false;
   API_TRAFFIC.cooldownUntil=0;
   let calls=0;
   modelSyncFetch=async url=>{
    if(url!=='/api/model-trades/commit-purchase')throw Error('UNEXPECTED_PURCHASE_ENDPOINT');
    calls++;
    return {ok:true,tradePersisted:true,applied:false,tradeId:op.id};
   };
   await commitPendingPurchasesFirst();
   const partial={queued:HOLDINGS_PENDING_TRADES.length,dirty:MODEL_TRADES[0]._syncDirty,
    sharesUnchanged:JSON.stringify(H)===localBefore,cloudCalls:calls};
   modelSyncFetch=async url=>{
    if(url!=='/api/model-trades/commit-purchase')throw Error('UNEXPECTED_PURCHASE_ENDPOINT');
    calls++;
    return {ok:true,tradePersisted:true,applied:true,tradeId:op.id};
   };
   await commitPendingPurchasesFirst();
   const acked={queued:HOLDINGS_PENDING_TRADES.length,dirty:MODEL_TRADES[0]._syncDirty,
    sharesUnchanged:JSON.stringify(H)===localBefore,cloudCalls:calls};
   await commitPendingPurchasesFirst();
   const retry={queued:HOLDINGS_PENDING_TRADES.length,cloudCalls:calls};
   MODEL_SYNC.ready=false;
   return {partial,acked,retry};
  });
  assert.equal(purchaseSafety.partial.queued,1,'partial cloud acknowledgement must retain trade ID');
  assert.equal(purchaseSafety.partial.dirty,true);
  assert.equal(purchaseSafety.partial.sharesUnchanged,true);
  assert.equal(purchaseSafety.acked.queued,0,'complete acknowledgement removes confirmed queued trade');
  assert.equal(purchaseSafety.acked.dirty,false);
  assert.equal(purchaseSafety.acked.sharesUnchanged,true,'cloud acknowledgement must not add local shares twice');
  assert.equal(purchaseSafety.retry.cloudCalls,2,'acknowledged order must never be resubmitted');
  // Simulate cloud model-trade fetch timeout and unauthorized response.
  // The browser must retain both clean and dirty local trades and never
  // declare synchronization complete without a confirmed server response.
  const modelSyncFailures=await page.evaluate(async()=>{
   // Drain any boot-time single-flight sync before replacing its response stub.
   await syncModelTrades(false);
   const local=[
    {id:'synthetic-clean',code:'0050',shares:4,entryPrice:99,tradeType:'manual'},
    {id:'synthetic-dirty',code:'00878',shares:8,entryPrice:20,tradeType:'manual',_syncDirty:true}
   ];
   MODEL_TRADES=JSON.parse(JSON.stringify(local));
   MODEL_PENDING_DELETES=['synthetic-tombstone'];
   MODEL_SYNC.busy=false;MODEL_SYNC.ready=true;
   MODEL_SYNC.knownUnlocked=true;MODEL_SYNC.status='ready';
   const snapshot=JSON.stringify({trades:MODEL_TRADES,deletes:MODEL_PENDING_DELETES});
   modelSyncFetch=async()=>{throw Object.assign(new Error('SYNTHETIC_TIMEOUT'),{status:5033})};
   await syncModelTrades(false);
   const timeout={same:JSON.stringify({trades:MODEL_TRADES,deletes:MODEL_PENDING_DELETES})===snapshot,
    status:MODEL_SYNC.status,ready:MODEL_SYNC.ready,message:MODEL_SYNC.message};
   MODEL_SYNC.busy=false;
   modelSyncFetch=async()=>{throw Object.assign(new Error('SYNTHETIC_401'),{status:401})};
   await syncModelTrades(false);
   const unauthorized={same:JSON.stringify({trades:MODEL_TRADES,deletes:MODEL_PENDING_DELETES})===snapshot,
    status:MODEL_SYNC.status,ready:MODEL_SYNC.ready,message:MODEL_SYNC.message};
   MODEL_SYNC.busy=false;MODEL_SYNC.ready=true;MODEL_SYNC.knownUnlocked=true;
   modelSyncFetch=async()=>({ok:true,trades:null,deletedIds:null});
   await syncModelTrades(false);
   const malformed={same:JSON.stringify({trades:MODEL_TRADES,deletes:MODEL_PENDING_DELETES})===snapshot,
    status:MODEL_SYNC.status,message:MODEL_SYNC.message};
   return{timeout,unauthorized,malformed};
  });
  console.log('SYNTHETIC_MODEL_SYNC_SCENARIOS',JSON.stringify(modelSyncFailures));
  assert.equal(modelSyncFailures.timeout.same,true,'timeout preserves local clean and unsynced trade records');
  assert.equal(modelSyncFailures.timeout.status,'degraded','timeout cannot claim ready status');
  assert.match(modelSyncFailures.timeout.message,/SYNTHETIC_TIMEOUT/);
  assert.equal(modelSyncFailures.unauthorized.same,true,'401 preserves local trade IDs and tombstones');
  assert.equal(modelSyncFailures.unauthorized.status,'locked');
  assert.equal(modelSyncFailures.unauthorized.ready,false);
  assert.equal(modelSyncFailures.malformed.same,true,'malformed cloud payload cannot erase trades');
  assert.equal(modelSyncFailures.malformed.status,'degraded');
  // Cross-device reconciliation with synthetic cloud snapshots. Tombstones
  // and pending local edits take priority over clean cached trades.
  const reconciliation=await page.evaluate(async()=>{
   const mk=(id,price,extra={})=>({id,code:'0050',shares:10,entryPrice:price,tradeType:'manual',...extra});
   const run=async({local,cloud,deleted,localDeletes=[],uploadedIds=[]})=>{
    MODEL_TRADES=local.map(t=>({...t}));
    MODEL_PENDING_DELETES=[...localDeletes];
    MODEL_SYNC.busy=false;MODEL_SYNC.ready=true;MODEL_SYNC.knownUnlocked=true;
    MODEL_SYNC.status='ready';
    let reads=0,uploadRequests=[];
    const cloudMap=new Map(cloud.map(t=>[t.id,{...t}]));
    modelSyncFetch=async url=>{
     if(url!=='/api/model-trades')throw Error('UNEXPECTED_RECONCILIATION_ENDPOINT');
     reads++;
     return {ok:true,initialized:true,trades:[...cloudMap.values()],
      deletedIds:deleted,fetchedAt:new Date().toISOString()};
    };
    syncDirtyModelTrades=async()=>{
     uploadRequests=MODEL_TRADES.filter(t=>t._syncDirty).map(t=>t.id);
     for(const t of MODEL_TRADES.filter(t=>t._syncDirty)){
      if(uploadedIds.includes(t.id)){
       cloudMap.set(t.id,{...t,_syncDirty:false});
       t._syncDirty=false;
      }else throw Error('SIMULATED_UPLOAD_REJECTED');
     }
    };
    await syncModelTrades(false);
    return{trades:MODEL_TRADES.map(t=>({id:t.id,price:t.entryPrice,dirty:!!t._syncDirty})),
     pendingDeletes:[...MODEL_PENDING_DELETES],status:MODEL_SYNC.status,
     uploadRequests,reads};
   };
   const remoteWins=await run({
    local:[mk('shared',90),mk('local-only',91)],
    cloud:[mk('shared',100),mk('remote-only',102)],
    deleted:['deleted-old'],uploadedIds:['local-only']
   });
   const dirtyLocalWins=await run({
    local:[mk('shared',95,{_syncDirty:true})],
    cloud:[mk('shared',100)],
    deleted:[],uploadedIds:['shared']
   });
   const tombstones=await run({
    local:[mk('deleted-old',88,{_syncDirty:true}),mk('local-pending-delete',77)],
    cloud:[mk('deleted-old',88),mk('local-pending-delete',77)],
    deleted:['deleted-old'],localDeletes:['local-pending-delete']
   });
   return{remoteWins,dirtyLocalWins,tombstones};
  });
  assert.equal(reconciliation.remoteWins.status,'ready');
  assert.deepEqual(reconciliation.remoteWins.trades.map(t=>t.id).sort(),
   ['local-only','remote-only','shared']);
  assert.equal(reconciliation.remoteWins.trades.find(t=>t.id==='shared').price,100,
   'newer cloud value should replace clean local cache');
  assert.equal(reconciliation.remoteWins.trades.find(t=>t.id==='local-only').dirty,false);
  assert.deepEqual(reconciliation.remoteWins.uploadRequests,['local-only'],
   'local-only trade should be repaired to cloud exactly once');
  assert.equal(reconciliation.dirtyLocalWins.status,'ready');
  assert.equal(reconciliation.dirtyLocalWins.trades.find(t=>t.id==='shared').price,95,
   'dirty local edit must overwrite earlier cloud revision once acknowledged');
  assert.deepEqual(reconciliation.dirtyLocalWins.uploadRequests,['shared']);
  assert.equal(reconciliation.tombstones.trades.length,0,
   'cloud and pending local tombstones must never resurrect deleted trades');
  assert.deepEqual(reconciliation.tombstones.pendingDeletes,['local-pending-delete'],
   'unacknowledged local deletion must remain queued');
  // Read-after-write lag: an acknowledged import must not disappear if the
  // second cloud GET returns an older snapshot. Reconciliation waits for proof.
  const staleReadback=await page.evaluate(async()=>{
   const onlyLocal={id:'synthetic-lag-1',code:'0050',shares:7,entryPrice:88,tradeType:'manual',_syncDirty:true};
   MODEL_TRADES=[{...onlyLocal}];MODEL_PENDING_DELETES=[];
   MODEL_SYNC.busy=false;MODEL_SYNC.ready=true;MODEL_SYNC.knownUnlocked=true;MODEL_SYNC.status='ready';
   let read=0,uploads=0,cloudVisible=false;
   modelSyncFetch=async url=>{
    if(url!=='/api/model-trades')throw Error('UNEXPECTED_READBACK_ENDPOINT');
    read++;
    return {ok:true,initialized:true,trades:cloudVisible?[{...onlyLocal,_syncDirty:false}]:[],
     deletedIds:[],fetchedAt:new Date().toISOString()};
   };
   syncDirtyModelTrades=async()=>{
    uploads++;
    for(const t of MODEL_TRADES)if(t._syncDirty)t._syncDirty=false;
   };
   await syncModelTrades(false);
   const lag={status:MODEL_SYNC.status,message:MODEL_SYNC.message,
    trades:MODEL_TRADES.map(t=>({id:t.id,dirty:!!t._syncDirty})),read,uploads};
   cloudVisible=true;
   await syncModelTrades(false);
   const recovered={status:MODEL_SYNC.status,
    trades:MODEL_TRADES.map(t=>({id:t.id,dirty:!!t._syncDirty})),read,uploads};
   return{lag,recovered};
  });
  assert.equal(staleReadback.lag.status,'degraded');
  assert.deepEqual(staleReadback.lag.trades,[{id:'synthetic-lag-1',dirty:true}],
   'lagging cloud GET must keep local trade queued, not drop it');
  assert.match(staleReadback.lag.message,/尚未在雲端回讀確認/);
  assert.equal(staleReadback.recovered.status,'ready');
  assert.deepEqual(staleReadback.recovered.trades,[{id:'synthetic-lag-1',dirty:false}],
   'matching cloud readback confirms local trade without duplication');
  // Model and account APIs are intentionally offline. Startup must degrade,
  // rather than causing uncaught JavaScript exceptions or writing trades.
  assert.deepEqual(errors,[],'Uncaught browser runtime errors: '+errors.join('\n'));
  process.stdout.write(JSON.stringify({result:'PASS',kind:'isolated Chromium front-end boot',...ui})+'\n');
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1}).finally(()=>server.close());
