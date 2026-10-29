'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function section(source, from, to) {
 const start=source.indexOf(from);
 const end=source.indexOf(to,start+from.length);
 assert.ok(start>=0&&end>start, 'expected function boundaries present');
 return source.slice(start,end);
}

test('upserting an already applied, non-deleted trade never triggers holdings reversal',async()=>{
 const source=section(server,'async function cloudUpsertTrade(input){','\nasync function cloudUpsertTradesBatch');
 let writes=0,reversals=0,meta=0;
 const id='mt_1792374954817_ro733';
 const existing={id,code:'0056',updated_at:'2026-10-22T00:00:00Z',payload:{id,code:'0056',entryAt:'2026-10-19T01:55:54Z',shares:30,entryPrice:57.65,_syncUpdatedAt:'2026-10-22T00:00:00Z'}};
 const ctx={
  cloudRowsById:async()=>[existing],
  tradeSyncStamp:x=>x?._syncUpdatedAt||x?.entryAt||'1970-01-01T00:00:00Z',
  conditionalCloudTradeWrite:async()=>{writes++;return true;},
  ensureModelSyncMeta:async()=>{meta++;},
  reverseAppliedHoldingsTrade:async()=>{reversals++;throw Error('normal trade cannot be reversed');}
 };
 const run=new Function('d','const {cloudRowsById,tradeSyncStamp,conditionalCloudTradeWrite,ensureModelSyncMeta,reverseAppliedHoldingsTrade}=d;'+source+';return cloudUpsertTrade')(ctx);
 const result=await run({...existing.payload,_syncUpdatedAt:'2026-10-29T09:00:00Z',perf:{netPnL:5}});
 assert.equal(result.ok,true);assert.equal(writes,1);assert.equal(reversals,0);assert.equal(meta,0);
});

test('pending purchases upload before historical trade-performance revisions',async()=>{
 const source=section(client,'async function syncDirtyModelTrades(){','\nasync function syncModelTrades(');
 const incoming=['mt_1793000000001_buy1','mt_1793000000002_buy2','mt_1793000000003_buy3'];
 const trades=[...Array.from({length:22},(_,i)=>({id:'mt_1790000000000_old'+i,entryAt:'2026-10-01T00:00:00Z',_syncDirty:true})),...incoming.map(id=>({id,entryAt:'2026-10-29T00:00:00Z',_syncDirty:true}))];
 let uploaded=[];
 const deps={MODEL_TRADES:trades,MODEL_PENDING_DELETES:[],MODEL_SYNC:{ready:true},HOLDINGS_PENDING_TRADES:incoming.map(id=>({id})),
  modelSyncFetch:async(url,opt)=>{if(url==='/api/model-trades/import')uploaded=JSON.parse(opt.body).trades.map(t=>t.id);return {ok:true};},
  modelTradeClean:t=>{const x={...t};delete x._syncDirty;return x;},modelSyncSaveLocal:()=>{}};
 const run=new Function('d','const {MODEL_TRADES,MODEL_PENDING_DELETES,MODEL_SYNC,HOLDINGS_PENDING_TRADES,modelSyncFetch,modelTradeClean,modelSyncSaveLocal}=d;'+source+';return syncDirtyModelTrades')(deps);
 await run();
 assert.equal(uploaded.length,3);
 for(const id of incoming)assert.ok(uploaded.includes(id));
 assert.equal(trades.filter(t=>t._syncDirty).length,22);
});

test('new holdings operation requires persisted, exact matching trade',async()=>{
 const source=section(server,'async function cloudApplyHoldingsTrade(trade){','\n\n\nfunction commentarySession(');
 const id='mt_1793000000001_buy1',buy={id,code:'0050',shares:20,entryPrice:107.5};
 const baseline={holdings:[{t:'0050',s:3480,c:80.47}],appliedTradeIds:[]};
 for(const record of [null,{...buy,entryPrice:108.5},buy]){
  let writes=0,current=JSON.parse(JSON.stringify(baseline));
  const deps={ETF:['0050'],HOLDINGS_SYNC_ID:'__HOLDINGS_STATE__',cloudRowsById:async key=>key==='__HOLDINGS_STATE__'?[{payload:current}]:record?[{payload:record}]:[],
   cleanHoldingsInput:a=>JSON.parse(JSON.stringify(a)),conditionalCloudHoldingsWrite:async(_row,holdings,ids)=>{writes++;current.holdings=holdings;current.appliedTradeIds=ids;return {ok:true};},
   recordDividendHoldingsSnapshot:async()=>{},ymdTaipei:()=> '2026-10-29'};
  const run=new Function('d','const {ETF,HOLDINGS_SYNC_ID,cloudRowsById,cleanHoldingsInput,conditionalCloudHoldingsWrite,recordDividendHoldingsSnapshot,ymdTaipei}=d;'+source+';return cloudApplyHoldingsTrade')(deps);
  if(record===buy){const result=await run(buy);assert.equal(result.applied,true);assert.equal(writes,1);assert.equal(current.holdings[0].s,3500);}
  else{await assert.rejects(run(buy),/缺少相符且有效/);assert.equal(writes,0);assert.equal(current.holdings[0].s,3480);}
 }
});

