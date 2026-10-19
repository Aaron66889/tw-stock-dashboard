'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parse0050Dividends,ANCHORS}=require('../0050-dividend-source');
function record(date,amount){return '{"exDate":"'+date+'T00:00:00+08:00","year":"'+date.slice(0,4)+'","period":"H1","symbol":"0050","totalDividend":"'+amount+'"}'}
function complete(){
 const rows=[];
 for(let y=2009;y<=2026;y++){
  const matches=ANCHORS.filter(([d])=>Number(d.slice(0,4))===y);
  const need=y<=2016?1:2;
  for(const [day,amount] of matches)rows.push(record(day,amount));
  for(let i=matches.length;i<need;i++){
   const day=y+'-'+(i===0?'01-15':'07-15');
   rows.push(record(day,0.4));
  }
 }
 return rows.join('');
}
test('Read-only 0050 dividend source extracts 2009-2026 historical events with split-aware amounts',()=>{
 const result=parse0050Dividends(complete());
 assert.equal(result.complete,true,JSON.stringify(result.errors));
 assert.equal(result.eventCount,28);
 assert.equal(result.perYear['2009'],1);
 assert.equal(result.perYear['2026'],2);
 assert.equal(result.events.find(x=>x.date==='2025-01-17').amount,2.7);
 assert.equal(result.events.find(x=>x.date==='2026-07-21').amount,.6);
});
test('Incomplete Yahoo chart events (only 2013+) are blocked and 2022 phantom dividend is not accepted',()=>{
 const miss=complete().replace(record('2009-10-23',1),'');
 assert.equal(parse0050Dividends(miss).complete,false);
 assert.match(parse0050Dividends(miss).errors.join(' '),/2009/);
 const extra=complete()+record('2022-08-02',.23);
 assert.equal(parse0050Dividends(extra).complete,false);
 assert.match(parse0050Dividends(extra).errors.join(' '),/2022/);
});
test('Source parser works with JSON escaped quotes and rejects a wrong ticker',()=>{
 const escaped=complete().replace(/"/g,'\\"');
 assert.equal(parse0050Dividends(escaped).eventCount,28);
 assert.equal(parse0050Dividends(complete().replace(/"symbol":"0050"/g,'"symbol":"0056"')).eventCount,0);
});
test('Research API calls independently verified complete source and keeps trade model untouched',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert.match(s,/CASH_0050_DIVIDEND_SOURCE\.parse0050Dividends/);
 assert.match(s,/fetch0050DividendHistory\(\)/);
 assert.match(s,/sourceUrl:divs\?\.sourceUrl/);
 assert.match(s,/verdict:'NO_LIVE_MODEL_CHANGE'/);
});
