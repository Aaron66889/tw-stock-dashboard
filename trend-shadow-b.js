'use strict';
// Experimental strong-add B: price-core historical replay plus independent live shadow gate.
// No mutation of official signals, stored trades, quotes, or sync state.
const VERSION='trend-shadow-b-v1';
const B={minScore:78,minBreakAtr:0.12,maxBreakAtr:0.30,requireBullishCandle:true};
const COST_PCT=0.385; // approximate round-trip ETF brokerage 0.285% + sell tax 0.1%; no min fees/slippage.
const CACHE=new Map();
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const pct=(v,d)=>v===null?null:Number(v.toFixed(d));
function live(official,quote){
 const st=official?.status||'NOT_READY',score=Number(official?.score);
 const px=Number(official?.price),br=Number(official?.levels?.breakout20),atr=Number(official?.trend?.atr);
 const op=Number(quote?.open),validOpen=finite(quote?.open)&&op>0;
 const result={version:VERSION,mode:'SHADOW_ONLY',status:'WAIT',eligible:false,reason:'',officialStatus:st,
   officialScore:finite(official?.score)?score:null,rule:B,observed:{price:finite(px)?px:null,open:validOpen?op:null,breakout20:finite(br)?br:null,atr:finite(atr)?atr:null},breakoutAtr:null};
 if(!(px>0&&br>0&&atr>0)){result.status='DATA_INCOMPLETE';result.reason='無法可靠取得現價／突破位／ATR';return result}
 const d=(px-br)/atr;result.breakoutAtr=pct(d,3);
 if(st!=='TREND_BUY'){result.status='WAIT_A';result.reason='A版尚未確認可加碼；B版不會覆蓋正式訊號';return result}
 if(!finite(official?.score)||score<B.minScore){result.status='WAIT_SCORE';result.reason='趨勢強度未達B版78分門檻';return result}
 if(d<B.minBreakAtr){result.status='WAIT_STRENGTH';result.reason='突破幅度不足0.12 ATR，避免假突破';return result}
 if(d>B.maxBreakAtr){result.status='WAIT_CHASE';result.reason='突破超過0.30 ATR，B版不追價';return result}
 if(!validOpen){result.status='DATA_INCOMPLETE';result.reason='缺少當日開盤價，不能確認強勢K棒';return result}
 if(px<op){result.status='WAIT_CANDLE';result.reason='現價低於開盤，等待強勢確認';return result}
 return{...result,status:'B_CANDIDATE',eligible:true,reason:'B版Shadow條件符合（仍非正式買入訊號）'};
}
function barsFrom(rows){
 const src=(rows||[]).filter(x=>x&&x.date&&Number(x.close)>0).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 const l=src.at(-1),lastAdj=Number(l?.adjclose)||Number(l?.close),scale=lastAdj>0?Number(l.close)/lastAdj:1;
 return src.map(r=>{
   const close=Number(r.close),adj=Number(r.adjclose)||close,ratio=close>0?adj/close:1;
   const adjPrice=(key,adjKey)=>{
     const v=r[adjKey]!=null?Number(r[adjKey]):r[key]!=null?Number(r[key])*ratio:NaN;
     return Number.isFinite(v)&&v>0?v*scale:null;
   };
   return{date:String(r.date),c:adjPrice('close','adjclose'),o:adjPrice('open','adjopen'),
     h:adjPrice('high','adjhigh'),l:adjPrice('low','adjlow')};
 }).filter(x=>x.c>0);
}
function avgRange(arr,from,to){if(from<0||to>arr.length||from>=to)return null;let sum=0;for(let i=from;i<to;i++){if(!finite(arr[i]))return null;sum+=arr[i]}return sum/(to-from)}
function signalCandidates(rows){
 const bars=barsFrom(rows),close=bars.map(b=>b.c),tr=bars.map((b,i)=>{
   if(i===0)return 0;
   const p=bars[i-1].c;
   return b.h>0&&b.l>0?Math.max(b.h-b.l,Math.abs(b.h-p),Math.abs(b.l-p)):null;
 });
 const candidateA=[],candidateB=[];let last=-999;
 for(let i=260;i<bars.length-1;i++){
   const curr=bars[i],next=bars[i+1];
   if(i-last<10||!(curr.h>0&&curr.l>0&&curr.o>0&&next.o>0))continue;
   const m20=avgRange(close,i-19,i+1),m60=avgRange(close,i-59,i+1),
     m120=avgRange(close,i-119,i+1),past20=avgRange(close,i-29,i-9),atr=avgRange(tr,i-13,i+1);
   if(!(atr>0&&m20>m60&&m60>m120&&m20>past20))continue;
   const prior20=bars.slice(i-20,i);
   if(prior20.some(b=>!(b.h>0)))continue;
   const br=Math.max(...prior20.map(b=>b.h)),d=(curr.c-br)/atr;
   if(!(d>=0&&d<=.60))continue;
   // Signal is recognized only after day i CLOSE. Both variants execute next day OPEN.
   const record={date:curr.date,entryDate:next.date,signalIndex:i,entryIndex:i+1,
     entry:next.o,breakout:br,atr,breakoutAtr:d,signalClose:curr.c,
     signalOpen:curr.o,variant:'A'};
   candidateA.push(record);last=i;
   if(d>=B.minBreakAtr&&d<=B.maxBreakAtr&&curr.c>=curr.o)
     candidateB.push({...record,variant:'B'});
 }
 return {bars,candidateA,candidateB};
}
function scoreEvent(e,bars){
 const idx=e.entryIndex,ret={},mae={},mfe={};
 for(const days of [5,20,60]){
   const end=idx+days;
   if(end>=bars.length){ret[days]=mae[days]=mfe[days]=null;continue}
   const period=bars.slice(idx,end+1);
   if(period.some(x=>!(x.l>0&&x.h>0))){ret[days]=mae[days]=mfe[days]=null;continue}
   ret[days]=(bars[end].c/e.entry-1)*100-COST_PCT;
   mae[days]=(Math.min(...period.map(x=>x.l))/e.entry-1)*100;
   mfe[days]=(Math.max(...period.map(x=>x.h))/e.entry-1)*100;
 }
 const f=bars.slice(idx,idx+5),fake=f.length===5?f.some(b=>b.c<e.breakout):null;
 return{...e,returnPct:ret,maePct:mae,mfePct:mfe,fakeBreak5:fake};
}
function stats(events){
 const period={};
 for(const n of [5,20,60]){
   const good=events.filter(x=>finite(x.returnPct[n])),returns=good.map(x=>x.returnPct[n]),
    excursions=good.filter(x=>finite(x.maePct[n])&&finite(x.mfePct[n]));
   period[n]={samples:good.length,avgNetPct:pct(mean(returns),3),winPct:good.length?pct(returns.filter(x=>x>0).length/good.length*100,2):null,
     avgMAEPct:pct(mean(excursions.map(x=>x.maePct[n])),3),
     avgMFEPct:pct(mean(excursions.map(x=>x.mfePct[n])),3)};
 }
 const eligible=events.filter(x=>x.fakeBreak5!==null);
 return{signals:events.length,period,fakeBreak5:{samples:eligible.length,rate:eligible.length?pct(eligible.filter(x=>x.fakeBreak5).length/eligible.length*100,2):null}};
}
// Read-only next-day OPEN fill study; official model and separate Shadow-B stay unchanged.
function entryBandResearch(events) {
 const levels=[{id:'A',label:'保守',maxAtr:.30},{id:'B',label:'折衷',maxAtr:.45},{id:'C',label:'寬鬆',maxAtr:.60}];
 const offset=e=>e.atr>0&&e.entry>0?(e.entry-e.breakout)/e.atr:null;
 const feasible=events.map(e=>({...e,entryOffsetAtr:offset(e)})).filter(e=>finite(e.entryOffsetAtr));
 const inBand=(e,maxAtr)=>e.entryOffsetAtr>=-.10000001&&e.entryOffsetAtr<=maxAtr+1e-8;
 const bands=levels.map(x=>{
  const samples=feasible.filter(e=>inBand(e,x.maxAtr));
  return{id:x.id,label:x.label,maxAtr:x.maxAtr,lowerAtr:-.10,stats:stats(samples)};
 });
 const extras=[{id:'B_ONLY',label:'折衷新增',low:.30,high:.45},{id:'C_ONLY',label:'寬鬆新增',low:.45,high:.60}].map(x=>({
  id:x.id,label:x.label,rangeAtr:[x.low,x.high],
  stats:stats(feasible.filter(e=>e.entryOffsetAtr>x.low+1e-8&&e.entryOffsetAtr<=x.high+1e-8))
 }));
 return{version:'trend-band-research-v1',mode:'SHADOW_ONLY',signalPool:events.length,
  assumptions:'共同訊號於日線收盤確認；隔一交易日開盤價若在突破價-0.10 ATR至突破價+各上限內才假設成交；固定持有5/20/60交易日，扣除估計來回費稅0.385%。',
  limitations:'此為日線價格核心及次日開盤代理回測，未重播盤中觸價、動態評分、量價、風控Gate與實際成交；三組樣本並非相同成交集合，不可直接視為正式模型的實績或勝負。',
  bands,extras};
}

