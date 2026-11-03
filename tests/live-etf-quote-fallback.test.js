'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const client=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
function extract(source,startMark,endMark){
 const a=source.indexOf(startMark),b=source.indexOf(endMark,a+startMark.length);
 assert.ok(a>=0&&b>a,'source boundaries must exist');
 return source.slice(a,b);
}
const LIVE=extract(server,'async function liveEtf4(){','\nfunction anueField(');
const ETFs=['0050','0056','00878','00919'],TODAY='2026-11-03';
function setup({stale=false,allPrimary=false,opensVerified=false}={}){
 const opens={},calls=[],ticker={
 '0050':{last:104.1,prevClose:104.1,open:104.1},
 '0056':{last:56.9,prevClose:57.2,open:57.1},
 '00878':{last:35.3,prevClose:35.65,open:35.6},
 '00919':{last:31.2,prevClose:31.3,open:31.4}
 },time=stale?'2026-11-02T01:02:00Z':'2026-11-03T01:02:00Z';
 if(opensVerified)for(const c of ETFs)opens[c]={day:TODAY,price:ticker[c].open,source:'persisted current-day open'};
 const d={ETF:ETFs,
  ymdTaipei:date=>date?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date):TODAY,
  twseExRightReferences:async()=>({ok:true,map:{}}),
  deadline:async(prom,_ms,fallback)=>{try{return await prom}catch{return fallback}},
  getJSONQuick:async()=>({data:(allPrimary?ETFs:['0050']).map(c=>({'200010':c,'200026':ticker[c].last,'200031':ticker[c].prevClose,'200032':ticker[c].open}))}),
  n:x=>{const v=Number(x);return Number.isFinite(v)&&v>0?v:null;},
  twAfterCashOpenNow:()=>true,twMarketOpenNow:()=>true,
  verifiedEtfOpen:(c,day)=>opens[c]?.day===day?opens[c]:null,
  storeVerifiedEtfOpen:(c,day,price,source)=>{opens[c]={day,price,source};},
  mis:async()=>({msgArray:[]}),parseMis:()=>({}),
  officialQuoteDay:()=>TODAY,twseDailyAll:async()=>({map:{}}),
  yahooTwOne:async c=>{calls.push(c);return {...ticker[c],ticker:c,time,source:'Yahoo Finance 1m fallback'};},
  verifiedYahooOpenBackup:async c=>{calls.push(c);return {...ticker[c],ticker:c,time,source:'Yahoo Finance 1m fallback'};},
  applyEtfEffectiveReferences:()=>{},
  etfQuoteComplete:(q,needOpen)=>!!(Number(q?.last)>0&&Number(q?.prevClose)>0&&(!needOpen||(Number(q.open)>0&&q.openVerified===true))),
  ETF_QUOTE_LAST_GOOD:{}
 };
 const run=new Function('d','const {ETF,ymdTaipei,twseExRightReferences,deadline,getJSONQuick,n,twAfterCashOpenNow,twMarketOpenNow,verifiedEtfOpen,storeVerifiedEtfOpen,mis,parseMis,officialQuoteDay,twseDailyAll,yahooTwOne,verifiedYahooOpenBackup,applyEtfEffectiveReferences,etfQuoteComplete,ETF_QUOTE_LAST_GOOD}=d;'+LIVE+';return liveEtf4;')(d);
 return {run,opens,calls,ticker};
}
test('anue only returns 0050: independently dated fallback restores the other three without overwriting 0050',async()=>{
 const c=setup(),r=await c.run();
 assert.equal(r.ok,true);assert.deepEqual(r.incomplete,[]);
 assert.equal(r.quotes['0050'].source,'Anue 鉅亨');
 for(const code of ETFs){assert.ok(r.quotes[code].last>0);assert.equal(r.quotes[code].openVerified,true);}
 for(const code of ETFs.slice(1))assert.match(r.quotes[code].source,/Yahoo/);
 assert.equal(c.calls.length,4);
});
test('stale Yahoo data is rejected and does not enable model execution',async()=>{
 const c=setup({stale:true}),r=await c.run();
 assert.equal(r.ok,false);assert.ok(r.incomplete.length>0);
 for(const code of ETFs.slice(1))assert.equal(r.quotes[code],undefined);
 assert.ok(ETFs.some(code=>!r.quotes[code]?.openVerified));
});
test('valid primary prices are never overwritten by Yahoo open fill',async()=>{
 const c=setup({allPrimary:true}),r=await c.run();
 assert.equal(r.ok,true);assert.equal(r.quotes['0050'].last,c.ticker['0050'].last);
 for(const code of ETFs)assert.equal(r.quotes[code].source,'Anue 鉅亨');
});
test('missing individual models show an explicit non-trading error rather than loading forever',()=>{
 assert.match(client,/正式模型暫停，等待資料恢復/);
 assert.match(client,/不以舊價冒充當日買點/);
});