test('overlapping sync requests queue a new pass',async()=>{
 const source=section(client,'async function syncAllCloud(force=false){','\n\nasync function connectModelSync(');
 let calls=0,holds=0,release;
 const block=new Promise(resolve=>{release=resolve;});
 const ctx={document:{visibilityState:'visible'},SYNC_ALL_BUSY:false,SYNC_ALL_RERUN:false,SYNC_ALL_FORCE:false,MODEL_SYNC:{ready:true,status:'ready'},API_TRAFFIC:{cooldownUntil:0},HOLDINGS_PENDING_TRADES:[],
  commitPendingPurchasesFirst:async()=>{},syncModelTrades:async()=>{calls++;if(calls===1)await block;},syncHoldingsCloud:async()=>{holds++;},loadDividendAuto:async()=>{},renderModelTrades:()=>{},setTimeout:cb=>cb()};
 const run=new Function('ctx','with(ctx){'+source+';return syncAllCloud;}')(ctx);
 const first=run(false),second=run(true);release();await Promise.all([first,second]);
 assert.equal(calls,2);assert.equal(holds,2);
});

test('recovery commits at most two new purchases directly before background sync',async()=>{
 const source=section(client,'async function commitPendingPurchasesFirst(){','\nasync function flushPendingHoldingsTrades(){');
 const pending=[
  {id:'mt_1793000000001_buy1',code:'0050',shares:20,entryPrice:108},
  {id:'mt_1793000000002_buy2',code:'00878',shares:20,entryPrice:35.28},
  {id:'mt_1793000000003_buy3',code:'0056',shares:50,entryPrice:56.30}
 ];
 const originals=pending.map(x=>({...x,_syncDirty:true}));
 let calls=[],durable=0,revisions=0;
 const deps={HOLDINGS_OP_BUSY:false,HOLDINGS_PUSH_BUSY:false,HOLDINGS_PENDING_TRADES:pending,
  MODEL_SYNC:{knownUnlocked:true,ready:false,status:'degraded'},API_TRAFFIC:{cooldownUntil:0},
  MODEL_TRADES:originals,HOLDINGS_SYNC:{},HOLDINGS_REMOTE_REV:0,
  modelTradeClean:t=>{const x={...t};delete x._syncDirty;return x;},
  modelSyncFetch:async(url,opts)=>{assert.equal(url,'/api/model-trades/commit-purchase');const t=JSON.parse(opts.body).trade;calls.push(t.id);return {ok:true,tradePersisted:true,applied:true,tradeId:t.id};},
  persistPendingHoldingsOps:()=>{durable++;},modelSyncSaveLocal:()=>{revisions++;},renderModelTrades:()=>{}};
 const run=new Function('d','with(d){'+source+';return commitPendingPurchasesFirst;}')(deps);
 await run();
 assert.equal(calls.length,2);assert.equal(deps.HOLDINGS_PENDING_TRADES.length,1);
 assert.equal(durable,2);assert.equal(revisions,2);
 assert.equal(originals.filter(t=>t._syncDirty).length,1);
 await run();assert.equal(calls.length,3);
 assert.equal(deps.HOLDINGS_PENDING_TRADES.length,0);
 assert.equal(deps.HOLDINGS_REMOTE_REV,3);
});

test('429 or failed purchase response never clears pending holdings or transaction dirty flag',async()=>{
 const source=section(client,'async function commitPendingPurchasesFirst(){','\nasync function flushPendingHoldingsTrades(){');
 const op={id:'mt_1793000000001_buy1',code:'0050',shares:20,entryPrice:108};
 const trade={...op,_syncDirty:true};
 let durable=0;
 const deps={HOLDINGS_OP_BUSY:false,HOLDINGS_PUSH_BUSY:false,HOLDINGS_PENDING_TRADES:[op],
  MODEL_SYNC:{knownUnlocked:true,ready:false,status:'degraded'},API_TRAFFIC:{cooldownUntil:0},
  MODEL_TRADES:[trade],HOLDINGS_SYNC:{},HOLDINGS_REMOTE_REV:0,
  modelTradeClean:t=>{const x={...t};delete x._syncDirty;return x;},
  modelSyncFetch:async()=>{const e=Error('API限流');e.status=429;throw e;},
  persistPendingHoldingsOps:()=>{durable++;},modelSyncSaveLocal:()=>{},renderModelTrades:()=>{}};
 const run=new Function('d','with(d){'+source+';return commitPendingPurchasesFirst;}')(deps);
 await run();
 assert.equal(deps.HOLDINGS_PENDING_TRADES.length,1);
 assert.equal(trade._syncDirty,true);assert.equal(durable,0);assert.equal(deps.HOLDINGS_REMOTE_REV,0);
 assert.match(deps.HOLDINGS_SYNC.message,/已保留本機持股/);
});

test('deletion reversal is not referenced from ordinary upsert and builds match',()=>{
 const upsert=section(server,'async function cloudUpsertTrade(input){','\nasync function cloudUpsertTradesBatch(');
 assert.equal(upsert.includes('reverseAppliedHoldingsTrade('),false);
 assert.ok(server.includes("'/api/model-trades/commit-purchase'"));
 const serverBuild=server.match(/const BUILD='([^']+)'/)?.[1],clientBuild=client.match(/CLIENT_BUILD='([^']+)'/)?.[1];
 assert.equal(serverBuild,clientBuild);
});
