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
     home:home.map(n=>({text:n.innerText,disabled:n.querySelector('button[onclick*="openModelTrade"]')?.disabled})),
     details:details.map(n=>({text:n.innerText,disabled:n.querySelector('button[onclick*="openModelTrade"]')?.disabled}))
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
  assert.equal(cases.eligible.home[0].disabled,false,'fresh eligible quote must enable model buy in home');
  assert.equal(cases.eligible.details[0].disabled,false,'fresh eligible quote must enable model buy in detail');
  assert.equal(cases.backup.home[0].disabled,true,'last-good fallback must disable model buy');
  assert.equal(cases.backup.details[0].disabled,true);
  assert.match(cases.backup.home[0].text,/最後有效報價/);
  assert.match(cases.backup.details[0].text,/最後有效報價/);
  assert.equal(cases.veto.home[0].disabled,true,'hard Gate must disable model buy');
  assert.equal(cases.veto.details[0].disabled,true);
  assert.match(cases.veto.home[0].text,/synthetic Gate/);
  assert.equal(cases.below.home[0].disabled,true,'below frozen execution band cannot be model buy');
  assert.equal(cases.below.details[0].disabled,true);
  assert.match(cases.below.home[0].text,/低於首次確認執行下限/);
  // Model and account APIs are intentionally offline. Startup must degrade,
  // rather than causing uncaught JavaScript exceptions or writing trades.
  assert.deepEqual(errors,[],'Uncaught browser runtime errors: '+errors.join('\n'));
  process.stdout.write(JSON.stringify({result:'PASS',kind:'isolated Chromium front-end boot',...ui})+'\n');
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1}).finally(()=>server.close());
