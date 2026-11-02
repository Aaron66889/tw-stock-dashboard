'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

const start=app.indexOf('function center(z)'),end=app.indexOf('function executionUpAllowance(',start);
if(start<0||end<start)throw Error('cash open cap source missing');
const source=app.slice(start,end);

function client({day='2026-11-02',modelDay='2026-11-02',liveOpen=null,modelOpen=null,weekday=1,minute=15*60+42}={}){
 const codes=['0050','0056','00878','00919'];
 const quotes=Object.fromEntries(codes.map(code=>[code,{date:day,last:104.10,open:liveOpen}]));
 const models=Object.fromEntries(codes.map(code=>[code,{
  firstLayerCalibration:{sessionOpenPolicy:{active:modelOpen>0,sessionOpen:modelOpen}}
 }]));
 const fetchDay=modelDay+'T07:41:30.000Z';
 const ctx={lastLive:{quotes},lastBuy:{fetchedAt:fetchDay,models},Date,Intl,JSON,Number,Math,
  dayKey:()=>day,taipeiNow:()=>new Date(2026,10,weekday===1?2:7,Math.floor(minute/60),minute%60)};
 return vm.runInNewContext(source+'\n({cashSessionOpen,enforceCashOpenCeiling})',ctx);
}
function zones(){
 return[{low:106.02,high:106.36,center:106.19},
 {low:103.97,high:104.30,center:104.135},
 {low:103.08,high:103.41,center:103.245}];
}

test('Nov 2 15:42 screenshot: fast ETF feed omits open, official model knows 105; L1 clamps immediately',()=>{
 const c=client({modelOpen:105});
 for(const code of ['0050','0056','00878','00919']){
  assert.equal(c.cashSessionOpen(code),105);
  const z=c.enforceCashOpenCeiling(code,zones(),2);
  assert.equal(z[0].high,105,'L1 high must never exceed known cash open for '+code);
  assert.ok(z[0].low<105&&z[1].high<z[0].high&&z[2].high<z[1].high);
 }
});

test('two valid session opens disagree: stricter opening ceiling wins',()=>{
 const c=client({liveOpen:104.9,modelOpen:105});
 assert.equal(c.cashSessionOpen('0050'),104.9);
 assert.equal(c.enforceCashOpenCeiling('0050',zones(),2)[0].high,104.9);
});

test('same-day live open works without official model open, but previous-day model never does',()=>{
 assert.equal(client({liveOpen:105,modelOpen:null}).cashSessionOpen('0050'),105);
 const old=client({modelDay:'2026-10-30',modelOpen:105,liveOpen:null});
 assert.equal(old.cashSessionOpen('0050'),null);
});

test('all ETF open caps remain inactive before 09:00 and on weekend',()=>{
 assert.equal(client({modelOpen:105,minute:8*60+59}).cashSessionOpen('0050'),null);
 assert.equal(client({modelOpen:105,weekday:6}).cashSessionOpen('0050'),null);
});

test('server fetches and validates the actual open after cash close, not only while trading',()=>{
 assert.match(server,/const openRequiredToday=twAfterCashOpenNow\(\)/);
 assert.match(server,/const needMis=ETF\.filter\([^;\n]+openRequiredToday&&!verifiedEtfOpen\(c,today\)/);
 assert.match(server,/if\(openRequiredToday\)\{\s*const needOpen=ETF\.filter/);
 assert.match(server,/const openRequired=openRequiredToday,now=Date\.now\(\)/);
 assert.match(server,/openRequired=twAfterCashOpenNow\(\)/);
 assert.match(server,/const openRefMissing=cashOpenCapActive&&!\(sessionOpen>0\)/);
 assert.match(server,/const stale=!fresh\|\|openRefMissing/);
 assert.match(server,/當日開盤價尚未確認，第一層不得高於開盤價/);
});

test('one valid same-day open caps L1 but does not raise a lower statistical target',()=>{
 const c=client({modelOpen:105});
 const lower=[{low:102.8,high:103.3,center:103.05},
 {low:101.4,high:101.7,center:101.55},
 {low:100.3,high:100.5,center:100.4}];
 const z=c.enforceCashOpenCeiling('0050',lower,2);
 assert.equal(z[0].high,103.3);
 assert.equal(z[1].high,101.7);
});
