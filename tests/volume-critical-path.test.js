'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const s=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function part(a,b){const i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert.ok(i>=0&&j>i);return s.slice(i,j)}
test('official buy-model must never synchronously wait for MIS/Yahoo volume fallbacks',()=>{
 const buy=part('async function buyModel(){','/* ---------- ETF strong-add / trend model v2');
 assert.match(buy,/applyRecentBackgroundVolume\(etfLd\);/);
 assert.doesNotMatch(buy,/await ensureEtfQuoteVolumes\(/);
 assert.match(s,/const VOLUME_BACKFILL=\{day:null,at:0,byCode:\{\},pending:null\}/);
});
test('supplemental volume backfill must use detached quotes and never overwrite live open/high/low',async()=>{
 let resolveSource,sourceCalls=0,sourceSnapshot=null;
 const pending=new Promise(resolve=>resolveSource=resolve);
 const ctx={
  ETF:['0050','0056','00878','00919'],Date,Number,Object,Promise,
  ymdTaipei:()=> '2026-10-16',
  ensureEtfQuoteVolumes:async snapshot=>{sourceCalls++;sourceSnapshot=snapshot;await pending;
    snapshot.quotes['0050'].volume=125000;
    snapshot.quotes['0050'].volumeSource='TWSE MIS';
    snapshot.quotes['0050'].open=888;
    return snapshot;}
 };
 vm.runInNewContext(part('const VOLUME_BACKFILL=','function volumeShadowSignal('),ctx);
 const original={quotes:{
  '0050':{last:109,open:109.6,high:110,low:108.7,volume:0},
  '0056':{last:58,open:59,volume:9}
 }};
 const immediate=ctx.applyRecentBackgroundVolume(original);
 assert.equal(immediate,original);
 assert.equal(sourceCalls,1);
 assert.equal(original.quotes['0050'].volume,0);
 assert.equal(original.quotes['0050'].open,109.6);
 assert.notEqual(sourceSnapshot.quotes['0050'],original.quotes['0050']);
 const again=ctx.applyRecentBackgroundVolume(original);
 assert.equal(again,original);
 assert.equal(sourceCalls,1,'single pending backfill only');
 resolveSource();
 await new Promise(resolve=>setImmediate(resolve));
 const later={quotes:{'0050':{last:109.1,open:109.7,high:110.3,low:108.9,volume:0}}};
 ctx.applyRecentBackgroundVolume(later);
 assert.equal(later.quotes['0050'].volume,125000);
 assert.equal(later.quotes['0050'].open,109.7,'historical backup open may NEVER contaminate live A');
 assert.match(later.quotes['0050'].volumeSource,/背景補量/);
});
test('failed volume background task cannot block buy-model or poison next request',async()=>{
 const ctx={ETF:['0050'],Date,Number,Object,Promise,
  ymdTaipei:()=> '2026-10-16',
  ensureEtfQuoteVolumes:async()=>{throw Error('upstream throttle')}};
 vm.runInNewContext(part('const VOLUME_BACKFILL=','function volumeShadowSignal('),ctx);
 const r={quotes:{'0050':{last:100,volume:0}}};
 assert.equal(ctx.applyRecentBackgroundVolume(r),r);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.quotes['0050'].last,100);
});
