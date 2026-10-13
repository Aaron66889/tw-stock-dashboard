'use strict';
/*
 * Forward-only strong-add A/B signal ledger. No orders, no portfolio changes.
 * Actual intraday observation snapshots are immutable; B can first qualify later
 * in the same 10-trading-session episode. Longitudinal metrics are daily-OHLC
 * estimates computed only from completed trading dates.
 */
const CODES=['0050','0056','00878','00919'];
const VERSION='trend-forward-ledger-v1';
const COST_PCT=0.385; // round trip estimate, omits slippage and minimum fees
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const goodPrice=x=>finite(x)&&Number(x)>0;
const round=(n,places=3)=>Number.isFinite(n)?Number(n.toFixed(places)):null;
const mean=values=>values.length?values.reduce((sum,v)=>sum+v,0)/values.length:null;
const dayPattern=/^20\d{2}-\d{2}-\d{2}$/;
function activeTradingWindow(clock){
 const m=Number(clock?.h)*60+Number(clock?.m);
 return ['Mon','Tue','Wed','Thu','Fri'].includes(clock?.weekday)&&m>=9*60+3&&m<=13*60+25;
}
function quoteValid(quote,day,nowMs=Date.now()){
 const fetched=Date.parse(quote?.serverFetchedAt||'');
 return goodPrice(quote?.last)&&quote?.date===day&&quote?.realtime===true&&
   quote?.lastGoodFallback!==true&&quote?.referenceReliable!==false&&
   quote?.corporateActionReferenceMissing!==true&&Number.isFinite(fetched)&&
   nowMs>=fetched&&nowMs-fetched<=90_000;
}
function signalObservation(code,model,quote,day,observedAt=new Date()){
 const ts=new Date(observedAt),now=ts.getTime();
 if(!CODES.includes(code)||!dayPattern.test(day)||!Number.isFinite(now))return null;
 if(model?.status!=='TREND_BUY'||model?.ok!==true||!quoteValid(quote,day,now))return null;
 const px=Number(quote.last);
 if(!goodPrice(px)||!goodPrice(model?.levels?.breakout20)||!goodPrice(model?.trend?.atr))return null;
 const b=model.shadowB||{},state=String(b.status||'DATA_INCOMPLETE');
 return{
   code,day,observedAt:ts.toISOString(),price:px,
   a:{status:'TREND_BUY',score:finite(model.score)?Number(model.score):null,
     action:String(model.action||'').slice(0,120),breakout20:Number(model.levels.breakout20),
     maxChase:goodPrice(model.levels.maxChase)?Number(model.levels.maxChase):null,
     atr:Number(model.trend.atr)},
   b:{status:state,passed:state==='B_CANDIDATE'&&b.eligible===true,
     reason:String(b.reason||'').slice(0,150),
     breakoutAtr:finite(b.breakoutAtr)?Number(b.breakoutAtr):null},
   source:String(quote.source||'').slice(0,100),
   quoteFetchedAt:String(quote.serverFetchedAt)
 };
}
function eventId(code,day){return '__TREND_AB_EVT_'+code+'_'+day.replaceAll('-','');}
function newEvent(o){
 if(!o)return null;
 return{id:eventId(o.code,o.day),version:VERSION,code:o.code,day:o.day,firstObservedAt:o.observedAt,
   a:{...o.a,entryPrice:o.price,entryAt:o.observedAt,quoteFetchedAt:o.quoteFetchedAt,source:o.source},
   b:o.b.passed?{status:'B_CANDIDATE',entryPrice:o.price,entryAt:o.observedAt,reason:o.b.reason,breakoutAtr:o.b.breakoutAtr}:null,
   firstBVerdict:{...o.b,at:o.observedAt},lastBVerdict:{...o.b,at:o.observedAt},
   lastObservedAt:o.observedAt,observationCount:1};
}
function updateEvent(old,o){
 if(!old||!o||old.code!==o.code||!dayPattern.test(String(old.day||'')))return old;
 // The earliest persisted A observation must never drift to a later price.
 const next={...old,lastObservedAt:o.observedAt,lastBVerdict:{...o.b,at:o.observedAt},
   observationCount:Math.min(100000,(Number(old.observationCount)||0)+1)};
 if(!old.b&&o.b.passed)next.b={status:'B_CANDIDATE',entryPrice:o.price,entryAt:o.observedAt,
   reason:o.b.reason,breakoutAtr:o.b.breakoutAtr};
 return next;
}
function daysSinceTrading(rows,thenDay,today){
 const dates=[...new Set((rows||[]).map(x=>String(x.date||'')).filter(x=>dayPattern.test(x)))].sort();
 const then=dates.indexOf(thenDay),now=dates.indexOf(today);
 if(then<0||now<0||now<then)return null;
 return now-then;
}
function groupLatest(events,code){return (events||[]).filter(x=>x?.code===code&&dayPattern.test(x.day))
 .sort((a,b)=>b.day.localeCompare(a.day))[0]||null;}