test('cold-start backup requests begin before waiting on slow primary feeds',async()=>{
 const c=setup();
 const response=c.run();
 assert.equal(c.calls.length,4,'start four dated backups immediately; do not wait for Anue/MIS timeouts');
 const r=await response;
 assert.equal(r.ok,true);
 assert.equal(r.incomplete.length,0);
});

test('real Yahoo parser uses same-day intraday opening even when metadata last-trade timestamp is yesterday',async()=>{
 const parser=extract(server,'async function yahooTwOne(code,isIndex=false){','\n// Keep verified CASH');
 const first=Math.floor(Date.parse('2026-11-03T01:00:00Z')/1000),second=first+60,old=Math.floor(Date.parse('2026-11-02T05:30:00Z')/1000);
 const api={chart:{result:[{timestamp:[first,second],meta:{
  regularMarketTime:old,regularMarketPrice:102,regularMarketOpen:102,
  chartPreviousClose:104.3,regularMarketDayHigh:103},
  indicators:{quote:[{open:[103,103.1],close:[103.1,103.2],high:[103.3,103.4],low:[102.9,103]}]}}]}};
 const d={META:{'0050':{name:'元大台灣50'}},
  ymdTaipei:date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date||new Date('2026-11-03T01:08:00Z')),
  getJSONQuick:async()=>api,n:x=>Number.isFinite(Number(x))&&Number(x)>0?Number(x):null};
 const run=new Function('d','const {META,ymdTaipei,getJSONQuick,n}=d;'+parser+';return yahooTwOne;')(d);
 const q=await run('0050');
 assert.equal(q.open,103);
 assert.equal(q.last,103.2);
 assert.equal(q.date,'2026-11-03');
 assert.equal(q.openSource,'Yahoo Finance 首根當日盤中1m K');
 assert.equal(q.prevClose,104.3);
});
test('Yahoo parser refuses prior-day-only candles even when metadata advertises a price',async()=>{
 const parser=extract(server,'async function yahooTwOne(code,isIndex=false){','\n// Keep verified CASH');
 const prior=Math.floor(Date.parse('2026-11-02T01:00:00Z')/1000);
 const api={chart:{result:[{timestamp:[prior],meta:{
  regularMarketTime:prior,regularMarketPrice:105,regularMarketOpen:105,chartPreviousClose:106},
  indicators:{quote:[{open:[105],close:[105.1],high:[105.2],low:[104.8]}]}}]}};
 const d={META:{'0050':{name:'元大台灣50'}},
  ymdTaipei:date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date||new Date('2026-11-03T01:08:00Z')),
  getJSONQuick:async()=>api,n:x=>Number.isFinite(Number(x))&&Number(x)>0?Number(x):null};
 const run=new Function('d','const {META,ymdTaipei,getJSONQuick,n}=d;'+parser+';return yahooTwOne;')(d);
 await assert.rejects(run('0050'),/no current-session price/);
});

test('already-verified opening prices never trigger redundant Yahoo prewarm for valid live quotes',async()=>{
 const c=setup({allPrimary:true,opensVerified:true}),r=await c.run();
 assert.equal(r.ok,true);
 assert.equal(c.calls.length,0,'persisted daily opens must avoid all Yahoo backup requests');
 for(const code of ETFs)assert.equal(r.quotes[code].openVerified,true);
});
test('with openings restored, only a missing primary quote triggers on-demand Yahoo',async()=>{
 const c=setup({opensVerified:true}),r=await c.run();
 assert.equal(r.ok,true);
 assert.equal(c.calls.length,3,'only three absent primary quotes need Yahoo backups');
 assert.ok(!c.calls.includes('0050'));
 for(const code of ETFs)assert.ok(r.quotes[code].last>0);
});
