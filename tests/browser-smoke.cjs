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
  // Model and account APIs are intentionally offline. Startup must degrade,
  // rather than causing uncaught JavaScript exceptions or writing trades.
  assert.deepEqual(errors,[],'Uncaught browser runtime errors: '+errors.join('\n'));
  process.stdout.write(JSON.stringify({result:'PASS',kind:'isolated Chromium front-end boot',...ui})+'\n');
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1}).finally(()=>server.close());
