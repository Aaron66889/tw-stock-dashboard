'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {inspect,label}=require('../history-identity');
const CODES=['0050','0056','00878','00919'];
function fake(code,extra={}){
 return {code,source:'Yahoo Finance 0050.TW 長期日K（舊版錯誤文字）',
   rows:[{date:'2024-01-02',close:25,rawClose:30,source:'Yahoo Finance '+code+'.TW adjusted daily OHLC'},
         {date:'2024-01-03',close:25.1,rawClose:30.1,source:'Yahoo Finance '+code+'.TW adjusted daily OHLC'}],...extra};
}
test('all four ETFs get their own source label even if old cached heading says 0050',()=>{
 for(const code of CODES){
  const h=fake(code),out=inspect(code,h);
  assert.equal(out.match,'PASS');
  assert.equal(out.cacheCode,code);
  assert.deepEqual(out.rowSymbols,[code]);
  assert.match(label(code,h),new RegExp(code+'\\.TW'));
  if(code!=='0050')assert.ok(!label(code,h).includes('0050.TW'));
 }
});
test('cached payload from another ETF is flagged rather than relabeled',()=>{
 const wrong=fake('0050');
 assert.equal(inspect('0056',wrong).match,'FAIL');
 assert.match(label('0056',wrong),/代碼不一致/);
 const wrongRows=fake('0056',{rows:fake('0050').rows});
 assert.equal(inspect('0056',wrongRows).match,'FAIL');
 assert.match(label('0056',wrongRows),/代碼不一致/);
});
test('empty or unsourced history never receives a false PASS',()=>{
 assert.equal(inspect('0056',{code:'0056',rows:[]}).match,'NOT_VERIFIABLE');
 assert.equal(inspect('00878',{code:'00878',rows:[{date:'2025-01-01',close:20}]}).match,'NOT_VERIFIABLE');
 assert.match(label('00878',{code:'00878',rows:[{close:20}],source:'Yahoo Finance 0050.TW'}),/待核對/);
});
test('production data route is code-indexed at every source, cache and Shadow stage',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert.match(s,/symbol=code\+'\.TW'/);
 assert.match(s,/function readyFile\(code\)\{return\`twse_\$\{code\}_official_ready\.json\`\}/);
 assert.match(s,/function historyFile\(code\)\{return\`twse_\$\{code\}_history\.json\`\}/);
 assert.match(s,/function parseYahooAdjustedChart\(code,d\)/);
 assert.match(s,/trendEntryOne\(c,quotes\?\.\[c\],hs\[c\],marketHist,marketQuote\)/);
 assert.match(s,/TREND_SHADOW_B\.compare\(hist\?\.rows\|\|\[\],marketHist\?\.rows\|\|\[\]\)/);
 assert.match(s,/HISTORY_IDENTITY\.label\(code,ready\)/);
 assert.match(s,/HISTORY_IDENTITY\.inspect\(code,hist\)/);
});