function matchEpisode(events,code,day,rows,cooldown=10){
 const last=groupLatest(events,code);
 if(!last||last.day>day)return null;
 const distance=daysSinceTrading(rows,last.day,day);
 return distance!==null&&distance<cooldown?last:null;
}
function normalizeBars(rows,today){
 // Protect against lookahead: ignore today's in-progress daily candle, even after
 // market close; it is only used after the next Taiwan market date.
 return (rows||[]).filter(x=>x&&dayPattern.test(String(x.date||''))&&x.date<today&&goodPrice(x.close))
 .slice().sort((a,b)=>a.date.localeCompare(b.date));
}
function rawToAdjusted(row,v,type){
 const close=Number(row?.close),adj=Number(row?.adjclose)||close;
 const factor=close>0&&adj>0?adj/close:NaN;
 const direct=row?.['adj'+type];
 return goodPrice(direct)?Number(direct):goodPrice(v)&&Number.isFinite(factor)?Number(v)*factor:null;
}
function outcome(entryPrice,entryDay,breakout,rawRows,today){
 if(!goodPrice(entryPrice)||!dayPattern.test(entryDay))return null;
 const bars=normalizeBars(rawRows,today),i=bars.findIndex(r=>r.date===entryDay);
 if(i<0)return{date:entryDay,price:entryPrice,horizons:{5:null,20:null,60:null},fakeBreak5:null,reason:'入場當日收盤K線尚未完成或資料缺漏'};
 const base=bars[i],factor=goodPrice(base.adjclose)?Number(base.adjclose)/Number(base.close):1;
 if(!(factor>0))return null;
 const alignedPrice=Number(entryPrice)*factor,horizons={};
 for(const k of [5,20,60]){
   if(i+k>=bars.length){horizons[k]=null;continue}
   const samples=bars.slice(i+1,i+k+1);
   const lows=samples.map(x=>rawToAdjusted(x,x.low,'low')),highs=samples.map(x=>rawToAdjusted(x,x.high,'high'));
   const finalClose=rawToAdjusted(bars[i+k],bars[i+k].close,'close');
   if(!goodPrice(finalClose)||lows.some(x=>!goodPrice(x))||highs.some(x=>!goodPrice(x))){horizons[k]=null;continue}
   horizons[k]={maturedOn:bars[i+k].date,netReturnPct:round((finalClose/alignedPrice-1)*100-COST_PCT),
     maePct:round((Math.min(...lows)/alignedPrice-1)*100),
     mfePct:round((Math.max(...highs)/alignedPrice-1)*100),
     basis:'adjusted-ohlc-proxy-no-same-day-excursion'};
 }
 const closes5=bars.slice(i+1,i+6),fakeBreak5=closes5.length===5&&goodPrice(breakout)?
   closes5.some(r=>r.close<Number(breakout)):null;
 return{date:entryDay,price:Number(entryPrice),horizons,fakeBreak5,
   note:'固定持有期日K含息調整代理；不含進場當日MAE/MFE、最低手續費及滑價'};
}
function evaluateEvent(event,rows,today){
 const a=outcome(event?.a?.entryPrice,event?.day,event?.a?.breakout20,rows,today);
 // B can join an already-open episode on a later date, so use B's own entry date.
 const bday=event?.b?.entryAt?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(event.b.entryAt)):null;
 const b=event?.b?outcome(event.b.entryPrice,bday,event?.a?.breakout20,rows,today):null;
 return {...event,outcomes:{a,b}};
}
function metrics(entries,variant,days){
 const arr=(entries||[]).map(e=>e?.outcomes?.[variant]?.horizons?.[days])
   .filter(x=>x&&finite(x.netReturnPct));
 return{samples:arr.length,avgNetPct:round(mean(arr.map(x=>Number(x.netReturnPct)))),
   winPct:arr.length?round(arr.filter(x=>x.netReturnPct>0).length/arr.length*100,1):null,
   avgMAEPct:round(mean(arr.filter(x=>finite(x.maePct)).map(x=>Number(x.maePct)))),
   avgMFEPct:round(mean(arr.filter(x=>finite(x.mfePct)).map(x=>Number(x.mfePct))))};
}
function summarize(entries){
 const all=(entries||[]).filter(Boolean),b=all.filter(e=>e.b),excluded=all.filter(e=>!e.b);
 const byPeriod={};for(const d of [5,20,60])byPeriod[d]={
   a:metrics(all,'a',d),b:metrics(b,'b',d),
   aWhenBMatched:metrics(b,'a',d),aWhenBExcluded:metrics(excluded,'a',d)
 };
 const fake=variant=>{const e=(variant==='b'?b:all).map(x=>x.outcomes?.[variant]?.fakeBreak5).filter(x=>typeof x==='boolean');
   return{samples:e.length,ratePct:e.length?round(e.filter(Boolean).length/e.length*100,1):null}};
 return{events:all.length,bPassedEvents:b.length,bPendingEvents:excluded.length,byPeriod,
   fakeBreak5:{a:fake('a'),b:fake('b')}};
}
module.exports={VERSION,COST_PCT,activeTradingWindow,quoteValid,signalObservation,eventId,
 newEvent,updateEvent,daysSinceTrading,matchEpisode,normalizeBars,outcome,evaluateEvent,metrics,summarize};