function compare(rows){
 const key=[rows?.length||0,rows?.[0]?.date,rows?.at(-1)?.date,rows?.at(-1)?.close,rows?.at(-1)?.adjclose].join('|');
 const cached=CACHE.get(key);if(cached&&Date.now()-cached.at<15*60*1000)return cached.value;
 const {bars,candidateA,candidateB}=signalCandidates(rows);
 const coverage=bars.length?bars.filter(b=>b.o>0&&b.h>0&&b.l>0).length/bars.length*100:0;
 const eventsA=candidateA.map(e=>scoreEvent(e,bars)),eventsB=candidateB.map(e=>scoreEvent(e,bars));
 const subset=(a,yy)=>a.filter(x=>x.date.startsWith(yy+'-'));
 const result={version:VERSION,mode:'DAILY_PRICE_CORE_PROXY',source:'日OHLC含息調整序列',
   policy:'20日突破＋20>60>120均線與20日上彎，A突破幅度0~0.60 ATR；B限制0.12~0.30 ATR且收盤不低於開盤。次交易日開盤價進場。',
   execution:'信號日收盤判斷，次交易日開盤買入；固定持有5/20/60交易日。',
   fees:'單趟券商費率0.1425%、ETF賣出稅0.1%，來回約0.385%；未含最低手續費及滑價。',
   limitations:'並非完整重播正式盤中A版的分數、當日突破狀態、量價、雲端成交或強制Gate；B版78分條件亦無法由價格核心單獨重播。',
   ready:bars.length>=340&&coverage>=90,
   historyDays:bars.length,ohlcCoveragePct:pct(coverage,1),firstDate:bars[0]?.date||null,lastDate:bars.at(-1)?.date||null,
   all:{A:stats(eventsA),B:stats(eventsB)},entryBandResearch:entryBandResearch(eventsA),
   check2026:{A:stats(subset(eventsA,'2026')),B:stats(subset(eventsB,'2026'))},
   disclosure:'2026僅為近期區段檢查；B門檻制定時已看過近期損益，不可當作完全未接觸的樣本外證據。'
 };
 if(!result.ready){result.all=null;result.check2026=null;result.entryBandResearch=null;result.error='日K資料或OHLC覆蓋不足，禁止顯示A/B勝負'}
 if(CACHE.size>8)CACHE.clear();CACHE.set(key,{at:Date.now(),value:result});
 return result;
}
module.exports={VERSION,B,COST_PCT,live,barsFrom,signalCandidates,scoreEvent,stats,entryBandResearch,compare};