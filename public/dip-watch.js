/* Crash-dip watch v1. Observational, not a formal buy signal or a Gate override. */
(function(root){
'use strict';
const SYMBOLS=['0050','0056','00878','00919'], MIN_OBSERVATIONS=4,STABLE_MS=90000,MAX_AGE_MS=95000;
const state=Object.create(null);
const format=n=>Number.isFinite(Number(n))?Number(n).toFixed(2):'—';
function day(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())}
function fresh(time){const t=Date.parse(time||'');return Number.isFinite(t)&&t<=Date.now()+15000&&Date.now()-t<=MAX_AGE_MS}
function rangeFor(m,px){
 for(let i=2;i>=0;i--){
  const z=m?.layers?.[i]?.zone;
  if(z&&Number.isFinite(z.low)&&Number.isFinite(z.high)&&px>=z.low&&px<=z.high)return{layer:i+1,low:z.low,high:z.high};
 }
 return null;
}
function check(code,q,r,data,m){
 if(!SYMBOLS.includes(code)||r?.hardVeto!==true||!String(r?.hardVetoReason||'').includes('至少兩項急殺'))return{status:'OFF'};
 const px=Number(q?.last),modelDate=Date.parse(data?.fetchedAt||'');
 const good=px>0&&q?.date===day()&&q?.realtime===true&&q?.lastGoodFallback!==true&&
  q?.corporateActionReferenceMissing!==true&&q?.referenceReliable!==false&&r?.referenceReliable!==false&&
  data?.modelFreshByCode?.[code]===true&&fresh(q?.serverFetchedAt)&&
  Number.isFinite(modelDate)&&modelDate<=Date.now()+15000&&Date.now()-modelDate<=120000;
 if(!good)return{status:'DATA_WAIT',reason:'目前報價或模型時間不足以作盤中低接判斷'};
 const prev=Number(q?.effectivePrevClose||q?.prevClose),drop=prev>0?(px/prev-1)*100:null;
 if(!(drop<=-1.5))return{status:'OFF'};
 const zone=rangeFor(m,px),atr=Number(r?.history?.atr14);
 if(!zone||!(atr>0))return{status:'OUTSIDE',reason:'目前價格不在已計算的任一買點區間內，或ATR未確認'};
 const low=Number(q?.low);
 if(!(low>0&&low<=px))return{status:'DATA_WAIT',reason:'缺少本日可信最低價，暫不判定止跌'};
 return{status:'WATCH',px,low,atr,zone,drop,bounceRequired:Math.max(0.12,atr*0.2)};
}
function observe(code,q,r,data,m){
 const base=check(code,q,r,data,m);
 if(base.status==='OFF'||base.status==='DATA_WAIT')return base;
 const now=Date.now(),today=day(),s=state[code];
 if(!s||s.day!==today)state[code]={day:today,firstAt:now,lowAt:now,low:Number(q.low)||Number(q.last),seen:0,lastKey:null};
 const x=state[code],sessionLow=Number(q.low),px=Number(q.last);
 if(sessionLow>0&&sessionLow<x.low-0.009){x.low=sessionLow;x.lowAt=now;x.seen=0;x.lastKey=null}
 if(px>0&&px<x.low-0.009){x.low=px;x.lowAt=now;x.seen=0;x.lastKey=null}
 // Quote signatures, not HTTP refresh timestamps, are the independent samples.
 const key=[q.date,q.time??'',q.last,q.volume??'',q.high??'',q.low??''].join('|');
 if(key!==x.lastKey){x.seen=Math.min(120,x.seen+1);x.lastKey=key}
 return evaluate(code,q,r,data,m);
}
function evaluate(code,q,r,data,m){
 const base=check(code,q,r,data,m);
 if(base.status!=='WATCH')return base;
 const s=state[code],now=Date.now();
 if(!s||s.day!==day())return{...base,status:'WAIT',reason:'等待新交易日的即時觀測'};
 const seconds=Math.max(0,Math.floor((now-s.lowAt)/1000));
 const bounce=base.px-s.low,stable=seconds*1000>=STABLE_MS&&s.seen>=MIN_OBSERVATIONS&&bounce>=base.bounceRequired;
 return{...base,status:stable?'PROBE':'WAIT',observations:s.seen,seconds,bounce,
  reason:stable?'已出現短暫止跌及反彈跡象，但不等於風險解除':'持續確認是否停止創新低、是否有獨立行情更新與小幅反彈'};
}
function panel(code,r,m,q,data){
 const d=evaluate(code,q,r,data,m);
 if(d.status==='OFF')return'';
 let heading='',detail='',color='style="border-left:3px solid #dca44e;padding:10px 12px;margin:8px 0;background:#152237;border-radius:9px"';
 if(d.status==='PROBE'){
  heading='急跌低接觀察：可評估自主小額試單（非正式模型訊號）';
  detail='已持續'+d.seconds+'秒未創新低｜'+d.observations+'筆不同行情｜自低點反彈'+format(d.bounce)+'元。僅建議作為最多原定單次加碼預算10～20%的自主評估參考，不能將這筆交易標記為正式L1/L2/L3；無法保證不續跌。';
 }else if(d.status==='WAIT'){
  heading='急跌低接觀察：價格有吸引力，但尚未確認止跌';
  detail='已進入第'+d.zone.layer+'層｜最近低點後'+d.seconds+'秒（需90秒）｜行情樣本'+d.observations+'筆（需4筆）｜反彈'+format(d.bounce)+'元（需'+format(d.bounceRequired)+'元）。不因觸價就直接解除硬Gate。';
 }else{
  heading='急跌低接觀察：暫不可評估';
  detail=d.reason||'等待資料確認';
 }
 const band=d.zone?'｜第'+d.zone.layer+'層 '+format(d.zone.low)+'～'+format(d.zone.high)+'元':'';
 return '<div class="dip-watch-note" '+color+'><b>'+heading+'</b><br><small>'+detail+band+'</small><br><small>正式A版硬Gate仍FAIL；Shadow Critical PASS只表示資料檢查通過，不是買入確認。若自主成交，請使用「記錄自主買入」。</small></div>';
}
root.DipWatch={observe,evaluate,panel,check};
})(window);
