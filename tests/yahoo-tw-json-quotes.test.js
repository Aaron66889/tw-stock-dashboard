'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function fnSource(){const a=server.indexOf('const YAHOO_TW_BATCH_CACHE='),b=server.indexOf('function preferYahooTwEtfQuote',a);
 assert.ok(a>=0&&b>a);return server.slice(a,b)}
function fixture(prices,baseTime=Date.now()){
 return {data:prices.map((p,i)=>({symbol:['0050.TW','0056.TW','00878.TW','00919.TW'][i],
  chart:{timestamp:[Math.floor(baseTime/1000)],indicators:{quote:[{close:[p]}]},meta:{previousClose:p+1}}}))};
}
function run(data,market=false){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const env={ETF:['0050','0056','00878','00919'],
  Date,META:{'0050':{name:'0050'}},
  ymdTaipei:d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d||new Date()),
  deadline:async p=>p,getJSONQuick:async()=>data,twMarketOpenNow:()=>market,
  n:x=>Number.isFinite(Number(x))?Number(x):null};
 const fn=new Function('d','const {ETF,Date,META,ymdTaipei,deadline,getJSONQuick,twMarketOpenNow,n}=d;'+fnSource()+';return yahooTaiwanJsonQuoteBatch;')(env);
 return fn(today);
}
test('four correctly identified current-session vendor quotes are admitted',async()=>{
 const out=await run(fixture([97.15,51.55,33.03,31.19]));
 assert.deepEqual(Object.keys(out).sort(),['0050','0056','00878','00919']);
 assert.equal(out['0050'].last,97.15);
 assert.equal(out['00919'].last,31.19);
 assert.equal(out['0050'].quoteTimeVerified,true);
});
test('prior-day Yahoo tick cannot become official current price',async()=>{
 const out=await run(fixture([97.15,51.55,33.03,31.19],Date.now()-86400000));
 assert.deepEqual(out,{});
});
test('intraday Yahoo tick older than 90 seconds rejected',async()=>{
 const out=await run(fixture([97.15,51.55,33.03,31.19],Date.now()-180000),true);
 assert.deepEqual(out,{});
});
test('unknown symbol or missing current quote cannot be mapped to wrong ETF',async()=>{
 const d=fixture([97.15,51.55,33.03,31.19]);
 d.data[0].symbol='UNKNOWN.TW';d.data[1].chart.indicators.quote[0].close=[null];
 const out=await run(d);
 assert.equal(out['0050'],undefined);
 assert.equal(out['0056'],undefined);
 assert.equal(out['00878'].last,33.03);
});
test('bad Yahoo payload fails safely without removing Anue fallback',async()=>{
 const out=await run({error:'blocked'});
 assert.deepEqual(out,{});
 assert.match(server,/const yahooBatchPromise=yahooTaiwanJsonQuoteBatch\(today\)/);
 assert.match(server,/if\(y\)preferYahooTwEtfQuote\(quotes,code,y,today\)/);
});
