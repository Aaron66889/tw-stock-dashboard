'use strict';
// Data-only HTML extraction of 0050 dividend actions from Yahoo Taiwan's public
// structured stock dividend table. Never used by live buy signals or holdings.
// Corporate-action amounts BEFORE 2025-06-18 are in the historical (pre-split) unit.
const SOURCE_URL='https://tw.stock.yahoo.com/quote/0050.TW/dividend';
const ANCHORS=[
 ['2009-10-23',1],['2010-10-25',2.2],['2011-10-26',1.95],['2012-10-24',1.85],
 ['2020-01-31',2.9],['2022-01-21',3.2],['2022-07-18',1.8],
 ['2024-01-17',3],['2024-07-16',1],['2025-01-17',2.7],
 ['2025-07-21',.36],['2026-01-22',1],['2026-07-21',.6]
];
function parse0050Dividends(html,{asOfDate='2026-10-19'}={}){
 const plain=String(html||'').replace(/\\"/g,'"');
 // A record with an ex-date, an explicit ETF code and the historical per-share
 // dividend. Prefer the structured table to fuzzy scraping visible table columns.
 const regex=/"exDate":"(\d{4}-\d{2}-\d{2})T[^"]*","year":"[^"]+","period":"[^"]+","symbol":"0050","totalDividend":"([0-9.]+)"/g;
 const raw=[...plain.matchAll(regex)].map(m=>({date:m[1],exDate:m[1],amount:Number(m[2]),source:'Yahoo Taiwan 0050 dividend policy historical unit'}))
  .filter(e=>e.amount>0&&e.date<=asOfDate);
 const grouped=new Map();const errors=[];
 for(const e of raw){
  if(grouped.has(e.date)&&Math.abs(grouped.get(e.date).amount-e.amount)>.0001)errors.push('CONFLICTING_AMOUNT_'+e.date);
  grouped.set(e.date,e);
 }
 const all=[...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date));
 const events=all.filter(e=>e.date>='2009-01-01');
 const perYear={};
 for(const e of events)perYear[e.date.slice(0,4)]=(perYear[e.date.slice(0,4)]||0)+1;
 for(let y=2009;y<=Math.min(2026,Number(asOfDate.slice(0,4)));y++){
  const expect=y<=2016?1:2,actual=perYear[y]||0;
  if(actual!==expect)errors.push('EXPECTED_'+expect+'_DIVIDENDS_'+y+'_GOT_'+actual);
 }
 const checks=ANCHORS.filter(([date])=>date<=asOfDate).map(([date,amount])=>{
  const actual=grouped.get(date)?.amount??null;
  return{date,expected:amount,actual,pass:actual!==null&&Math.abs(actual-amount)<.0001};
 });
 if(checks.some(x=>!x.pass))errors.push('HISTORICAL_ANCHOR_MISMATCH');
 if(all.length<28&&asOfDate>='2026-07-21')errors.push('DIVIDEND_HISTORY_INCOMPLETE');
 return{complete:errors.length===0,ok:events.length>0,source:'Yahoo Taiwan 0050 股利政策（非 TWSE 官方）',
  sourceUrl:SOURCE_URL,rawEventCount:raw.length,eventCount:events.length,perYear,anchorChecks:checks,
  events,errors,asOfDate,
  notes:'此來源為公開股利政策資料，所有拆分前現金配息金額採歷史每單位尺度；研究計算時統一換算為拆分後尺度，不能二次折算。'};
}
module.exports={SOURCE_URL,parse0050Dividends,ANCHORS};
