'use strict';
// Research-only. No mutations to official market Gate, trades, or model signals.
const SETTINGS=Object.freeze({marketDropPct:-2.2,etfDropPct:-1.5,reboundAtr:0.20,minReboundPrice:0.12,cooldownDays:7,warmup:65,feePct:0.385,horizons:[5,20,60]});
const pct=(now,prev)=>now>0&&prev>0?(now/prev-1)*100:null;
const val=x=>Number.isFinite(Number(x))&&Number(x)>0?Number(x):null;
function prepare(rows,asOfDate='9999-12-31'){
 const map=new Map();
 for(const x of rows||[]){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(x.date||'')||x.date>=asOfDate)continue;
  const close=val(x.close),adjust=val(x.adjclose)||close;
  const factor=val(x.adjFactor)||((close&&adjust)?adjust/close:1);
  const open=val(x.adjopen)||(val(x.open)?x.open*factor:null);
  const high=val(x.adjhigh)||(val(x.high)?x.high*factor:null);
  const low=val(x.adjlow)||(val(x.low)?x.low*factor:null);
  if(!close||!adjust||!open||!high||!low||low>high||open>high*1.02||open<low*.98||adjust>high*1.02||adjust<low*.98)continue;
  map.set(x.date,{date:x.date,open,high,low,close:adjust});
 }
 return[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function analyzeGate({marketPct=null,tsmcPct=null,breadthRatio=null,breadthUsable=false,environmentScore=null,fresh=true,corpActionBlocked=false}={}){
 const flags=[
  {id:'market',label:'大盤<-2.2%',available:Number.isFinite(marketPct),hit:Number.isFinite(marketPct)&&marketPct<-2.2,group:'market'},
  {id:'tsmc',label:'台積電<-3%',available:Number.isFinite(tsmcPct),hit:Number.isFinite(tsmcPct)&&tsmcPct<-3,group:'concentration'},
  {id:'breadth',label:'上市廣度<22%',available:!!breadthUsable&&Number.isFinite(breadthRatio),hit:!!breadthUsable&&Number.isFinite(breadthRatio)&&breadthRatio<.22,group:'breadth'},
  {id:'environment',label:'綜合環境分數<-65',available:Number.isFinite(environmentScore),hit:Number.isFinite(environmentScore)&&environmentScore<-65,group:'derived'}
 ];
 const counted=flags.filter(x=>x.hit).length,independent=flags.filter(x=>x.hit&&x.group!=='derived').length;
 const existing=(!fresh||corpActionBlocked||counted>=2);
 const dedup=(!fresh||corpActionBlocked||independent>=2);
 return{flags,existing:{flagCount:counted,blocked:existing},independent:{flagCount:independent,blocked:dedup},
  doubleCountRisk:flags[3].hit&&counted>=2&&independent<2,
  effectiveCount:counted,evidenceComplete:flags.slice(0,3).every(x=>x.available),
  note:'僅研究：環境分數由大盤/台積電/廣度等因素衍生，不宜未驗證就當成獨立一次急殺票。未改官方Gate。'};
}
function futureOutcome(rows,i,h,feePct){
 if(i+h>=rows.length)return null;
 const entry=rows[i+1].open,exit=rows[i+h].close;
 if(!(entry>0&&exit>0))return null;
 let low=entry,high=entry;
 for(let j=i+1;j<=i+h;j++){low=Math.min(low,rows[j].low);high=Math.max(high,rows[j].high)}
 return{exitDate:rows[i+h].date,grossPct:pct(exit,entry),netPct:pct(exit,entry)-feePct,maePct:Math.min(0,pct(low,entry)),mfePct:Math.max(0,pct(high,entry))};
}
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
function summarize(events,horizons=SETTINGS.horizons){
 const out={events:events.length,eligible:events.filter(x=>x.selected).length,results:{}};
 for(const h of horizons){
  const all=events.map(x=>x.outcomes[h]).filter(Boolean),selected=events.filter(x=>x.selected).map(x=>x.outcomes[h]).filter(Boolean);
  function stats(rows){return{matured:rows.length,meanNetPct:mean(rows.map(x=>x.netPct)),winRatePct:rows.length?100*rows.filter(x=>x.netPct>0).length/rows.length:null,
   meanMAEPct:mean(rows.map(x=>x.maePct)),meanMFEPct:mean(rows.map(x=>x.mfePct))};}
  out.results[h]={unfiltered:stats(all),reboundQualified:stats(selected)};
 }
 return out;
}
function backtest(etfRows,marketRows,{code='0050',asOfDate='9999-12-31',settings={}}={}){
 const conf={...SETTINGS,...settings};const e=prepare(etfRows,asOfDate),market=prepare(marketRows,asOfDate);
 const marketByDay=new Map(market.map((x,i)=>[x.date,i>0?pct(x.close,market[i-1].close):null]));
 const events=[],rejected={invalidMarket:0,lowVolatility:0,noFollowup:0},sampleStart=Math.max(conf.warmup,15);
 if(e.length<sampleStart+2||market.length<sampleStart)return{ok:false,code,status:'INSUFFICIENT_HISTORY',
  source:'歷史日K，尚無足夠有效OHLC可做策略比較',etfRows:e.length,marketRows:market.length};
 let lastEvent=-9999;
 for(let i=sampleStart;i<e.length-1;i++){
  const marketReturn=marketByDay.get(e[i].date);
  if(!Number.isFinite(marketReturn)){rejected.invalidMarket++;continue}
  const drop=pct(e[i].close,e[i-1].close);
  if(!(marketReturn<=conf.marketDropPct&&drop<=conf.etfDropPct))continue;
  if(i-lastEvent<conf.cooldownDays)continue;
  let trs=[];
  for(let j=i-13;j<=i;j++){const p=e[j-1].close;trs.push(Math.max(e[j].high-e[j].low,Math.abs(e[j].high-p),Math.abs(e[j].low-p)))}
  const atr=mean(trs);if(!(atr>0)){rejected.lowVolatility++;continue}
  const bounce=e[i].close-e[i].low,required=Math.max(conf.minReboundPrice,conf.reboundAtr*atr);
  const selected=bounce>=required;
  const outcomes={};for(const h of conf.horizons)outcomes[h]=futureOutcome(e,i,h,conf.feePct);
  events.push({date:e[i].date,marketProxyReturnPct:marketReturn,etfDropPct:drop,
   observedAtr:atr,closeMinusLow:bounce,requiredBounce:required,selected,
   entryDate:e[i+1].date,entryPrice:e[i+1].open,outcomes});
  lastEvent=i;
 }
 const summary=summarize(events,conf.horizons);
 return{ok:true,status:events.length?'READY':'NO_CRASH_EVENTS',code,version:'crash-dip-proxy-research-v1',
  data:{etfRows:e.length,marketRows:market.length,firstEtfDay:e[0]?.date,lastEtfDay:e.at(-1)?.date,
   firstMarketDay:market[0]?.date,lastMarketDay:market.at(-1)?.date,asOfDate,adjustedPrice:true},
  methodology:{trigger:'0050 ETF調整收盤價相對前一日跌幅<=-2.2%（僅市場代理，非大盤指數真實急殺判定）且標的ETF當日跌幅<=-1.5%',
   compare:'同一次事件：所有急跌次日開盤買進 vs 當日收盤價已從低點反彈至少max(0.12元,0.2 ATR)才次日開盤買進；分組樣本不相等',
   order:'收盤後才能形成條件，僅以次一個交易日開盤作入場估計，不使用訊號日事後最佳價',
   benchmark:'站在場外不成交，不虛構0%交易報酬；對照列為所有事件次日開盤買進，非完整正式A模型',
   future:'第5/20/60個交易日收盤離場；未到期不列入平均/勝率；當日盤中K排除',
   returns:'使用調整價路徑的代理報酬，約扣雙邊手續費加ETF賣出稅0.385個百分點；不等於券商真實含息淨報酬',
   limitations:'無歷史完整台積電/市場廣度/綜合環境與實際L1-L3確認快照；無法重播正式#13 Gate，也未考慮滑價/流動性/單筆最低手續費；不能宣稱B擊敗正式A'},
  settings:conf,summary,events:events.slice(-120),rejected};
}
module.exports={SETTINGS,analyzeGate,backtest,prepare,futureOutcome};
