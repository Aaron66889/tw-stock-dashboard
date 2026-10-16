'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const text=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const between=(first,last)=>{const a=text.indexOf(first),b=text.indexOf(last,a+first.length);assert.ok(a>=0&&b>a);return text.slice(a,b)};
test('research OOS Shadow calibration never runs synchronously inside official buyModel request',()=>{
 const live=between('async function buyModel(){','/* ---------- ETF strong-add / trend model v2');
 assert.doesNotMatch(live,/shadowPolicyCalibration\(/);
 assert.match(live,/models\[c\]=modelOne\(c,/);
 assert.match(live,/SHADOW_POLICY_CACHE\.get\(pkey\)/);
 assert.match(live,/source:'shadow-oos-warming'/);
 assert.match(live,/shadowModels\[c\]=sr/);
 assert.match(live,/researchGateAudit/);
});
test('Shadow heavy calibration only permitted outside cash/pre-open window',()=>{
 const source=between('function shadowWarmWindow(clock=taipeiClock()){','async function warmShadowPolicyOffHours(){');
 const ctx={taipeiClock:()=>({weekday:'Fri',h:9,m:28}),Number};
 vm.runInNewContext(source,ctx);
 for(const h of [8,9,10,11,12,13]){
  assert.equal(ctx.shadowWarmWindow({weekday:'Fri',h,m:20}),false);
 }
 assert.equal(ctx.shadowWarmWindow({weekday:'Fri',h:14,m:9}),false);
 assert.equal(ctx.shadowWarmWindow({weekday:'Fri',h:14,m:10}),true);
 assert.equal(ctx.shadowWarmWindow({weekday:'Fri',h:7,m:40}),true);
 assert.equal(ctx.shadowWarmWindow({weekday:'Sat',h:10,m:30}),true);
});
test('background calibration is rate-limited, never awaited by model page, and does not alter official hard Gate',()=>{
 const backend=between('async function warmShadowPolicyOffHours(){','function shadowCriticalGate(');
 assert.match(backend,/SHADOW_WARM_BUSY\|\|!shadowWarmWindow\(\)\|\|RUNTIME\.refreshing/);
 assert.match(backend,/SHADOW_POLICY_CACHE\.has\(key\)/);
 assert.match(backend,/shadowPolicyCalibration\(code,rows\)/);
 assert.match(text,/setInterval\(warmShadowPolicyOffHours,4\*60\*1000\)/);
 assert.match(text,/const knife=\(/);
 assert.match(text,/if\(hardVeto\)score=Math\.min\(score,42\)/);
});
