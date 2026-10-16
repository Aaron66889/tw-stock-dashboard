'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const a=s.indexOf('async function buyModel(){'),b=s.indexOf('/* ---------- ETF strong-add / trend model v2',a);
const live=s.slice(a,b);
test('Shadow-only T86 and Yahoo auxiliary data never block official model more than 350ms',()=>{
 assert.match(live,/deadline\(cachedSingleFlight\('shadow-aux:inst-r1',5\*60\*1000,\(\)=>institutionalRecentWindow\(5\)\)[\s\S]*?,350,/);
 assert.match(live,/deadline\(cachedSingleFlight\('shadow-aux:volume:'\+c,10\*60\*1000,\(\)=>yahooVolumeWindow\(c\)\)[\s\S]*?,350,/);
 assert.match(live,/deadline\(cachedSingleFlight\('shadow-aux:yahoo-chip:'\+c,10\*60\*1000,\(\)=>yahooInstitutionalDirect\(c\)\)[\s\S]*?,350,/);
 assert.doesNotMatch(live,/institutionalRecentWindow\(5\)[\s\S]{0,220},7800,/);
 assert.doesNotMatch(live,/yahooVolumeWindow\(c\)[\s\S]{0,220},5500,/);
 assert.doesNotMatch(live,/yahooInstitutionalDirect\(c\)[\s\S]{0,230},5500,/);
});
test('official A model inputs and decision loops remain untouched by Shadow-only warm-ups',()=>{
 const official=live.indexOf('models[c]=modelOne(c,');
 const shadow=live.indexOf('applyShadowExperimentalFactors(sr,');
 assert.ok(official>=0&&shadow>official);
 assert.match(live,/const \[ld,etfLd,ctx,ovs,nf,harr,hhealth,instWin,volWindows,yahooChips\]=await Promise\.all/);
 assert.match(live,/const env=buildEnvironment\(c,ld,ctx,ovs,nf,hh\[c\]\)/);
 assert.match(live,/chipShadowSignal\(c,hh\[c\],instWin,yc\[c\]\)/);
 assert.match(live,/volumeShadowSignal\(c,etfLd\?\.quotes\?\.\[c\],hs\[c\],vh\[c\]\)/);
});
