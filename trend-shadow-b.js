'use strict';
// Experimental strong-add B: price-core historical replay plus independent live shadow gate.
// No mutation of official signals, stored trades, quotes, or sync state.
const crypto=require('node:crypto');
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
// Content fingerprints detect revisions to historical bars hidden by unchanged dates/counts.
function historyFingerprint(rows){
 const all=crypto.createHash('sha256'),yearHashes=new Map();
 for(const r of rows||[]){
  if(!r||!r.date)continue;
  const yy=String(r.date).slice(0,4);
  if(!yearHashes.has(yy))yearHashes.set(yy,crypto.createHash('sha256'));
  const values=[r.date,r.open??null,r.high??null,r.low??null,r.close??null,
   r.adjclose??null,r.adjopen??null,r.adjhigh??null,r.adjlow??null,r.rawClose??null];
  const record=JSON.stringify(values)+'\n';
  all.update(record);yearHashes.get(yy).update(record);
 }
 return{algorithm:'sha256-historical-bars-v1',hash:all.digest('hex').slice(0,24),
  byYear:Object.fromEntries([...yearHashes].sort(([a],[b])=>a.localeCompare(b)).map(([y,h])=>[y,h.digest('hex').slice(0,24)]))};
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


// Experimental evidence-first entry-risk comparison, isolated from real-time decisions.
// One signal per 10 trading days from the existing price-core candidate generator.
// Signal confirmed at day-i close; fills occur at following session OPEN.
function riskResearch(rows,marketRows=[]){
 const {bars,candidateA}=signalCandidates(rows);
 const market=(marketRows||[]).filter(r=>r&&r.date&&Number(r.close)>0).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 const marketIdx=new Map(market.map((r,i)=>[String(r.date),i]));
 const closes=bars.map(b=>b.c),issues=[];
 let coverage=bars.length?bars.filter(b=>b.o>0&&b.h>0&&b.l>0).length/bars.length:0;
 for(let i=1;i<bars.length;i++){
  const pre=bars[i-1],cur=bars[i];
  if(!(pre.c>0&&cur.c>0))continue;
  const dayMove=(cur.c/pre.c-1)*100;
  if(Math.abs(dayMove)>35&&issues.length<10)issues.push({date:cur.date,type:'DAILY_DISCONTINUITY',movePct:pct(dayMove,2),note:'校正後日線變動過大；確認拆分／還原尺度'});
  if(i>=60&&closes[i-60]>0){
   const ret60=(cur.c/closes[i-60]-1)*100;
   if(ret60< -55&&issues.length<10)issues.push({date:cur.date,type:'60D_EXTREME_DRAW_DOWN',movePct:pct(ret60,2),note:'60交易日跌幅異常；應核對歷史尺度'});
  }
 }
 const full=bars.length>=340&&coverage>=.90;
 const baseline=candidateA.map(e=>{
  const i=e.signalIndex,ma20=avgRange(closes,i-19,i+1);
  const mi=marketIdx.get(e.date);
  const market5=Number.isInteger(mi)&&mi>=5&&market[mi-5].close>0?(Number(market[mi].close)/Number(market[mi-5].close)-1)*100:null;
  return{...scoreEvent(e,bars),maDistanceAtr:ma20!=null&&e.atr>0?(bars[i].c-ma20)/e.atr:null,
   market5Pct:market5};
 });
 const bySignal=new Map(baseline.map(e=>[e.date,e]));
 const nextConfirmation=e=>{
  const i=e.signalIndex,next=bars[i+1],fill=bars[i+2];
  if(!(next?.c>0&&next?.o>0&&fill?.o>0))return null;
  if(!(next.c>=e.breakout&&next.c>=next.o))return null;
  return scoreEvent({...e,entryIndex:i+2,entryDate:fill.date,entry:fill.o,confirmDate:next.date},bars);
 };
 const accepted={
  baseline:baseline,
  extension2:baseline.filter(e=>finite(e.maDistanceAtr)&&e.maDistanceAtr<=2),
  extension25:baseline.filter(e=>finite(e.maDistanceAtr)&&e.maDistanceAtr<=2.5),
  extension3:baseline.filter(e=>finite(e.maDistanceAtr)&&e.maDistanceAtr<=3),
  nextClose:baseline.map(nextConfirmation).filter(Boolean),
  marketGuard:baseline.filter(e=>finite(e.market5Pct)&&e.market5Pct>=-2),
  combined:baseline.filter(e=>finite(e.maDistanceAtr)&&e.maDistanceAtr<=2.5&&finite(e.market5Pct)&&e.market5Pct>=-2)
   .map(nextConfirmation).filter(Boolean)
 };
 const report=(id,events)=>{
  const kept=new Set(events.map(e=>e.date)),matched=baseline.filter(e=>kept.has(e.date));
  const rejected=baseline.filter(e=>!kept.has(e.date)),maturedRejected=rejected.filter(e=>finite(e.returnPct?.[20]));
  const sample=(es,p)=>es.filter(e=>finite(e.returnPct?.[p]));
  const rets=es=>es.map(e=>e.returnPct[20]);
  const gain=n=>maturedRejected.filter(e=>e.returnPct[20]>0).length;
  const losses=maturedRejected.filter(e=>e.returnPct[20]<0).length;
  const match20=sample(matched,20),taken20=sample(events,20);
  const sameDates=new Map(matched.map(e=>[e.date,e]));
  const matchedNet=sample(events,20).filter(e=>finite(sameDates.get(e.date)?.returnPct?.[20]))
   .map(e=>e.returnPct[20]-sameDates.get(e.date).returnPct[20]);
  const cohorts=[['2014～2020','2014-01-01','2021-01-01'],['2021～2024','2021-01-01','2025-01-01'],['2025～近期','2025-01-01','9999-12-31']].map(([period,from,to])=>{
   const historical=events.filter(e=>e.date>=from&&e.date<to);
   const complete20=sample(historical,20);
   return{period,signals:historical.length,completed20:complete20.length,avg20NetPct:pct(mean(rets(complete20)),3)};
  });
  return{id,stats:stats(events),matchedBaseline20:{samples:match20.length,avgNetPct:pct(mean(rets(match20)),3)},
   pairedDelta20:{samples:matchedNet.length,avgNetPct:pct(mean(matchedNet),3)},
   rejected:{signals:rejected.length,mature20:maturedRejected.length,avoidedLosses20:losses,missedGains20:gain(),
     avgBaseline20NetPct:pct(mean(rets(maturedRejected)),3)},
   cohorts};
 };
 const variantNames={baseline:'原版價格核心',extension2:'距20均線≤2 ATR',extension25:'距20均線≤2.5 ATR',
   extension3:'距20均線≤3 ATR',nextClose:'下一日收盤確認，隔日開盤進',marketGuard:'大盤5日跌幅不低於-2%',
   combined:'距均線≤2.5 ATR＋大盤風控＋下一日確認'};
 const variants=Object.fromEntries(Object.entries(accepted).map(([key,events])=>
   [key,{label:variantNames[key],...report(key,events)}]));
 return{version:'trend-risk-research-v1',mode:'SHADOW_ONLY',ready:full&&issues.length===0,
  dataStatus:!full?'DATA_INCOMPLETE':issues.length?'PRICE_QA_WARNING':'READY',
  historyDays:bars.length,ohlcCoveragePct:pct(coverage*100,1),
  eventsIndependentWindowTradingDays:10,
  qa:{status:issues.length?'REVIEW_REQUIRED':full?'PASS':'DATA_INCOMPLETE',issues:issues.slice(0,10),note:'異常偵測不等於確認資料有錯；未排除或改寫任何原始日K'},
  marketCoverage:baseline.length?baseline.filter(e=>finite(e.market5Pct)).length/baseline.length:null,
  variants,assumptions:'同一組歷史20日突破價格核心訊號（每10交易日最多1次）；訊號日收盤確認；普通策略次交易日開盤成交，確認策略等次日收盤後再下一交易日開盤成交；5／20／60交易日固定持有，來回費稅估0.385%。',
  limitations:'不是正式盤中買點、即時分數與Hard Gate完整重播。過度延伸距離與市場條件在訊號日收盤判斷；各策略實際進場事件數不同。全部參數係看到2026虧損後提出，近期區段不是獨立樣本外；未通過資料QA或不足25筆已滿20日的樣本，不可據此自動升級正式模型。',
  recommendation:'NO_AUTO_PROMOTION'};
}

function compare(rows,marketRows=[]){
 const fingerprint=historyFingerprint(rows),marketFingerprint=historyFingerprint(marketRows);
 const key=fingerprint.hash+'|'+marketFingerprint.hash;
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
   historyFingerprint:fingerprint,marketFingerprint:marketFingerprint.hash,
   historyDays:bars.length,ohlcCoveragePct:pct(coverage,1),firstDate:bars[0]?.date||null,lastDate:bars.at(-1)?.date||null,
   all:{A:stats(eventsA),B:stats(eventsB)},entryBandResearch:entryBandResearch(eventsA),riskResearch:riskResearch(rows,marketRows),
   check2026:{A:stats(subset(eventsA,'2026')),B:stats(subset(eventsB,'2026'))},
   disclosure:'2026僅為近期區段檢查；B門檻制定時已看過近期損益，不可當作完全未接觸的樣本外證據。'
 };
 if(!result.ready){result.all=null;result.check2026=null;result.entryBandResearch=null;result.riskResearch=null;result.error='日K資料或OHLC覆蓋不足，禁止顯示A/B勝負'}
 if(CACHE.size>8)CACHE.clear();CACHE.set(key,{at:Date.now(),value:result});
 return result;
}
module.exports={VERSION,B,COST_PCT,live,barsFrom,signalCandidates,scoreEvent,stats,entryBandResearch,riskResearch,historyFingerprint,compare};