'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const net=require('node:net');
const path=require('node:path');

test('real HTTP server starts, serves current assets and reports unconfigured sync honestly',async()=>{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',MODEL_SYNC_KEY:''},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 try{
  const deadline=Date.now()+3000;while(!logs.includes('listening on')&&Date.now()<deadline){if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,20))}
  assert.match(logs,/listening on/);
  const base='http://127.0.0.1:'+port;
  const results=await Promise.all(['/health','/','/app.js','/styles.css','/manifest.json','/sw.js','/api/model-sync/status','/api/model-trades','/api/holdings-sync','/api/dividend-auto'].map(async p=>{const r=await fetch(base+p);return{p,status:r.status,body:await r.text(),cache:r.headers.get('cache-control')}}));
  for(const result of results){
   const privateAPI=['/api/model-trades','/api/holdings-sync','/api/dividend-auto'].includes(result.p);assert.equal(result.status,privateAPI?503:200,result.p);
   if(privateAPI)assert.equal(JSON.parse(result.body).ok,false);
  }
  assert.equal(JSON.parse(results[0].body).build,'16.8.101-SYNC-RELIABILITY');assert.match(results[1].body,/16\.8\.101 同步修正版/);assert.match(results[2].body,/16\.8\.101-SYNC-RELIABILITY/);assert.match(results[2].cache,/no-store/);assert.equal(JSON.parse(results[6].body).configured,false);
 }finally{child.kill('SIGTERM');await once(child,'exit')}
});
