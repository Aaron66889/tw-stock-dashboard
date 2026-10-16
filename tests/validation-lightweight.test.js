'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=s.indexOf('async function validationReport(deep=false){');
const end=s.indexOf('\n\nfunction autoWarmAllHistory()',start);
const body=s.slice(start,end);
test('lightweight validation never triggers four heavy historical backtest recomputations',()=>{
 assert.ok(start>0&&end>start);
 assert.match(body,/const saved=cache\.get\(key\),b=deep\?await backtest\(c\):\(saved&&Date\.now\(\)-saved\.at<6\*60\*60\*1000\?saved\.v:null\)/);
 assert.equal((body.match(/await backtest\(c\)/g)||[]).length,1);
 assert.match(body,/if\(b\?\.ready\)/);
 assert.match(body,/out\[43\]=V\(/);
 assert.match(body,/重型歷史檢驗僅讀快取/);
});
test('historical constituent isolation is not fetched over network during default 45-lamp viewing',()=>{
 assert.match(body,/if\(deep\)\{\s*let histIsolation=null;/);
 assert.match(body,/out\[27\]=V\('WAIT','快速驗證不重新查詢歷史成分/);
 assert.equal((body.match(/await constituents\('0050'/g)||[]).length,2);
});
test('manual full validation still performs historical backtests and preserves Gate checks',()=>{
 assert.match(body,/if\(deep\)ETF\.forEach\(c=>enqueueHistory\(c,false\)\)/);
 assert.match(body,/out\[13\]=V\(/);
 assert.match(body,/out\[34\]=V\(/);
 assert.match(body,/deep\?await backtest\(c\)/);
 assert.match(s,/if\(u\.pathname==='\/api\/validation'\)return safeApi\(res,'validation',\(\)=>validationReport\(u\.searchParams\.get\('deep'\)==='1'\)\)/);
});
